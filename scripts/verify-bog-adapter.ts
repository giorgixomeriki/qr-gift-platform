import Module from "node:module";
import { generateKeyPairSync, sign } from "node:crypto";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const { minorToMajor, majorToMinor } = require("../src/lib/payments/providers/bog/money") as typeof import("../src/lib/payments/providers/bog/money");
const { mapReceipt } = require("../src/lib/payments/providers/bog/receipt") as typeof import("../src/lib/payments/providers/bog/receipt");
const { receiptSchema } = require("../src/lib/payments/providers/bog/schemas") as typeof import("../src/lib/payments/providers/bog/schemas");
const { verifyBogSignature, parseBogPublicKey } = require("../src/lib/payments/providers/bog/signature") as typeof import("../src/lib/payments/providers/bog/signature");
const { BogTokenClient, bogRequest } = require("../src/lib/payments/providers/bog/http") as typeof import("../src/lib/payments/providers/bog/http");
const { idempotencyKeyFor } = require("../src/lib/payments/idempotency") as typeof import("../src/lib/payments/idempotency");
const { BOGPaymentProvider, BogRefundsDisabledError } = require("../src/lib/payments/providers/bog-provider") as typeof import("../src/lib/payments/providers/bog-provider");
const { ProviderNotImplementedError } = require("../src/lib/payments/types") as typeof import("../src/lib/payments/types");
const { tokenResponseSchema } = require("../src/lib/payments/providers/bog/schemas") as typeof import("../src/lib/payments/providers/bog/schemas");

/**
 * BOG Payment Manager adapter, offline: no database, no network. Every HTTP
 * exchange goes to an in-memory fake that records what the adapter sent, and
 * callbacks are signed with a locally generated RSA key standing in for
 * BOG's. Database-backed flows (orders, ledger, refunds) are in
 * verify-bog-integration.ts.
 *
 *  1. Money: exact minor↔major conversion, refusing anything inexact.
 *  2. Receipt mapping: every BOG order status, amounts, refund state, metadata.
 *  3. Callback signature: SHA256withRSA over the raw body, fail-closed.
 *  4. Idempotency keys: UUID v4 shape, deterministic per record.
 *  5. Token client: cache, single flight, expiry, re-auth on 401.
 *  6. createPayment: the amount is the order's own; request contract; retry
 *     reuses the Idempotency-Key; redirect host allowlist.
 *  7. handleWebhook: unsigned/forged → rejected before any BOG call; state
 *     comes from BOG's receipt, never from the callback body.
 *  8. refundPayment: disabled by default (nothing sent); request contract;
 *     async PENDING; definite refusal vs unknown outcome.
 *  9. Secrets never appear in errors.
 */

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
async function rejects(fn: () => Promise<unknown> | unknown): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signBody = (raw: string, key = privateKey) => sign("sha256", Buffer.from(raw, "utf8"), key).toString("base64");

const SECRET = "client-secret-never-logged-7f3a";
const jwt = (expSecondsFromNow: number, now = Date.now()) =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + expSecondsFromNow })).toString("base64url")}.s`;

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };
type Responder = (call: Call) => { status: number; json?: unknown } | Promise<{ status: number; json?: unknown }>;

/** In-memory BOG: records calls, answers via the given responder (token calls answered automatically). */
function fakeBog(responder: Responder) {
  const calls: Call[] = [];
  let tokenCalls = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    const call: Call = { url, method: init?.method ?? "GET", headers, body };
    if (url.endsWith("/token")) {
      tokenCalls++;
      return new Response(JSON.stringify({ access_token: jwt(3600), token_type: "Bearer", expires_in: 1634719923245 }), { status: 200 });
    }
    calls.push(call);
    const r = await responder(call);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status });
  };
  return { fetchImpl, calls, tokenCalls: () => tokenCalls };
}

function provider(responder: Responder, overrides: Partial<import("../src/lib/payments/providers/bog-provider").BogConfig> = {}) {
  const bog = fakeBog(responder);
  const p = new BOGPaymentProvider(
    {
      clientId: "client-1",
      clientSecret: SECRET,
      apiBaseUrl: "https://api.bog.ge/payments/v1/",
      tokenUrl: "https://oauth2.bog.ge/token",
      callbackPublicKey: publicPem,
      callbackUrl: "https://qrapp.ge/api/webhooks/payments/BOG",
      refundsEnabled: true,
      ...overrides,
    },
    { fetch: bog.fetchImpl },
  );
  return { p, bog };
}

const receipt = (over: Record<string, unknown> = {}, units: Record<string, unknown> = {}) =>
  receiptSchema.parse({
    order_id: "bog-1",
    external_order_id: "11111111-1111-4111-8111-111111111111",
    order_status: { key: "completed" },
    purchase_units: { request_amount: 10, transfer_amount: 10, refund_amount: 0, currency_code: "GEL", ...units },
    payment_detail: { transfer_method: { key: "card" }, transaction_id: "tx-9", payer_identifier: "548888xxxxxx1234", card_type: "mc" },
    actions: [],
    ...over,
  });

const orderInput = (amountMinor: number) => ({
  orderId: "11111111-1111-4111-8111-111111111111",
  amountMinor,
  currency: "GEL",
  returnUrls: { success: "https://qrapp.ge/g/tok?step=checkout&payment=return", cancel: "https://qrapp.ge/g/tok?step=checkout&payment=cancelled" },
  productId: "prod-uuid",
  locale: "en" as const,
});
const orderCreated = (href = "https://payment.bog.ge/?order_id=bog-1") => ({
  status: 200,
  json: { id: "bog-1", _links: { redirect: { href }, details: { href: "https://api.bog.ge/payments/v1/receipt/bog-1" } } },
});

async function main() {
  console.log("\n--- 1. Money conversion ---");
  check("1a. 1000 minor → 10 major; 1250 → 12.5; 1 → 0.01; 0 → 0", minorToMajor(1000) === 10 && minorToMajor(1250) === 12.5 && minorToMajor(1) === 0.01 && minorToMajor(0) === 0);
  check("1b. 10 / 12.5 / '10.00' / 0.1+0.2 → exact minor units", majorToMinor(10) === 1000 && majorToMinor(12.5) === 1250 && majorToMinor("10.00") === 1000 && majorToMinor(0.1 + 0.2) === 30);
  check("1c. Fractional minor, negative, NaN and non-decimal strings are refused", !!(await rejects(() => minorToMajor(10.5))) && !!(await rejects(() => minorToMajor(-1))) && !!(await rejects(() => majorToMinor(10.005))) && !!(await rejects(() => majorToMinor(Number.NaN))) && !!(await rejects(() => majorToMinor("1e3"))));
  {
    let roundTrips = true;
    for (let m = 0; m <= 100_000; m += 7) if (majorToMinor(minorToMajor(m)) !== m) roundTrips = false;
    check("1d. minor → major → minor round-trips exactly across 0…1000.00", roundTrips);
  }

  console.log("\n--- 2. Receipt mapping ---");
  {
    const ok = mapReceipt(receipt());
    check("2a. completed → SUCCEEDED with transfer_amount in minor units and currency", ok.status === "SUCCEEDED" && ok.amountMinor === 1000 && ok.currency === "GEL" && ok.providerPaymentId === "bog-1");
    check("2b. Safe metadata only: card brand, last 4, method, reference — never the masked PAN", ok.metadata.cardLast4 === "1234" && ok.metadata.cardBrand === "mc" && ok.metadata.paymentMethodType === "card" && !JSON.stringify(ok.metadata).includes("548888"));
    check("2c. created / processing → PENDING", mapReceipt(receipt({ order_status: { key: "created" } })).status === "PENDING" && mapReceipt(receipt({ order_status: { key: "processing" } })).status === "PENDING");
    const rej = mapReceipt(receipt({ order_status: { key: "rejected" }, reject_reason: "expiration" }, { transfer_amount: null }));
    check("2d. rejected → FAILED with its reason", rej.status === "FAILED" && rej.metadata.failureReason === "expiration");
    check(
      "2e. Pre-authorization states (never requested here) are never treated as paid",
      ["auth_requested", "blocked", "partial_completed"].every((k) => mapReceipt(receipt({ order_status: { key: k } })).status === "PENDING"),
    );
    check("2f. An unknown status stays PENDING (reconciliation keeps asking)", mapReceipt(receipt({ order_status: { key: "something_new" } })).status === "PENDING");
    const rr = mapReceipt(receipt({ order_status: { key: "refund_requested" } }));
    const rd = mapReceipt(receipt({ order_status: { key: "refunded" } }, { refund_amount: "10.00" }));
    check("2g. refund_requested / refunded map to refund state with the refunded amount", rr.refund?.status === "REQUESTED" && rd.refund?.status === "COMPLETED" && rd.refund.refundedAmountMinor === 1000);
    const rejected = mapReceipt(receipt({ actions: [{ action_id: "act-1", action: "refund", status: "rejected", code: 162 }] }));
    check("2h. A rejected refund action is reported by id", rejected.refund?.rejectedActionIds.join() === "act-1");
    check("2i. A completed receipt without transfer_amount is refused, not guessed", !!(await rejects(() => mapReceipt(receipt({}, { transfer_amount: null })))));
    check("2j. A completed receipt with a sub-tetri amount is refused", !!(await rejects(() => mapReceipt(receipt({}, { transfer_amount: 10.001 })))));
  }

  console.log("\n--- 3. Callback signature (SHA256withRSA over the raw body) ---");
  {
    const key = parseBogPublicKey(publicPem);
    const raw = JSON.stringify({ event: "order_payment", body: { order_id: "bog-1" } });
    check("3a. A genuine signature verifies", verifyBogSignature(raw, signBody(raw), key));
    check("3b. One changed byte in the body fails", !verifyBogSignature(raw.replace("bog-1", "bog-2"), signBody(raw), key));
    check("3c. Re-serialised JSON (whitespace) fails — bytes, not meaning, are signed", !verifyBogSignature(JSON.stringify(JSON.parse(raw), null, 1), signBody(raw), key));
    check("3d. Missing, empty and non-base64 signatures fail", !verifyBogSignature(raw, null, key) && !verifyBogSignature(raw, "", key) && !verifyBogSignature(raw, "not base64 !!", key));
    check("3e. A signature by another key fails", !verifyBogSignature(raw, signBody(raw, other.privateKey), key));
    check("3f. A non-RSA or non-PEM key is refused at parse time", !!(await rejects(() => parseBogPublicKey("dummy"))) && !!(await rejects(() => parseBogPublicKey(generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString()))));
    check("3g. A PEM with literal \\n escapes (env var style) parses", !!parseBogPublicKey(publicPem.replace(/\n/g, "\\n")));
  }

  console.log("\n--- 4. Idempotency keys ---");
  {
    const a = idempotencyKeyFor("refund:abc");
    check("4a. UUID v4 shape (version 4, RFC 4122 variant)", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a), a);
    check("4b. Deterministic for the same record, different for another", a === idempotencyKeyFor("refund:abc") && a !== idempotencyKeyFor("refund:abd"));
  }

  console.log("\n--- 5. Token client ---");
  {
    const bog = fakeBog(() => ({ status: 200, json: {} }));
    let now = Date.now();
    const tokens = new BogTokenClient({ tokenUrl: "https://oauth2.bog.ge/token", clientId: "c", clientSecret: SECRET }, bog.fetchImpl, () => now);
    const [t1, t2, t3] = await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);
    check("5a. Concurrent callers share one token request (single flight)", bog.tokenCalls() === 1 && t1 === t2 && t2 === t3);
    await tokens.getToken();
    check("5b. Cached until shortly before expiry", bog.tokenCalls() === 1);
    now += 3600_000; // past the JWT exp (1 h) — the implausible expires_in is ignored
    await tokens.getToken();
    check("5c. Refreshed once expired (JWT exp honoured; the implausible expires_in ignored)", bog.tokenCalls() === 2);
    check("5d. Token response shape is validated", !tokenResponseSchema.safeParse({ token_type: "Bearer" }).success);

    let unauthorizedOnce = true;
    const b2 = fakeBog(() => {
      if (unauthorizedOnce) {
        unauthorizedOnce = false;
        return { status: 401 };
      }
      return { status: 200, json: { ok: true } };
    });
    const t = new BogTokenClient({ tokenUrl: "https://oauth2.bog.ge/token", clientId: "c", clientSecret: SECRET }, b2.fetchImpl);
    const { z } = await import("zod");
    const r = await bogRequest({ fetchImpl: b2.fetchImpl, tokens: t }, { method: "GET", url: "https://api.bog.ge/x", idempotent: true }, z.object({ ok: z.boolean() }));
    check("5e. A 401 re-authenticates once and succeeds", r.ok === true && b2.tokenCalls() === 2 && b2.calls.length === 2);
    const b3 = fakeBog(() => ({ status: 200, json: {} }));
    await bogRequest({ fetchImpl: b3.fetchImpl, tokens: new BogTokenClient({ tokenUrl: "https://oauth2.bog.ge/token", clientId: "c", clientSecret: SECRET }, b3.fetchImpl) }, { method: "GET", url: "https://api.bog.ge/x", idempotent: true }, z.object({}));
    check("5f. API calls carry a Bearer token (never the client secret)", (b3.calls[0]?.headers.authorization ?? "").startsWith("Bearer ") && !JSON.stringify(b3.calls).includes(SECRET));
  }

  console.log("\n--- 6. createPayment ---");
  {
    const { p, bog } = provider(() => orderCreated());
    const res = await p.createPayment(orderInput(1000));
    const call = bog.calls[0]!;
    const body = call.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    check("6a. POST …/ecommerce/orders (base URL slash-normalised)", call.method === "POST" && call.url === "https://api.bog.ge/payments/v1/ecommerce/orders", call.url);
    check("6b. total_amount and unit_price are the order's own amount (1000 → 10)", body.purchase_units.total_amount === 10 && body.purchase_units.basket[0].unit_price === 10 && body.purchase_units.basket[0].quantity === 1);
    check("6c. Currency, callback URL, our order id, automatic capture, return URLs", body.purchase_units.currency === "GEL" && body.callback_url === "https://qrapp.ge/api/webhooks/payments/BOG" && body.external_order_id === orderInput(1000).orderId && body.capture === "automatic" && body.redirect_urls.fail.endsWith("payment=cancelled"));
    check("6d. Idempotency-Key is a UUID v4; Accept-Language follows the locale", /^[0-9a-f-]{36}$/.test(call.headers["idempotency-key"] ?? "") && call.headers["accept-language"] === "en");
    check("6e. Result: BOG order id + its payment-page URL", res.providerPaymentId === "bog-1" && res.redirectUrl === "https://payment.bog.ge/?order_id=bog-1");

    const { p: p2, bog: bog2 } = provider(() => orderCreated());
    await p2.createPayment(orderInput(1250));
    check("6f. A partner-override order of 12.50 is sent as 12.5 — no fixed price anywhere", (bog2.calls[0]!.body as any).purchase_units.total_amount === 12.5); // eslint-disable-line @typescript-eslint/no-explicit-any

    let first = true;
    const { p: p3, bog: bog3 } = provider(() => {
      if (first) {
        first = false;
        return { status: 503 };
      }
      return orderCreated();
    });
    await p3.createPayment(orderInput(1000));
    check("6g. A 5xx is retried once with the SAME Idempotency-Key (no second BOG order)", bog3.calls.length === 2 && bog3.calls[0]!.headers["idempotency-key"] === bog3.calls[1]!.headers["idempotency-key"]);

    const evil = provider(() => orderCreated("https://payment.bog.ge.evil.example/?order_id=bog-1"));
    check("6h. A redirect to any host but payment.bog.ge is refused", !!(await rejects(() => evil.p.createPayment(orderInput(1000)))));
    const plain = provider(() => orderCreated("http://payment.bog.ge/?order_id=bog-1"));
    check("6i. A non-https redirect is refused", !!(await rejects(() => plain.p.createPayment(orderInput(1000)))));
    const bad = provider(() => orderCreated());
    check(
      "6j. Zero, negative, fractional amounts and unsupported currencies are refused before calling BOG",
      !!(await rejects(() => bad.p.createPayment(orderInput(0)))) && !!(await rejects(() => bad.p.createPayment(orderInput(-100)))) && !!(await rejects(() => bad.p.createPayment(orderInput(10.5)))) && !!(await rejects(() => bad.p.createPayment({ ...orderInput(1000), currency: "JPY" }))) && bad.bog.calls.length === 0,
    );
    const garbage = provider(() => ({ status: 200, json: { unexpected: true } }));
    check("6k. An unexpected response shape fails closed", !!(await rejects(() => garbage.p.createPayment(orderInput(1000)))));
    const refused = provider(() => ({ status: 400, json: { key: "invalid_request", message: "bad" } }));
    const err = await rejects(() => refused.p.createPayment(orderInput(1000)));
    check("6l. A 4xx is not retried and surfaces BOG's key", refused.bog.calls.length === 1 && !!err?.message.includes("invalid_request"));
  }

  console.log("\n--- 7. handleWebhook ---");
  {
    const raw = JSON.stringify({ event: "order_payment", zoned_request_time: "2026-10-14T10:00:00.000000Z", body: { order_id: "bog-1", order_status: { key: "completed" }, purchase_units: { transfer_amount: 9999 } } });
    const { p, bog } = provider(() => ({ status: 200, json: receipt({ order_status: { key: "processing" } }) }));
    const h = (sig: string | null) => new Headers(sig === null ? {} : { "Callback-Signature": sig });

    check("7a. Unsigned callback is rejected without calling BOG", !!(await rejects(() => p.handleWebhook(raw, h(null)))) && bog.calls.length === 0);
    check("7b. Forged signature is rejected without calling BOG", !!(await rejects(() => p.handleWebhook(raw, h(signBody(raw, other.privateKey))))) && bog.calls.length === 0);
    const result = await p.handleWebhook(raw, h(signBody(raw)));
    check("7c. A genuine callback re-reads the receipt (GET …/receipt/bog-1)", bog.calls.length === 1 && bog.calls[0]!.method === "GET" && bog.calls[0]!.url.endsWith("/receipt/bog-1"));
    check("7d. State comes from the receipt, not the body (body said completed/9999 → PENDING/1000)", result.status === "PENDING" && result.amountMinor === 1000);
    check("7e. Our order id comes from the receipt's external_order_id", result.orderId === "11111111-1111-4111-8111-111111111111");
    const other = JSON.stringify({ event: "something_else", body: { order_id: "bog-1" } });
    check("7f. An unhandled event type is rejected", !!(await rejects(() => p.handleWebhook(other, h(signBody(other))))));
    const mismatch = provider(() => ({ status: 200, json: receipt({ order_id: "bog-OTHER" }) }));
    check("7g. A receipt for a different BOG order than asked is refused", !!(await rejects(() => mismatch.p.handleWebhook(raw, h(signBody(raw))))));
    const noExternal = provider(() => ({ status: 200, json: receipt({ external_order_id: null }) }));
    check("7h. A receipt without our order id is refused", !!(await rejects(() => noExternal.p.handleWebhook(raw, h(signBody(raw))))));
  }

  console.log("\n--- 8. refundPayment ---");
  {
    const off = provider(() => ({ status: 200, json: { key: "request_received", action_id: "act-1" } }), { refundsEnabled: false });
    const offErr = await rejects(() => off.p.refundPayment("bog-1", 1000, idempotencyKeyFor("refund:r1")));
    check("8a. Disabled by default: refused as not-sent, nothing reaches BOG", offErr instanceof BogRefundsDisabledError && offErr instanceof ProviderNotImplementedError && off.bog.calls.length === 0);

    const { p, bog } = provider(() => ({ status: 200, json: { key: "request_received", message: "Refund request received", action_id: "act-1" } }));
    const key = idempotencyKeyFor("refund:r1");
    const r = await p.refundPayment("bog-1", 1000, key);
    const call = bog.calls[0]!;
    check("8b. POST …/payment/refund/bog-1 with the explicit amount and our Idempotency-Key", call.url.endsWith("/payment/refund/bog-1") && (call.body as { amount: number }).amount === 10 && call.headers["idempotency-key"] === key);
    check("8c. request_received → PENDING with BOG's action id (completion comes later)", r.status === "PENDING" && r.providerActionId === "act-1" && r.refundedAmountMinor === 0);
    check("8d. No idempotency key or no amount → refused before calling BOG", !!(await rejects(() => p.refundPayment("bog-1", 1000))) && !!(await rejects(() => p.refundPayment("bog-1", undefined, key))) && bog.calls.length === 1);
    const refused = provider(() => ({ status: 400, json: { key: "refund_not_allowed" } }));
    check("8e. A 4xx is a definite refusal → FAILED", (await refused.p.refundPayment("bog-1", 1000, key)).status === "FAILED");
    const down = provider(() => ({ status: 503 }));
    check("8f. A repeated 5xx is an unknown outcome → thrown (caller keeps it REQUESTED)", !!(await rejects(() => down.p.refundPayment("bog-1", 1000, key))) && down.bog.calls.length === 2 && down.bog.calls[0]!.headers["idempotency-key"] === down.bog.calls[1]!.headers["idempotency-key"]);
  }

  console.log("\n--- 9. Secrets never appear in errors ---");
  {
    const failing = fakeBog(() => ({ status: 500 }));
    const failingToken = async (url: string, init?: RequestInit) => (url.endsWith("/token") ? new Response("{}", { status: 401 }) : failing.fetchImpl(url, init));
    const p = new BOGPaymentProvider(
      { clientId: "client-1", clientSecret: SECRET, apiBaseUrl: "https://api.bog.ge/payments/v1", tokenUrl: "https://oauth2.bog.ge/token", callbackPublicKey: publicPem, callbackUrl: "https://qrapp.ge/api/webhooks/payments/BOG", refundsEnabled: true },
      { fetch: failingToken },
    );
    const e = await rejects(() => p.createPayment(orderInput(1000)));
    check("9a. A failed token request reports the status only — no secret, no Basic header", !!e && !e.message.includes(SECRET) && !e.message.includes(Buffer.from(`client-1:${SECRET}`).toString("base64")), e?.message);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

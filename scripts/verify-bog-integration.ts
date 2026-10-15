import Module from "node:module";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign } from "node:crypto";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");

/**
 * BOG Payment Manager, database-backed (docs/integration/BOG_PAYMENT_MANAGER_PLAN.md §4.3).
 * The real adapter, service, webhook handler and refund workflow run against
 * the local database and a local BOG simulator (token, orders, receipt,
 * refund endpoints). Callbacks are signed with a locally generated RSA key
 * standing in for BOG's. No network beyond 127.0.0.1, no real money.
 *
 *  1. Kill switch: CHECKOUT_ENABLED=false opens no order and calls nothing.
 *  2. Checkout: BOG receives the order's own snapshot (10.00 GEL), our order
 *     id, the callback URL; the redirect is BOG's page. A partner override
 *     (15.00 GEL, 25%) reaches BOG as 15.00 and splits 375 / 1125.
 *  3. Success callback: PAID, activated, one 300 commission; duplicate and
 *     concurrent callbacks change nothing.
 *  4. Forged / unsigned callbacks: 400, nothing changes, BOG never asked.
 *  5. Callback body lies (says completed) while BOG's receipt says
 *     processing: nothing is paid.
 *  6. Rejected payment: attempt + order FAILED, no commission.
 *  7. Amount mismatch (BOG reports 5.00 for a 10.00 order): refused, audited.
 *  8. Missed callback: the return-page check asks BOG and settles.
 *  9. Admin refund, asynchronous: REQUESTED with BOG's action id, order still
 *     PAID, no reversal; BOG's refund callback completes it once (−300).
 * 10. Refund rejected by BOG: refund REJECTED, order PAID, anomaly listed.
 * 11. Refund outcome unknown (BOG 5xx): stays REQUESTED; reconciliation
 *     re-sends with the SAME Idempotency-Key.
 * 12. A refund QR Starr never asked for is recorded, never applied.
 * 13. Refunds switched off (BOG_REFUNDS_ENABLED=false): nothing sent, order
 *     stays PAID, the refund row is closed as NOT_SENT.
 * 14. Scheduled reconciliation (/api/cron/payments-reconcile): absent unless
 *     configured, refuses a wrong secret, settles a missed callback from
 *     BOG's receipt.
 */

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const admin = postgres(migrationsUrl, { max: 1 });

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
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// BOG simulator
// ---------------------------------------------------------------------------
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const forger = generateKeyPairSync("rsa", { modulusLength: 2048 });

type BogOrder = {
  id: string;
  externalOrderId: string;
  status: string;
  requestAmount: number;
  transferAmount: number | null;
  refundAmount: number;
  currency: string;
  actions: { action_id: string; action: string; status: string; amount: number }[];
};
type Seen = { method: string; path: string; headers: Record<string, string>; body: unknown };

const RUN = crypto.randomUUID().slice(0, 8);
const bog = {
  orders: new Map<string, BogOrder>(),
  calls: [] as Seen[],
  /** When set, the next refund calls answer with this HTTP status instead. */
  refundFailStatus: null as number | null,
  /** Override of what the receipt reports as transfer_amount (amount-mismatch case). */
  transferOverride: new Map<string, number>(),
  seq: 0,
};

function receiptOf(o: BogOrder) {
  return {
    order_id: o.id,
    external_order_id: o.externalOrderId,
    order_status: { key: o.status },
    purchase_units: {
      request_amount: o.requestAmount,
      transfer_amount: bog.transferOverride.get(o.id) ?? o.transferAmount,
      refund_amount: o.refundAmount,
      currency_code: o.currency,
    },
    payment_detail: { transfer_method: { key: "card" }, transaction_id: `tx-${o.id}`, payer_identifier: "548888xxxxxx1234", card_type: "mc" },
    actions: o.actions,
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, json?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json === undefined ? "" : JSON.stringify(json));
}

const server = createServer(async (req, res) => {
  const raw = await readBody(req);
  const path = (req.url ?? "").split("?")[0]!;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
  const body = raw.startsWith("{") ? JSON.parse(raw) : raw;
  if (path === "/token") {
    const ok = headers.authorization === `Basic ${Buffer.from("qa-client:qa-secret").toString("base64")}` && raw === "grant_type=client_credentials";
    if (!ok) return send(res, 401, { error: "invalid_client" });
    return send(res, 200, { access_token: "qa-access-token", token_type: "Bearer", expires_in: 3600 });
  }
  bog.calls.push({ method: req.method ?? "", path, headers, body });
  if (headers.authorization !== "Bearer qa-access-token") return send(res, 401, { key: "unauthorized" });

  if (req.method === "POST" && path === "/ecommerce/orders") {
    const b = body as { external_order_id: string; purchase_units: { total_amount: number; currency: string } };
    // Same Idempotency-Key → same order (as BOG documents).
    const key = headers["idempotency-key"];
    const existing = [...bog.orders.values()].find((o) => (o as BogOrder & { key?: string }).key === key);
    const order = existing ?? {
      id: `bog-${RUN}-${++bog.seq}`,
      externalOrderId: b.external_order_id,
      status: "created",
      requestAmount: b.purchase_units.total_amount,
      transferAmount: null,
      refundAmount: 0,
      currency: b.purchase_units.currency,
      actions: [],
      key,
    };
    bog.orders.set(order.id, order);
    return send(res, 200, { id: order.id, _links: { details: { href: `https://api.bog.ge/payments/v1/receipt/${order.id}` }, redirect: { href: `https://payment.bog.ge/?order_id=${order.id}` } } });
  }
  const receiptMatch = path.match(/^\/receipt\/(.+)$/);
  if (req.method === "GET" && receiptMatch) {
    const o = bog.orders.get(decodeURIComponent(receiptMatch[1]!));
    return o ? send(res, 200, receiptOf(o)) : send(res, 404, { key: "not_found" });
  }
  const refundMatch = path.match(/^\/payment\/refund\/(.+)$/);
  if (req.method === "POST" && refundMatch) {
    if (bog.refundFailStatus) return send(res, bog.refundFailStatus, { key: "unavailable" });
    const o = bog.orders.get(decodeURIComponent(refundMatch[1]!));
    if (!o || o.status !== "completed") return send(res, 400, { key: "refund_not_allowed" });
    const key = headers["idempotency-key"]!;
    const prior = o.actions.find((a) => a.action_id === `act-${key}`);
    if (!prior) {
      o.actions.push({ action_id: `act-${key}`, action: "refund", status: "processing", amount: (body as { amount: number }).amount });
      o.status = "refund_requested";
    }
    return send(res, 200, { key: "request_received", message: "Refund request received", action_id: `act-${key}` });
  }
  return send(res, 404, { key: "no_route" });
});

/** Bank-side state changes, as BOG would make them. */
function complete(id: string) {
  const o = bog.orders.get(id)!;
  o.status = "completed";
  o.transferAmount = o.requestAmount;
}
function reject(id: string) {
  bog.orders.get(id)!.status = "rejected";
}
function settleRefund(id: string, outcome: "completed" | "rejected") {
  const o = bog.orders.get(id)!;
  const a = o.actions.at(-1)!;
  a.status = outcome;
  if (outcome === "completed") {
    o.status = "refunded";
    o.refundAmount = o.transferAmount ?? 0;
  } else {
    o.status = "completed";
  }
}
function externalRefund(id: string) {
  const o = bog.orders.get(id)!;
  o.status = "refunded";
  o.refundAmount = o.transferAmount ?? 0;
  o.actions.push({ action_id: "act-portal", action: "refund", status: "completed", amount: o.refundAmount });
}

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Configure the app as a BOG deployment BEFORE any app module loads env.
  Object.assign(process.env, {
    PAYMENTS_PROVIDER: "BOG",
    BOG_CLIENT_ID: "qa-client",
    BOG_CLIENT_SECRET: "qa-secret",
    BOG_API_BASE_URL: base,
    BOG_OAUTH_TOKEN_URL: `${base}/token`,
    BOG_WEBHOOK_SIGNING_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    CHECKOUT_ENABLED: "true",
    BOG_REFUNDS_ENABLED: "true",
  });
  delete process.env.ALLOW_TEST_PAYMENTS;
  delete process.env.VERCEL;

  const { env } = require("../src/lib/env") as typeof import("../src/lib/env");
  const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
  const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
  const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
  const { getOrCreateCheckoutOrder, checkPaymentReturn } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
  const { CheckoutUnavailableError } = require("../src/lib/payments/checkout-gate") as typeof import("../src/lib/payments/checkout-gate");
  const { refundPaidOrder, findPaymentAnomalies } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
  const { reconcileOrderRefunds } = require("../src/lib/payments/refunds") as typeof import("../src/lib/payments/refunds");
  const { handleProviderWebhook } = require("../src/lib/payments/webhook") as typeof import("../src/lib/payments/webhook");
  const { GET: cronReconcile } = require("../src/app/api/cron/payments-reconcile/route") as typeof import("../src/app/api/cron/payments-reconcile/route");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutableEnv = env as any;

  console.log("Setting up fixtures (superuser)...");
  const adminUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING'`;

  async function newPartner(commissionBps: number, overrideMinor?: number) {
    const partnerId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"bog-" + partnerId.slice(0, 8)}, 'BOG Integration Partner', ${commissionBps}, 'ACTIVE')`;
    await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'bog-integration', 50)`;
    if (overrideMinor) {
      await admin`insert into prices (product_id, partner_id, currency, amount_minor, active) values (${product!.id}, ${partnerId}, 'GEL', ${overrideMinor}, true)`;
    }
    return { partnerId, batchId };
  }
  const standard = await newPartner(3000);
  const custom = await newPartner(2500, 1500);

  async function newGreeting(p = standard) {
    const id = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${id}, ${token}, ${p.batchId}, ${p.partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    await updateGreetingMessage(greetingId, editToken, "BOG integration test message");
    return { greetingId, editToken };
  }
  async function newOrder(p = standard) {
    const g = await newGreeting(p);
    const { summary } = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    const [pay] = await admin`select provider_payment_id from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    return { ...g, orderId: summary.orderId, bogId: pay!.provider_payment_id as string, redirectUrl: summary.redirectUrl };
  }
  const callbackBody = (bogId: string, claim: Record<string, unknown> = {}) =>
    JSON.stringify({ event: "order_payment", zoned_request_time: new Date().toISOString(), body: { order_id: bogId, ...claim } });
  const callback = (raw: string, key = privateKey) =>
    handleProviderWebhook("BOG", raw, new Headers({ "Callback-Signature": sign("sha256", Buffer.from(raw, "utf8"), key).toString("base64") }));
  const orderRow = async (orderId: string) => (await admin`select status, gross_amount_minor, partner_commission_minor, platform_share_minor from orders where id = ${orderId}`)[0]!;
  const ledger = async (orderId: string) =>
    (await admin`select type, amount_minor from partner_ledger_entries where order_id = ${orderId} order by created_at`).map((r) => `${r.type}:${r.amount_minor}`).join(",");
  const greetingStatus = async (greetingId: string) => (await admin`select status from greetings where id = ${greetingId}`)[0]!.status as string;
  const refundRows = async (orderId: string) => admin`select status, provider_action_id, provider_code, reason from payment_refunds where order_id = ${orderId} order by requested_at`;

  console.log("\n--- 1. Kill switch ---");
  {
    mutableEnv.CHECKOUT_ENABLED = false;
    const g = await newGreeting();
    const before = bog.calls.length;
    const r = await attempt(() => getOrCreateCheckoutOrder(g.greetingId, g.editToken));
    const [{ n }] = (await admin`select count(*)::int as n from orders where greeting_id = ${g.greetingId}`) as unknown as [{ n: number }];
    check("1a. CHECKOUT_ENABLED=false: checkout refused as closed", !r.ok && r.error === new CheckoutUnavailableError().message, r.ok ? "opened" : r.error);
    check("1b. …no order created and nothing sent to BOG", n === 0 && bog.calls.length === before);
    mutableEnv.CHECKOUT_ENABLED = true;
  }

  console.log("\n--- 2. Checkout ---");
  const paid = await newOrder();
  {
    const create = bog.calls.find((c) => c.path === "/ecommerce/orders" && (c.body as { external_order_id: string }).external_order_id === paid.orderId);
    const b = create?.body as { callback_url: string; purchase_units: { total_amount: number; currency: string; basket: { unit_price: number }[] }; capture: string } | undefined;
    check("2a. BOG receives our order id and the order's own amount (10.00 GEL)", b?.purchase_units.total_amount === 10 && b.purchase_units.currency === "GEL" && b.purchase_units.basket[0]!.unit_price === 10);
    check("2b. Automatic capture, our callback URL, an Idempotency-Key", b?.capture === "automatic" && b.callback_url.endsWith("/api/webhooks/payments/BOG") && /^[0-9a-f-]{36}$/.test(create?.headers["idempotency-key"] ?? ""));
    check("2c. The customer is sent to BOG's hosted page", paid.redirectUrl?.startsWith("https://payment.bog.ge/") === true);
    const o = await orderRow(paid.orderId);
    check("2d. Order snapshot 1000 / 300 / 700, PENDING_PAYMENT", o.status === "PENDING_PAYMENT" && o.gross_amount_minor === 1000 && o.partner_commission_minor === 300 && o.platform_share_minor === 700);

    const c = await newOrder(custom);
    const cb = bog.calls.find((x) => x.path === "/ecommerce/orders" && (x.body as { external_order_id: string }).external_order_id === c.orderId)?.body as { purchase_units: { total_amount: number } } | undefined;
    const co = await orderRow(c.orderId);
    check("2e. Partner override reaches BOG as 15.00 and splits 375 / 1125", cb?.purchase_units.total_amount === 15 && co.gross_amount_minor === 1500 && co.partner_commission_minor === 375 && co.platform_share_minor === 1125);
  }

  console.log("\n--- 3. Success callback ---");
  {
    complete(paid.bogId);
    const r = await callback(callbackBody(paid.bogId));
    check("3a. Signed callback → 200", r.status === 200, JSON.stringify(r));
    check("3b. Order PAID, greeting ACTIVE, one 300 commission", (await orderRow(paid.orderId)).status === "PAID" && (await greetingStatus(paid.greetingId)) === "ACTIVE" && (await ledger(paid.orderId)) === "COMMISSION_EARNED:300", await ledger(paid.orderId));
    const again = await Promise.all([callback(callbackBody(paid.bogId)), callback(callbackBody(paid.bogId)), callback(callbackBody(paid.bogId))]);
    check("3c. Replayed + concurrent callbacks all 200, still one commission", again.every((x) => x.status === 200) && (await ledger(paid.orderId)) === "COMMISSION_EARNED:300");
  }

  console.log("\n--- 4. Forged and unsigned callbacks ---");
  {
    const o = await newOrder();
    complete(o.bogId);
    const before = bog.calls.length;
    const forged = await callback(callbackBody(o.bogId), forger.privateKey);
    const unsigned = await handleProviderWebhook("BOG", callbackBody(o.bogId), new Headers());
    check("4a. Forged and unsigned → 400", forged.status === 400 && unsigned.status === 400);
    check("4b. …BOG not even asked, order still PENDING_PAYMENT", bog.calls.length === before && (await orderRow(o.orderId)).status === "PENDING_PAYMENT");
  }

  console.log("\n--- 5. The callback body is never trusted ---");
  {
    const o = await newOrder();
    bog.orders.get(o.bogId)!.status = "processing";
    const r = await callback(callbackBody(o.bogId, { order_status: { key: "completed" }, purchase_units: { transfer_amount: 10 } }));
    check("5a. Body says completed, BOG's receipt says processing → nothing paid", r.status === 200 && (await orderRow(o.orderId)).status === "PENDING_PAYMENT" && (await ledger(o.orderId)) === "");
  }

  console.log("\n--- 6. Rejected payment ---");
  {
    const o = await newOrder();
    reject(o.bogId);
    const r = await callback(callbackBody(o.bogId));
    const [p] = await admin`select status from payments where provider_payment_id = ${o.bogId}`;
    check("6a. Attempt and order FAILED, no commission, greeting still DRAFT", r.status === 200 && p?.status === "FAILED" && (await orderRow(o.orderId)).status === "FAILED" && (await ledger(o.orderId)) === "" && (await greetingStatus(o.greetingId)) === "DRAFT");
  }

  console.log("\n--- 7. Amount mismatch ---");
  {
    const o = await newOrder();
    complete(o.bogId);
    bog.transferOverride.set(o.bogId, 5);
    const r = await callback(callbackBody(o.bogId));
    const [a] = await admin`select count(*)::int as n from audit_logs where action = 'PAYMENT_AMOUNT_MISMATCH' and target_id = ${o.orderId}`;
    check("7a. BOG reports 5.00 for a 10.00 order → refused (400), nothing paid", r.status === 400 && (await orderRow(o.orderId)).status === "PENDING_PAYMENT" && (await ledger(o.orderId)) === "", JSON.stringify(r));
    check("7b. …and the mismatch is audited for reconciliation", a!.n >= 1);
    bog.transferOverride.delete(o.bogId);
  }

  console.log("\n--- 8. Missed callback: the return page asks BOG ---");
  {
    const o = await newOrder();
    const pending = await checkPaymentReturn(o.greetingId, o.editToken);
    check("8a. Landing on the return URL alone pays nothing (BOG: created)", pending.status === "PENDING_PAYMENT");
    complete(o.bogId);
    const settled = await checkPaymentReturn(o.greetingId, o.editToken);
    check("8b. Once BOG reports completed, the check settles it (PAID, activated)", settled.status === "PAID" && (await greetingStatus(o.greetingId)) === "ACTIVE" && (await ledger(o.orderId)) === "COMMISSION_EARNED:300");
  }

  console.log("\n--- 9. Admin refund (asynchronous) ---");
  {
    const r = await refundPaidOrder(adminUserId, paid.orderId);
    const rows = await refundRows(paid.orderId);
    check("9a. BOG accepts → pending; refund REQUESTED with BOG's action id", r.pending === true && rows.length === 1 && rows[0]!.status === "REQUESTED" && !!rows[0]!.provider_action_id);
    check("9b. Order still PAID, no reversal yet", (await orderRow(paid.orderId)).status === "PAID" && (await ledger(paid.orderId)) === "COMMISSION_EARNED:300");
    const call = bog.calls.filter((c) => c.path === `/payment/refund/${paid.bogId}`);
    check("9c. One refund call: full amount (10.00) with a UUID Idempotency-Key", call.length === 1 && (call[0]!.body as { amount: number }).amount === 10 && /^[0-9a-f-]{36}$/.test(call[0]!.headers["idempotency-key"] ?? ""));
    const second = await refundPaidOrder(adminUserId, paid.orderId);
    check("9d. A second admin click sends nothing new", second.pending === true && bog.calls.filter((c) => c.path === `/payment/refund/${paid.bogId}`).length === 1);

    settleRefund(paid.bogId, "completed");
    const cb = await callback(callbackBody(paid.bogId));
    const after = await refundRows(paid.orderId);
    check("9e. BOG's refund callback → refund COMPLETED, order REFUNDED", cb.status === 200 && after[0]!.status === "COMPLETED" && (await orderRow(paid.orderId)).status === "REFUNDED");
    check("9f. Commission reversed exactly once (+300, −300)", (await ledger(paid.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300", await ledger(paid.orderId));
    await callback(callbackBody(paid.bogId));
    check("9g. A replayed refund callback changes nothing", (await ledger(paid.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300");
  }

  console.log("\n--- 10. Refund rejected by BOG ---");
  {
    const o = await newOrder();
    complete(o.bogId);
    await callback(callbackBody(o.bogId));
    await refundPaidOrder(adminUserId, o.orderId);
    settleRefund(o.bogId, "rejected");
    const cb = await callback(callbackBody(o.bogId));
    const rows = await refundRows(o.orderId);
    check("10a. Refund REJECTED, order stays PAID, commission untouched", cb.status === 200 && rows[0]!.status === "REJECTED" && (await orderRow(o.orderId)).status === "PAID" && (await ledger(o.orderId)) === "COMMISSION_EARNED:300", JSON.stringify(rows));
    const anomalies = await findPaymentAnomalies(adminUserId);
    check("10b. Listed as REFUND_REJECTED for a person", anomalies.some((a) => a.kind === "REFUND_REJECTED" && a.orderId === o.orderId));
  }

  console.log("\n--- 11. Refund outcome unknown ---");
  {
    const o = await newOrder();
    complete(o.bogId);
    await callback(callbackBody(o.bogId));
    bog.refundFailStatus = 503;
    const r = await attempt(() => refundPaidOrder(adminUserId, o.orderId));
    const rows = await refundRows(o.orderId);
    const firstKeys = bog.calls.filter((c) => c.path === `/payment/refund/${o.bogId}`).map((c) => c.headers["idempotency-key"]);
    check("11a. BOG 5xx → refund stays REQUESTED (never assumed failed or done)", r.ok && rows[0]!.status === "REQUESTED" && !rows[0]!.provider_action_id && (await orderRow(o.orderId)).status === "PAID", r.ok ? JSON.stringify(rows) : r.error);
    bog.refundFailStatus = null;
    const counts = await reconcileOrderRefunds(o.orderId);
    const keys = bog.calls.filter((c) => c.path === `/payment/refund/${o.bogId}`).map((c) => c.headers["idempotency-key"]);
    check("11b. Reconciliation re-sends with the same Idempotency-Key", counts.pending === 1 && keys.length === firstKeys.length + 1 && new Set(keys).size === 1, JSON.stringify({ counts, keys }));
    settleRefund(o.bogId, "completed");
    const done = await reconcileOrderRefunds(o.orderId);
    check("11c. …and completes once BOG confirms (no callback needed)", done.completed === 1 && (await orderRow(o.orderId)).status === "REFUNDED" && (await ledger(o.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300");
  }

  console.log("\n--- 12. A refund made outside QR Starr ---");
  {
    const o = await newOrder();
    complete(o.bogId);
    await callback(callbackBody(o.bogId));
    externalRefund(o.bogId);
    const cb = await callback(callbackBody(o.bogId));
    const [a] = await admin`select count(*)::int as n from audit_logs where action = 'PAYMENT_EXTERNAL_REFUND' and target_id = ${o.orderId}`;
    check("12a. Recorded for a person; order stays PAID, nothing reversed automatically", cb.status === 200 && a!.n === 1 && (await orderRow(o.orderId)).status === "PAID" && (await ledger(o.orderId)) === "COMMISSION_EARNED:300");
  }

  console.log("\n--- 13. Refunds switched off ---");
  {
    const o = await newOrder();
    complete(o.bogId);
    await callback(callbackBody(o.bogId));
    mutableEnv.BOG_REFUNDS_ENABLED = false;
    const before = bog.calls.length;
    const r = await attempt(() => refundPaidOrder(adminUserId, o.orderId));
    const rows = await refundRows(o.orderId);
    check("13a. Admin refund refused, nothing sent to BOG", !r.ok && bog.calls.length === before, r.ok ? "accepted" : undefined);
    check("13b. Order PAID, commission untouched, request closed as NOT_SENT", (await orderRow(o.orderId)).status === "PAID" && (await ledger(o.orderId)) === "COMMISSION_EARNED:300" && rows[0]?.status === "REJECTED" && rows[0]?.provider_code === "NOT_SENT");
    mutableEnv.BOG_REFUNDS_ENABLED = true;
  }

  console.log("\n--- 14. Scheduled reconciliation ---");
  {
    const cron = (auth?: string) => cronReconcile(new Request("http://localhost/api/cron/payments-reconcile", { headers: auth ? { Authorization: auth } : {} }));
    check("14a. Not configured → the endpoint does not exist (404)", (await cron("Bearer anything")).status === 404);
    const secret = "cron-secret-for-the-bog-integration-suite";
    mutableEnv.CRON_SECRET = secret;
    mutableEnv.RECONCILE_ADMIN_USER_ID = adminUserId;
    check("14b. Missing or wrong secret → 401", (await cron()).status === 401 && (await cron(`Bearer ${secret}x`)).status === 401);
    const o = await newOrder();
    complete(o.bogId);
    await admin`update payments set created_at = now() - interval '1 hour' where provider_payment_id = ${o.bogId}`;
    const r = await cron(`Bearer ${secret}`);
    const body = (await r.json()) as { anomalies: number; repaired: number };
    check("14c. A missed callback is settled from BOG's receipt (PAID, activated, one commission)", r.status === 200 && body.repaired >= 1 && (await orderRow(o.orderId)).status === "PAID" && (await greetingStatus(o.greetingId)) === "ACTIVE" && (await ledger(o.orderId)) === "COMMISSION_EARNED:300", JSON.stringify(body));
    mutableEnv.CRON_SECRET = undefined;
    mutableEnv.RECONCILE_ADMIN_USER_ID = undefined;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    server.close();
    await admin.end();
    process.exit(failed ? 1 : 0);
  });

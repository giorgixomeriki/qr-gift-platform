import Module from "node:module";
import type { AddressInfo } from "node:net";
import { sign } from "node:crypto";

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
 * 15. A late success on a FAILED order is refunded through BOG; while BOG
 *     holds that refund the order is NOT listed for a manual refund
 *     (REFUND_PENDING) — that would return the money twice.
 * 16. A second capture on a PAID order is refunded through BOG; while in
 *     flight it is not listed as an unrefunded DUPLICATE_CAPTURE.
 * 17. Staging payment fence (PAYMENTS_SCOPE_PARTNER_ID): orders of any other
 *     partner (e.g. simulator leftovers) never reach BOG — no payment, no
 *     receipt lookup, no refund — and nothing is written for them; scoped
 *     reconciliation reports and repairs the fenced partner only; the fenced
 *     partner's own orders still work end to end.
 * 18. Minimum-amount lifecycle (staging test plan, 1.00 GEL = the app's
 *     MIN_PRICE_MINOR): BOG receives exactly 1, success / cancel / missed
 *     callback / full refund all settle on 100 tetri with a 30 / 70 split;
 *     below the floor is refused by the admin validation.
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

const { bog, server, publicKey, privateKey, forger, complete, reject, settleRefund, externalRefund } = require("./lib-bog-simulator") as typeof import("./lib-bog-simulator");

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
    // Real checkout also needs the policies in force (checkout-gate.ts).
    LEGAL_EFFECTIVE_DATE: "2026-01-01",
  });
  // The real policy copy still carries lawyer/owner notes, so the legal-readiness
  // gate keeps real checkout closed; these suites test the money path, so they
  // use the same copy with the notes removed (refused in production).
  {
    const L = require("../src/lib/site/legal-readiness") as typeof import("../src/lib/site/legal-readiness");
    L.setLegalCopyForTesting(L.finalizedCopyForTesting());
    // …and every merchant detail the policies name (test values, never real ones).
    const merchantTest: Record<string, string> = {
      MERCHANT_LEGAL_NAME_KA: "ი/მ ტესტი", MERCHANT_LEGAL_NAME_EN: "IE Test", MERCHANT_ENTITY_TYPE: "IE",
      MERCHANT_ID_CODE: "01234567890", MERCHANT_PUBLISH_ID_CODE: "owner-approved",
      MERCHANT_LEGAL_ADDRESS_KA: "თბილისი, ტესტის ქ. 1", MERCHANT_LEGAL_ADDRESS_EN: "1 Test St, Tbilisi", MERCHANT_PUBLISH_LEGAL_ADDRESS: "owner-approved",
      MERCHANT_ACTUAL_ADDRESS_KA: "თბილისი, ტესტის ქ. 2", MERCHANT_ACTUAL_ADDRESS_EN: "2 Test St, Tbilisi",
      MERCHANT_SUPPORT_EMAIL: "support@verify.test", MERCHANT_PHONE: "+995555000000",
      MERCHANT_SUPPORT_HOURS_KA: "ორშ–პარ, 10:00–18:00", MERCHANT_SUPPORT_HOURS_EN: "Mon–Fri, 10:00–18:00",
    };
    for (const [k, v] of Object.entries(merchantTest)) process.env[k] ??= v;
  }
  delete process.env.MERCHANT_PROFILE;
  delete process.env.ALLOW_TEST_PAYMENTS;
  delete process.env.VERCEL;

  const { env } = require("../src/lib/env") as typeof import("../src/lib/env");
  const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
  const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
  const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
  const { getOrCreateCheckoutOrder, checkPaymentReturn, acceptCheckoutTerms, consentTextSha256 } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
  const { CheckoutUnavailableError } = require("../src/lib/payments/checkout-gate") as typeof import("../src/lib/payments/checkout-gate");
  const { refundPaidOrder, findPaymentAnomalies, createPaymentAttempt } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
  const { reconcileOrderRefunds } = require("../src/lib/payments/refunds") as typeof import("../src/lib/payments/refunds");
  const { handleProviderWebhook } = require("../src/lib/payments/webhook") as typeof import("../src/lib/payments/webhook");
  const { runPaymentReconciliation, ReconcileScopeError } = require("../src/lib/payments/reconcile") as typeof import("../src/lib/payments/reconcile");
  const { setPartnerPriceSchema } = require("../src/lib/validation/pricing") as typeof import("../src/lib/validation/pricing");
  const { MIN_PRICE_MINOR } = require("../src/lib/payments/split") as typeof import("../src/lib/payments/split");
  const { PaymentScopeError } = require("../src/lib/payments/scope") as typeof import("../src/lib/payments/scope");
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
  // Explicit 10.00 GEL for the "standard" partner, so the suite does not
  // depend on the database's platform default (a long-lived dev DB may differ).
  const standard = await newPartner(3000, 1000);
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
    const { redirectUrl } = await acceptCheckoutTerms(g.greetingId, g.editToken, "ka");
    const [pay] = await admin`select provider_payment_id from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    return { ...g, orderId: summary.orderId, bogId: pay!.provider_payment_id as string, redirectUrl };
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

  console.log("\n--- 1c. Policies must be in force; consent precedes the bank payment ---");
  {
    const g = await newGreeting();
    process.env.LEGAL_EFFECTIVE_DATE = "";
    const unset = await attempt(() => getOrCreateCheckoutOrder(g.greetingId, g.editToken));
    process.env.LEGAL_EFFECTIVE_DATE = "2999-01-01";
    const future = await attempt(() => getOrCreateCheckoutOrder(g.greetingId, g.editToken));
    process.env.LEGAL_EFFECTIVE_DATE = "2026-01-01";
    check("1c. Without an effective date, or before it, real checkout is closed", !unset.ok && !future.ok && unset.error === new CheckoutUnavailableError().message && future.error === new CheckoutUnavailableError().message);

    const before = bog.calls.length;
    const { summary } = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    const [{ n: attemptsBefore }] = (await admin`select count(*)::int as n from payments where order_id = ${summary.orderId}`) as unknown as [{ n: number }];
    check("1d. Entering checkout opens our order but no BOG payment (no redirect before consent)", attemptsBefore === 0 && bog.calls.filter((c) => c.path === "/ecommerce/orders").length === bog.calls.slice(0, before).filter((c) => c.path === "/ecommerce/orders").length && !("redirectUrl" in summary));

    const { redirectUrl } = await acceptCheckoutTerms(g.greetingId, g.editToken, "en");
    const consents = await admin`select order_id, greeting_id, locale, consent_text_sha256, policies_effective_date::text as d, accepted_at from checkout_consents where order_id = ${summary.orderId}`;
    const [pay] = await admin`select created_at from payments where order_id = ${summary.orderId}`;
    check(
      "1e. Consent is recorded against that order (language, hash of the exact sentence, effective date) before the BOG payment",
      consents.length === 1 && consents[0]!.greeting_id === g.greetingId && consents[0]!.locale === "en" && consents[0]!.consent_text_sha256 === consentTextSha256("en") && consents[0]!.d === "2026-01-01" && !!pay && new Date(consents[0]!.accepted_at as string) <= new Date(pay.created_at as string) && redirectUrl?.startsWith("https://payment.bog.ge/") === true,
      JSON.stringify(consents),
    );
    check("1f. The Georgian and English consent sentences hash differently (the evidence names the language shown)", consentTextSha256("ka") !== consentTextSha256("en"));
    const other = await newGreeting();
    const forged = await attempt(() => acceptCheckoutTerms(other.greetingId, g.editToken, "ka"));
    check("1g. Another greeting's edit token cannot record consent", !forged.ok);
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

  console.log("\n--- 15. Late success refunded through BOG ---");
  {
    const o = await newOrder();
    reject(o.bogId);
    await callback(callbackBody(o.bogId));
    complete(o.bogId); // BOG later reports the same attempt as paid
    const r = await callback(callbackBody(o.bogId));
    const rows = await refundRows(o.orderId);
    check("15a. Refund requested at BOG (INELIGIBLE), order REFUND_REQUIRED, no commission", r.status === 200 && rows[0]?.status === "REQUESTED" && rows[0]?.reason === "INELIGIBLE" && (await orderRow(o.orderId)).status === "REFUND_REQUIRED" && (await ledger(o.orderId)) === "", JSON.stringify({ r, rows, order: (await orderRow(o.orderId)).status }));
    const anomalies = await findPaymentAnomalies(adminUserId);
    check("15b. Not listed for a manual refund while BOG holds it", !anomalies.some((a) => a.kind === "REFUND_PENDING" && a.orderId === o.orderId));
    settleRefund(o.bogId, "completed");
    await callback(callbackBody(o.bogId));
    check("15c. BOG confirms → order REFUNDED, still no commission", (await orderRow(o.orderId)).status === "REFUNDED" && (await ledger(o.orderId)) === "");
  }

  console.log("\n--- 16. Second capture on a PAID order ---");
  {
    const o = await newOrder();
    const reentry = await getOrCreateCheckoutOrder(o.greetingId, o.editToken); // re-entry while BOG's page is open
    const again = await attempt(() => acceptCheckoutTerms(o.greetingId, o.editToken, "en")); // consent again
    check("16-. M1 guard: re-entry waits for the bank, a second consent opens no second BOG payment", reentry.awaitingProvider === true && !again.ok && again.error === "A payment for this card is still being processed");
    // A second charge can still happen outside that guard (an attempt opened
    // before the guard existed, or a race between two tabs): open it directly.
    const [orderFull] = await admin`select o.*, q.public_token from orders o join qr_codes q on q.id = o.qr_code_id where o.id = ${o.orderId}`;
    await createPaymentAttempt(
      { ...orderFull, id: orderFull!.id, grossAmountMinor: orderFull!.gross_amount_minor, currency: orderFull!.currency, productId: orderFull!.product_id, qrCodeId: orderFull!.qr_code_id } as never,
      orderFull!.public_token as string,
    );
    const [second] = await admin`select provider_payment_id from payments where order_id = ${o.orderId} and status = 'PENDING' and provider_payment_id <> ${o.bogId}`;
    const bog2 = second!.provider_payment_id as string;
    complete(o.bogId);
    complete(bog2);
    await callback(callbackBody(o.bogId));
    await callback(callbackBody(bog2));
    const [p2] = await admin`select id, status from payments where provider_payment_id = ${bog2}`;
    const [rf] = await admin`select status, reason from payment_refunds where payment_id = ${p2!.id}`;
    check("16a. Order PAID once, one commission; the second charge's refund is with BOG", (await orderRow(o.orderId)).status === "PAID" && (await ledger(o.orderId)) === "COMMISSION_EARNED:300" && rf?.status === "REQUESTED" && rf?.reason === "DUPLICATE_CAPTURE", JSON.stringify({ p2, rf }));
    const anomalies = await findPaymentAnomalies(adminUserId);
    check("16b. Not listed as an unrefunded DUPLICATE_CAPTURE while in flight", !anomalies.some((a) => a.kind === "DUPLICATE_CAPTURE" && a.orderId === o.orderId));
    settleRefund(bog2, "completed");
    await callback(callbackBody(bog2));
    const [p2after] = await admin`select status from payments where provider_payment_id = ${bog2}`;
    check("16c. BOG confirms → that charge REFUNDED; order stays PAID, commission untouched", p2after?.status === "REFUNDED" && (await orderRow(o.orderId)).status === "PAID" && (await ledger(o.orderId)) === "COMMISSION_EARNED:300");
  }

  console.log("\n--- 17. Staging payment fence (PAYMENTS_SCOPE_PARTNER_ID) ---");
  {
    // Out-of-scope fixtures, made BEFORE the fence (as the simulator did):
    // a PAID order, a pending one, one with a refund stuck REQUESTED, and a
    // greeting with an open order but no consent yet.
    const outPaid = await newOrder();
    complete(outPaid.bogId);
    await callback(callbackBody(outPaid.bogId));
    const outPending = await newOrder();
    const outStuck = await newOrder();
    complete(outStuck.bogId);
    await callback(callbackBody(outStuck.bogId));
    bog.refundFailStatus = 503;
    await refundPaidOrder(adminUserId, outStuck.orderId);
    bog.refundFailStatus = null;
    const outFresh = await newGreeting();
    await getOrCreateCheckoutOrder(outFresh.greetingId, outFresh.editToken);
    const outCallbackOrder = await newOrder();
    complete(outCallbackOrder.bogId);
    // In-scope fixtures (the fenced partner = `custom`).
    const inStale = await newOrder(custom);
    // Both pending attempts look stale (> 30 min) to reconciliation.
    await admin`update payments set created_at = now() - interval '2 hours' where order_id in (${outPending.orderId}, ${inStale.orderId})`;
    complete(inStale.bogId);

    mutableEnv.PAYMENTS_SCOPE_PARTNER_ID = custom.partnerId;
    const counts = async () =>
      (await admin`select (select count(*) from payment_refunds)::int as refunds, (select count(*) from payments)::int as payments, (select count(*) from checkout_consents)::int as consents, (select count(*) from audit_logs)::int as audits`)[0]!;

    const before = await counts();
    const callsBefore = bog.calls.length;
    const refundOut = await attempt(() => refundPaidOrder(adminUserId, outPaid.orderId));
    const reconOut = await attempt(() => reconcileOrderRefunds(outStuck.orderId));
    const verifyOut = await attempt(() => checkPaymentReturn(outPending.greetingId, outPending.editToken));
    const payOut = await attempt(() => acceptCheckoutTerms(outFresh.greetingId, outFresh.editToken, "ka"));
    const after = await counts();
    const scopeMsg = (r: { ok: boolean; error?: string }) => !r.ok && /outside this deployment's payment scope/.test((r as { error: string }).error);
    check("17a. Admin refund of another partner's PAID order: refused, nothing sent to BOG", scopeMsg(refundOut) && !bog.calls.slice(callsBefore).some((c) => c.path.startsWith("/payment/refund/")), JSON.stringify(refundOut));
    check("17b. A refund stuck REQUESTED on another partner's order: not re-sent, BOG not asked", scopeMsg(reconOut), JSON.stringify(reconOut));
    check("17c. The return-page check on another partner's pending order: refused, no receipt lookup", scopeMsg(verifyOut), JSON.stringify(verifyOut));
    check("17d. Pay on another partner's greeting: refused before consent and before any BOG order", scopeMsg(payOut), JSON.stringify(payOut));
    check("17e. …all four made zero BOG calls and zero writes (refunds, payments, consents, audit log)", bog.calls.length === callsBefore && after.refunds === before.refunds && after.payments === before.payments && after.consents === before.consents && after.audits === before.audits, JSON.stringify({ before, after, calls: bog.calls.length - callsBefore }));
    check("17f. The stuck refund is still REQUESTED, the PAID order untouched", (await refundRows(outStuck.orderId))[0]?.status === "REQUESTED" && (await orderRow(outPaid.orderId)).status === "PAID" && (await ledger(outPaid.orderId)) === "COMMISSION_EARNED:300");

    const cbBefore = await counts();
    const cb = await callback(callbackBody(outCallbackOrder.bogId));
    const cbAfter = await counts();
    check("17g. A genuine BOG callback for another partner's order: 400, order still PENDING_PAYMENT, nothing written", cb.status === 400 && (await orderRow(outCallbackOrder.orderId)).status === "PENDING_PAYMENT" && cbAfter.payments === cbBefore.payments && cbAfter.refunds === cbBefore.refunds, JSON.stringify(cb));

    const reconCallsFrom = bog.calls.length;
    const recon = await runPaymentReconciliation(adminUserId, { apply: true });
    const reconCalls = bog.calls.slice(reconCallsFrom);
    const touchedOut = recon.actions.some((a) => [outPending.orderId, outStuck.orderId, outPaid.orderId].includes(a.orderId));
    check("17h. Scoped reconciliation lists only the fenced partner's anomalies", recon.scope?.partnerId === custom.partnerId && recon.anomalies.length > 0 && recon.scope.excluded > 0 && recon.anomalies.every((a) => a.orderId === inStale.orderId), JSON.stringify({ scope: recon.scope, kinds: recon.anomalies.map((a) => a.kind) }));
    check("17i. …and repairs only it: the in-scope stale order is settled from BOG's receipt", !touchedOut && (await orderRow(inStale.orderId)).status === "PAID" && reconCalls.length > 0 && reconCalls.every((c) => c.path === "/token" || c.path.includes(inStale.bogId)) && (await orderRow(outPending.orderId)).status === "PENDING_PAYMENT" && (await refundRows(outStuck.orderId))[0]?.status === "REQUESTED", JSON.stringify({ actions: recon.actions, paths: reconCalls.map((c) => c.path) }));
    const mismatch = await attempt(() => runPaymentReconciliation(adminUserId, { apply: false, partnerId: standard.partnerId }));
    check("17j. Asking reconciliation for a different partner than the fence is refused", !mismatch.ok && mismatch.error === new ReconcileScopeError().message);

    const inPaid = await newOrder(custom);
    complete(inPaid.bogId);
    const inCb = await callback(callbackBody(inPaid.bogId));
    const inRefund = await refundPaidOrder(adminUserId, inPaid.orderId);
    check("17k. The fenced partner's own order still works: callback → PAID, refund sent to BOG (pending)", inCb.status === 200 && inRefund.pending === true && (await refundRows(inPaid.orderId))[0]?.status === "REQUESTED" && bog.calls.some((c) => c.path === `/payment/refund/${inPaid.bogId}`));

    mutableEnv.PAYMENTS_SCOPE_PARTNER_ID = "not-a-partner";
    const garbage = await attempt(() => refundPaidOrder(adminUserId, outPaid.orderId));
    check("17l. A fence that matches no partner refuses everything (fail-closed)", !garbage.ok && garbage.error.includes("payment scope"));
    check("17m. PaymentScopeError is a distinct, named error", new PaymentScopeError("x").name === "PaymentScopeError");
    mutableEnv.PAYMENTS_SCOPE_PARTNER_ID = undefined;
    const unfenced = await runPaymentReconciliation(adminUserId, { apply: false });
    check("17n. Without the fence (production) reconciliation is unscoped, as before", unfenced.scope === undefined && unfenced.anomalies.some((a) => a.orderId === outPending.orderId && a.kind === "STALE_PENDING"));
  }

  console.log("\n--- 18. Minimum-amount lifecycle (1.00 GEL) ---");
  {
    check("18a. The app's price floor is 1.00 GEL; 0.10 GEL is refused by the admin price validation", MIN_PRICE_MINOR === 100 && !setPartnerPriceSchema.safeParse({ amountMinor: 10, expectedAmountMinor: 1000 }).success && setPartnerPriceSchema.safeParse({ amountMinor: 100, expectedAmountMinor: 1000 }).success);
    const minimum = await newPartner(3000, 100);
    const qrStatus = async (greetingId: string) => (await admin`select q.status from qr_codes q join greetings g on g.qr_code_id = q.id where g.id = ${greetingId}`)[0]!.status as string;

    // Success via callback.
    const ok = await newOrder(minimum);
    const create = bog.calls.filter((c) => c.path === "/ecommerce/orders").find((c) => (c.body as { external_order_id: string }).external_order_id === ok.orderId)?.body as { purchase_units: { total_amount: number; basket: { unit_price: number; quantity: number }[] } } | undefined;
    check("18b. Order snapshot 100 = 30 + 70; BOG receives total_amount 1 and unit_price 1 × 1", (await orderRow(ok.orderId)).gross_amount_minor === 100 && (await orderRow(ok.orderId)).partner_commission_minor === 30 && create?.purchase_units.total_amount === 1 && create.purchase_units.basket[0]!.unit_price === 1 && create.purchase_units.basket[0]!.quantity === 1, JSON.stringify(create?.purchase_units));
    complete(ok.bogId);
    const cb = await callback(callbackBody(ok.bogId));
    const cb2 = await callback(callbackBody(ok.bogId));
    check("18c. Success callback → PAID, greeting + QR ACTIVE, one 30 commission; duplicate callback changes nothing", cb.status === 200 && cb2.status === 200 && (await orderRow(ok.orderId)).status === "PAID" && (await greetingStatus(ok.greetingId)) === "ACTIVE" && (await qrStatus(ok.greetingId)) === "ACTIVE" && (await ledger(ok.orderId)) === "COMMISSION_EARNED:30");

    // Full refund, asynchronous at BOG.
    const refundCallsBefore = bog.calls.length;
    const r = await refundPaidOrder(adminUserId, ok.orderId);
    const refundCall = bog.calls.slice(refundCallsBefore).find((c) => c.path === `/payment/refund/${ok.bogId}`);
    check("18d. Full refund sends amount 1 with an Idempotency-Key; pending until BOG confirms; no reversal yet", r.pending === true && (refundCall?.body as { amount: number } | undefined)?.amount === 1 && /^[0-9a-f-]{36}$/.test(refundCall?.headers["idempotency-key"] ?? "") && (await ledger(ok.orderId)) === "COMMISSION_EARNED:30");
    settleRefund(ok.bogId, "completed");
    await callback(callbackBody(ok.bogId));
    check("18e. BOG confirms → REFUNDED, commission reversed exactly once (+30, −30)", (await orderRow(ok.orderId)).status === "REFUNDED" && (await ledger(ok.orderId)) === "COMMISSION_EARNED:30,COMMISSION_REVERSAL:-30");

    // Cancel on BOG's page, then pay again.
    const c = await newOrder(minimum);
    reject(c.bogId);
    await callback(callbackBody(c.bogId));
    check("18f. Cancelled/rejected → order FAILED, no commission, greeting DRAFT", (await orderRow(c.orderId)).status === "FAILED" && (await ledger(c.orderId)) === "" && (await greetingStatus(c.greetingId)) === "DRAFT");
    const retry = await getOrCreateCheckoutOrder(c.greetingId, c.editToken);
    check("18g. …and Pay works again (a new order at the same 100 snapshot)", retry.summary.orderId !== c.orderId && retry.summary.grossAmountMinor === 100);

    // Missed callback: the return-page check settles from the receipt.
    const m = await newOrder(minimum);
    complete(m.bogId);
    const ret = await checkPaymentReturn(m.greetingId, m.editToken);
    check("18h. Missed callback → return-page check settles from BOG's receipt (PAID, activated)", ret.status === "PAID" && ret.activated === true && (await ledger(m.orderId)) === "COMMISSION_EARNED:30");

    // A receipt reporting 0.10 for a 1.00 order is refused.
    const mm = await newOrder(minimum);
    complete(mm.bogId);
    bog.transferOverride.set(mm.bogId, 0.1);
    const mmr = await callback(callbackBody(mm.bogId));
    bog.transferOverride.delete(mm.bogId);
    check("18i. BOG reporting 0.10 for a 1.00 order → refused (400), nothing paid", mmr.status === 400 && (await orderRow(mm.orderId)).status === "PENDING_PAYMENT");
  }

  console.log("\n--- 19. Refund edge cases (M6 readiness) ---");
  {
    const m19 = await newPartner(3000, 100);
    const qrStatus19 = async (greetingId: string) => (await admin`select q.status from qr_codes q join greetings g on g.qr_code_id = q.id where g.id = ${greetingId}`)[0]!.status as string;
    const refundCalls = (bogId: string) => bog.calls.filter((c) => c.path === `/payment/refund/${bogId}`);
    const paidOrder = async () => {
      const o = await newOrder(m19);
      complete(o.bogId);
      await callback(callbackBody(o.bogId));
      return o;
    };

    // Concurrent admin clicks: one refund row, one call to BOG.
    const c = await paidOrder();
    const results = await Promise.allSettled([0, 1, 2].map(() => refundPaidOrder(adminUserId, c.orderId)));
    const rowsC = await refundRows(c.orderId);
    check("19a. Three concurrent refund requests → ONE refund row, ONE call to BOG (one bank refund action), none failed",
      results.every((r) => r.status === "fulfilled") && rowsC.length === 1 && refundCalls(c.bogId).length === 1,
      JSON.stringify({ results: results.map((r) => r.status === "fulfilled" ? r.value : String(r.reason)), rows: rowsC.length, calls: refundCalls(c.bogId).length }));

    // BOG accepts the refund but the answer is lost (timeout after bank-side success).
    const t = await paidOrder();
    bog.refundLoseResponseStatus = 504;
    const lost = await attempt(() => refundPaidOrder(adminUserId, t.orderId));
    bog.refundLoseResponseStatus = null;
    const rowsT = await refundRows(t.orderId);
    check("19b. Bank accepted, answer lost → refund REQUESTED (not failed, not done), order still PAID, commission untouched",
      lost.ok && rowsT.length === 1 && rowsT[0]!.status === "REQUESTED" && (await orderRow(t.orderId)).status === "PAID" && (await ledger(t.orderId)) === "COMMISSION_EARNED:30",
      JSON.stringify({ lost, rowsT }));
    const callsT0 = refundCalls(t.bogId).length;
    const cT = await reconcileOrderRefunds(t.orderId);
    check("19c. Reconciliation sees BOG's refund_requested and does NOT send a second refund", cT.pending === 1 && refundCalls(t.bogId).length === callsT0, JSON.stringify(cT));
    settleRefund(t.bogId, "completed");
    const doneT = await reconcileOrderRefunds(t.orderId);
    check("19d. …BOG completes it (transfer_amount now 0) → REFUNDED, commission reversed once, no callback needed",
      doneT.completed === 1 && (await orderRow(t.orderId)).status === "REFUNDED" && (await ledger(t.orderId)) === "COMMISSION_EARNED:30,COMMISSION_REVERSAL:-30");
    const cbT = await callback(callbackBody(t.bogId));
    check("19e. A late refund callback afterwards changes nothing (200, same ledger)", cbT.status === 200 && (await ledger(t.orderId)) === "COMMISSION_EARNED:30,COMMISSION_REVERSAL:-30");
    check("19f. After the refund the greeting and QR are kept (not deleted; product rule: stays live)",
      (await greetingStatus(t.greetingId)) === "ACTIVE" && (await qrStatus19(t.greetingId)) === "ACTIVE");
    check("19g. A refunded order can't be refunded again (no BOG call)",
      (await refundPaidOrder(adminUserId, t.orderId)).alreadyRefunded === true && refundCalls(t.bogId).length === callsT0);

    // Accepted, answer lost, and the automatic retry is answered 409 (conflict while in flight).
    const k = await paidOrder();
    bog.refundLoseFirstAnswer = true;
    bog.refundRepeatStatus = 409;
    const callsK0 = bog.calls.filter((c) => c.path === `/payment/refund/${k.bogId}`).length;
    const firstTry = await attempt(() => refundPaidOrder(adminUserId, k.orderId));
    bog.refundLoseFirstAnswer = false;
    bog.refundRepeatStatus = null;
    check("19l0. (setup) the client retried the same key after the lost answer", bog.calls.filter((c) => c.path === `/payment/refund/${k.bogId}`).length >= callsK0 + 2);
    const rowsK = await refundRows(k.orderId);
    check("19l. Bank accepted, answer lost, retry answered 409 → NOT rejected: kept REQUESTED (the receipt shows refund_requested)",
      rowsK.length === 1 && rowsK[0]!.status === "REQUESTED" && (await orderRow(k.orderId)).status === "PAID" &&
      !(await findPaymentAnomalies(adminUserId)).some((a) => a.kind === "REFUND_REJECTED" && a.orderId === k.orderId), JSON.stringify({ firstTry, rowsK }));
    settleRefund(k.bogId, "completed");
    await callback(callbackBody(k.bogId));
    check("19m. …then BOG's callback completes it: REFUNDED, commission reversed once", (await orderRow(k.orderId)).status === "REFUNDED" && (await ledger(k.orderId)) === "COMMISSION_EARNED:30,COMMISSION_REVERSAL:-30");

    // Worst case: answer lost, retry answered 409, AND the receipt lags (shows no refund yet).
    const lag = await paidOrder();
    bog.refundLoseFirstAnswer = true;
    bog.refundRepeatStatus = 409;
    bog.receiptHidesPendingRefund = true;
    const lagTry = await attempt(() => refundPaidOrder(adminUserId, lag.orderId));
    const lagRows = await refundRows(lag.orderId);
    check("19o. Lost answer + 409 retry + lagging receipt → still REQUESTED (an uncertain answer is never a final REJECTED)",
      lagRows.length === 1 && lagRows[0]!.status === "REQUESTED" && (await orderRow(lag.orderId)).status === "PAID", JSON.stringify({ lagTry, lagRows }));
    bog.refundLoseFirstAnswer = false;
    bog.refundRepeatStatus = null;
    bog.receiptHidesPendingRefund = false;
    const lagCalls0 = bog.calls.filter((c) => c.path === `/payment/refund/${lag.bogId}`).length;
    const lagRec = await reconcileOrderRefunds(lag.orderId);
    check("19p. …reconciliation then sees refund_requested and sends nothing new", lagRec.pending === 1 && bog.calls.filter((c) => c.path === `/payment/refund/${lag.bogId}`).length === lagCalls0);
    settleRefund(lag.bogId, "completed");
    await reconcileOrderRefunds(lag.orderId);
    const lagMoney = bog.orders.get(lag.bogId)!.actions.filter((a) => a.action === "refund").length;
    check("19q. …completes once: REFUNDED, one reversal, and BOG holds exactly ONE refund action for the order",
      (await orderRow(lag.orderId)).status === "REFUNDED" && (await ledger(lag.orderId)) === "COMMISSION_EARNED:30,COMMISSION_REVERSAL:-30" && lagMoney === 1);

    // A genuine refusal (bank holds no refund) is still REJECTED.
    const g = await paidOrder();
    bog.refundFailStatus = 400;
    const gr = await attempt(() => refundPaidOrder(adminUserId, g.orderId));
    bog.refundFailStatus = null;
    check("19n. A real refusal (no refund at the bank) → REJECTED and listed REFUND_REJECTED",
      !gr.ok && (await refundRows(g.orderId))[0]!.status === "REJECTED" && (await findPaymentAnomalies(adminUserId)).some((a) => a.kind === "REFUND_REJECTED" && a.orderId === g.orderId));

    // The bank shows a status this integration doesn't know (e.g. a reversal reported differently).
    const u = await paidOrder();
    await refundPaidOrder(adminUserId, u.orderId);
    const callsU0 = refundCalls(u.bogId).length;
    bog.orders.get(u.bogId)!.status = "reversed_unknown";
    const cU = await reconcileOrderRefunds(u.orderId);
    const cbU = await callback(callbackBody(u.bogId));
    check("19h. Unknown bank status after a refund request: nothing booked, nothing re-sent, refund stays REQUESTED",
      cU.pending === 1 && cbU.status === 200 && refundCalls(u.bogId).length === callsU0 && (await refundRows(u.orderId))[0]!.status === "REQUESTED" &&
      (await orderRow(u.orderId)).status === "PAID" && (await ledger(u.orderId)) === "COMMISSION_EARNED:30", JSON.stringify({ cU, cb: cbU.status }));
    await admin.begin(async (t) => {
      // Fixture only: pretend the request is 2 h old (the integrity trigger forbids this for real).
      await t`set local session_replication_role = replica`;
      await t`update payment_refunds set requested_at = now() - interval '2 hours' where order_id = ${u.orderId}`;
    });
    check("19i. …and after 1 h it is listed for a person (REFUND_AWAITING_PROVIDER)",
      (await findPaymentAnomalies(adminUserId)).some((a) => a.kind === "REFUND_AWAITING_PROVIDER" && a.orderId === u.orderId));

    // Wrong BOG order id: the refund goes only to the charge's own provider id.
    const w = await paidOrder();
    const before = bog.calls.length;
    const refundTotal0 = bog.calls.filter((x) => x.path.startsWith("/payment/refund/")).length;
    await refundPaidOrder(adminUserId, w.orderId);
    const sent = bog.calls.slice(before).filter((x) => x.path.startsWith("/payment/refund/"));
    check("19j. The refund is addressed to exactly this order's BOG id (amount 1)",
      sent.length === 1 && sent[0]!.path === `/payment/refund/${w.bogId}` && (sent[0]!.body as { amount: number }).amount === 1);
    check("19k. Refund of an unknown order id is refused before BOG is called",
      !(await attempt(() => refundPaidOrder(adminUserId, crypto.randomUUID()))).ok && bog.calls.filter((x) => x.path.startsWith("/payment/refund/")).length === refundTotal0 + 1);
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

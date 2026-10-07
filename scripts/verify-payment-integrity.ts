import Module from "node:module";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { getOrCreateCheckoutOrder } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
const { updateGreetingMessage, updateGreetingTheme } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { loadActiveGreetingForRecipient } = require("../src/lib/greetings/recipient") as typeof import("../src/lib/greetings/recipient");
const { getTemplate } = require("../src/lib/templates/catalog") as typeof import("../src/lib/templates/catalog");
const { signTestWebhook, TEST_WEBHOOK_SIGNATURE_HEADER } = require("../src/lib/payments/providers/test-provider") as typeof import("../src/lib/payments/providers/test-provider");
const { confirmPaymentSuccess, settleConfirmedPayment, markPaymentFailed, activatePaidOrder, findPaymentAnomalies, refundPaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");

/**
 * Money-path integrity beyond the happy path: every successful charge the
 * provider reports is recorded truthfully and ends in exactly one of
 * "this order's payment" or "returned to the customer" — never silently
 * dropped, never a second commission, never an activation on a provider
 * outcome other than success. Complements verify-phase5-security.ts
 * (amount mismatch, order hijack, duplicate webhook, return/webhook race).
 *
 *  1. A second successful charge on an already-PAID order (two live provider
 *     sessions, e.g. two tabs) is recorded and refunded; one commission.
 *  2. A success arriving after the order was marked FAILED (the customer was
 *     told it failed) is recorded and returned — no commission, no activation.
 *  3. A success for an older order when the greeting is already PAID through
 *     another order is recorded and refunded (REFUND_REQUIRED → REFUNDED).
 *  4. Two simultaneous checkouts for one greeting create one order.
 *  5. Webhook: a provider-reported FAILED never marks PAID or books
 *     commission; PENDING changes nothing; SUCCEEDED pays once; a duplicate
 *     changes nothing; PAYMENT_SUCCEEDED analytics is recorded exactly once.
 *  6. Webhook: success for the wrong amount/currency is rejected, changes
 *     nothing, and leaves an audit trail for reconciliation.
 *  7. Reconciliation report: lists captured-but-unresolved money; a clean
 *     paid order is not listed.
 *  8. Concurrency: five simultaneous checkouts → one order; five simultaneous
 *     identical success webhooks → one PAID, one commission, one
 *     PAYMENT_SUCCEEDED; a success racing a failure → paid exactly once.
 *  9. A FAILED notification after the SUCCEEDED one changes nothing.
 * 10. Refund: two simultaneous admin refunds → one REFUNDED, one reversal;
 *     history kept (earned + reversal, nothing deleted).
 * 11. Authorization: another greeting's edit token opens no checkout; a
 *     forged webhook signature is rejected without effect.
 * 12. Theme version: recorded at creation and on every theme choice, frozen
 *     once the greeting is paid and active, and what the recipient loads.
 */

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const webhookSecret = process.env.TEST_PAYMENTS_WEBHOOK_SECRET;
if (!webhookSecret) throw new Error("TEST_PAYMENTS_WEBHOOK_SECRET is required");
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

async function main() {
  console.log("Setting up fixtures (superuser)...");
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const adminUserId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"pi-" + partnerId.slice(0, 8)}, 'Payment Integrity Partner', 3000, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'payment-integrity', 20)`;
  await admin`insert into admin_users (user_id) values (${adminUserId})`;

  async function newGreeting() {
    const id = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${id}, ${token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    await updateGreetingMessage(greetingId, editToken, "Payment integrity test message");
    return { greetingId, editToken, qrId: id };
  }
  async function newOrder() {
    const g = await newGreeting();
    const { summary } = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    const [p] = await admin`select provider_payment_id, amount_minor, currency from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    return { ...g, orderId: summary.orderId, providerPaymentId: p!.provider_payment_id as string, amountMinor: p!.amount_minor as number, currency: p!.currency as string };
  }
  /** A fresh provider-side charge id for the same order (the TEST provider encodes amount + currency in it, as a real provider would report them). */
  const anotherCharge = (amountMinor: number, currency: string) => `test_${amountMinor}_${currency}_${crypto.randomUUID()}`;
  const commissions = async (orderId: string) => (await admin`select count(*)::int as n from partner_ledger_entries where order_id = ${orderId} and type = 'COMMISSION_EARNED'`)[0]!.n as number;

  console.log("\n--- 1. Second successful charge on a PAID order ---");
  {
    const o = await newOrder();
    await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: o.providerPaymentId, orderId: o.orderId, amountMinor: o.amountMinor, currency: o.currency });
    const second = anotherCharge(o.amountMinor, o.currency);
    // As every caller does: confirm, then settle (refunds / activation).
    const r = await attempt(async () => settleConfirmedPayment(await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: second, orderId: o.orderId, amountMinor: o.amountMinor, currency: o.currency })));
    check("1a. A second success for a PAID order is handled, not an error", r.ok, r.ok ? undefined : r.error);
    const [row] = await admin`select status from payments where provider = 'TEST' and provider_payment_id = ${second}`;
    check("1b. The second charge is recorded (never silently dropped)", !!row);
    check("1c. …and returned to the customer (REFUNDED)", row?.status === "REFUNDED", `status=${row?.status}`);
    const [order] = await admin`select status from orders where id = ${o.orderId}`;
    check("1d. The order stays PAID", order?.status === "PAID");
    check("1e. Exactly one commission", (await commissions(o.orderId)) === 1);
  }

  console.log("\n--- 2. Success after the order was marked FAILED ---");
  {
    const o = await newOrder();
    await markPaymentFailed(o.orderId);
    const r = await attempt(async () => settleConfirmedPayment(await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: o.providerPaymentId, orderId: o.orderId, amountMinor: o.amountMinor, currency: o.currency })));
    check("2a. A late success on a FAILED order is handled, not an error", r.ok, r.ok ? undefined : r.error);
    const [order] = await admin`select status from orders where id = ${o.orderId}`;
    const [pay] = await admin`select status from payments where provider_payment_id = ${o.providerPaymentId}`;
    const [g] = await admin`select status from greetings where id = ${o.greetingId}`;
    check("2b. The charge is recorded and returned (order + charge REFUNDED)", order?.status === "REFUNDED" && pay?.status === "REFUNDED", `order=${order?.status} payment=${pay?.status}`);
    check("2c. No commission, nothing activated", (await commissions(o.orderId)) === 0 && g?.status === "DRAFT");
    const retry = await getOrCreateCheckoutOrder(o.greetingId, o.editToken);
    check("2d. The customer can simply pay again (a new order)", retry.summary.orderId !== o.orderId && retry.summary.status === "PENDING_PAYMENT");
  }

  console.log("\n--- 3. Success for an older order when the greeting is already PAID ---");
  {
    const g = await newGreeting();
    const first = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    const [p1] = await admin`select provider_payment_id, amount_minor, currency from payments where order_id = ${first.summary.orderId}`;
    await markPaymentFailed(first.summary.orderId);
    const second = await getOrCreateCheckoutOrder(g.greetingId, g.editToken); // a new order after the failure
    const [p2] = await admin`select provider_payment_id from payments where order_id = ${second.summary.orderId}`;
    await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: p2!.provider_payment_id, orderId: second.summary.orderId, amountMinor: p1!.amount_minor, currency: p1!.currency });
    // …and only now does the first attempt's charge turn out to have succeeded.
    const r = await attempt(async () => settleConfirmedPayment(await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: p1!.provider_payment_id, orderId: first.summary.orderId, amountMinor: p1!.amount_minor, currency: p1!.currency })));
    check("3a. Handled, not an error", r.ok, r.ok ? undefined : r.error);
    const [o1] = await admin`select status from orders where id = ${first.summary.orderId}`;
    const [pay1] = await admin`select status from payments where provider_payment_id = ${p1!.provider_payment_id}`;
    check("3b. The older order is refunded, not paid", o1?.status === "REFUNDED", `status=${o1?.status}`);
    check("3c. Its charge is recorded and REFUNDED", pay1?.status === "REFUNDED", `status=${pay1?.status}`);
    check("3d. No commission for it; one for the paid order", (await commissions(first.summary.orderId)) === 0 && (await commissions(second.summary.orderId)) === 1);
  }

  console.log("\n--- 4. Two simultaneous checkouts for one greeting ---");
  {
    const g = await newGreeting();
    const results = await Promise.allSettled([getOrCreateCheckoutOrder(g.greetingId, g.editToken), getOrCreateCheckoutOrder(g.greetingId, g.editToken)]);
    const [countRow] = await admin`select count(*)::int as n from orders where greeting_id = ${g.greetingId}`;
    const n = countRow!.n as number;
    check("4a. Exactly one order is created", n === 1, `orders=${n}`);
    check("4b. Both requests get the checkout (neither fails)", results.every((r) => r.status === "fulfilled"), results.map((r) => r.status).join(","));
  }

  const { POST } = await import("../src/app/api/webhooks/payments/[provider]/route");
  const { NextRequest } = await import("next/server");
  async function webhook(body: Record<string, unknown>) {
    const raw = JSON.stringify(body);
    const req = new NextRequest("http://localhost/api/webhooks/payments/TEST", { method: "POST", body: raw, headers: { [TEST_WEBHOOK_SIGNATURE_HEADER]: signTestWebhook(raw, webhookSecret!) } });
    return (await POST(req, { params: Promise.resolve({ provider: "TEST" }) })).status;
  }
  const paymentSucceededEvents = async (orderId: string) => (await admin`select count(*)::int as n from analytics_events where metadata->>'orderId' = ${orderId} and event_type = 'PAYMENT_SUCCEEDED'`)[0]!.n as number;

  console.log("\n--- 5. Webhook honours the provider's reported outcome ---");
  {
    const o = await newOrder();
    const failedStatus = await webhook({ orderId: o.orderId, providerPaymentId: o.providerPaymentId, status: "FAILED" });
    const [afterFail] = await admin`select status from orders where id = ${o.orderId}`;
    const [payFail] = await admin`select status from payments where provider_payment_id = ${o.providerPaymentId}`;
    check("5a. A FAILED notification is acknowledged (200)", failedStatus === 200, `http ${failedStatus}`);
    check("5b. …never marks the order PAID", afterFail?.status !== "PAID", `status=${afterFail?.status}`);
    check("5c. …books no commission", (await commissions(o.orderId)) === 0);
    check("5d. …records the attempt as FAILED", payFail?.status === "FAILED", `payment=${payFail?.status}`);

    const p = await newOrder();
    const pendingStatus = await webhook({ orderId: p.orderId, providerPaymentId: p.providerPaymentId, status: "PENDING" });
    const [afterPending] = await admin`select status from orders where id = ${p.orderId}`;
    check("5e. A PENDING notification is acknowledged and changes nothing", pendingStatus === 200 && afterPending?.status === "PENDING_PAYMENT", `http ${pendingStatus}, status=${afterPending?.status}`);

    const okStatus = await webhook({ orderId: p.orderId, providerPaymentId: p.providerPaymentId, status: "SUCCEEDED" });
    const dupStatus = await webhook({ orderId: p.orderId, providerPaymentId: p.providerPaymentId, status: "SUCCEEDED" });
    const [afterOk] = await admin`select status from orders where id = ${p.orderId}`;
    const [greeting] = await admin`select status from greetings where id = ${p.greetingId}`;
    check("5f. SUCCEEDED pays and activates", okStatus === 200 && afterOk?.status === "PAID" && greeting?.status === "ACTIVE");
    check("5g. A duplicate SUCCEEDED is harmless (200, one commission)", dupStatus === 200 && (await commissions(p.orderId)) === 1);
    check("5h. PAYMENT_SUCCEEDED analytics recorded exactly once on the webhook path", (await paymentSucceededEvents(p.orderId)) === 1, `events=${await paymentSucceededEvents(p.orderId)}`);
  }

  console.log("\n--- 6. Webhook success for the wrong amount / currency ---");
  {
    const o = await newOrder();
    const wrongAmount = anotherCharge(o.amountMinor + 1, o.currency);
    await admin`update payments set provider_payment_id = ${wrongAmount} where provider_payment_id = ${o.providerPaymentId}`;
    const status = await webhook({ orderId: o.orderId, providerPaymentId: wrongAmount, status: "SUCCEEDED" });
    const [order] = await admin`select status from orders where id = ${o.orderId}`;
    const [g] = await admin`select status from greetings where id = ${o.greetingId}`;
    check("6a. Rejected", status === 400, `http ${status}`);
    check("6b. Nothing paid, booked or activated", order?.status === "PENDING_PAYMENT" && g?.status === "DRAFT" && (await commissions(o.orderId)) === 0);
    const [audit] = await admin`select action from audit_logs where target_id = ${o.orderId} and action = 'PAYMENT_AMOUNT_MISMATCH'`;
    check("6c. The mismatch leaves an audit trail for reconciliation", !!audit);

    const c = await newOrder();
    const wrongCurrency = anotherCharge(c.amountMinor, "USD");
    await admin`update payments set provider_payment_id = ${wrongCurrency} where provider_payment_id = ${c.providerPaymentId}`;
    const cStatus = await webhook({ orderId: c.orderId, providerPaymentId: wrongCurrency, status: "SUCCEEDED" });
    const [cOrder] = await admin`select status from orders where id = ${c.orderId}`;
    check("6d. Wrong currency rejected, nothing paid", cStatus === 400 && cOrder?.status === "PENDING_PAYMENT");
  }

  console.log("\n--- 7. Reconciliation report ---");
  {
    const anomalies = await findPaymentAnomalies(adminUserId);
    const o = await newOrder();
    await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: o.providerPaymentId, orderId: o.orderId, amountMinor: o.amountMinor, currency: o.currency });
    await activatePaidOrder(o.orderId);
    const after = await findPaymentAnomalies(adminUserId);
    check("7a. The report runs", Array.isArray(anomalies));
    check("7b. A clean paid + activated order is not listed", !after.some((a: { orderId: string }) => a.orderId === o.orderId));
    // A captured charge the app could not resolve (simulated: a SUCCEEDED payment on a FAILED order).
    const s = await newOrder();
    await markPaymentFailed(s.orderId);
    await admin`update payments set status = 'SUCCEEDED', confirmed_at = now() where provider_payment_id = ${s.providerPaymentId}`;
    const listed = await findPaymentAnomalies(adminUserId);
    check("7c. A captured charge on an unpaid order is listed", listed.some((a: { orderId: string; kind: string }) => a.orderId === s.orderId && a.kind === "CAPTURED_NOT_APPLIED"));
  }

  console.log("\n--- 8. Concurrency ---");
  {
    const g = await newGreeting();
    const many = await Promise.allSettled(Array.from({ length: 5 }, () => getOrCreateCheckoutOrder(g.greetingId, g.editToken)));
    const [c] = await admin`select count(*)::int as n from orders where greeting_id = ${g.greetingId}`;
    check("8a. Five simultaneous checkouts → one order, every request served", c!.n === 1 && many.every((r) => r.status === "fulfilled"), `orders=${c!.n}`);

    const o = await newOrder();
    const statuses = await Promise.all(Array.from({ length: 5 }, () => webhook({ orderId: o.orderId, providerPaymentId: o.providerPaymentId, status: "SUCCEEDED" })));
    const [order] = await admin`select status from orders where id = ${o.orderId}`;
    check("8b. Five simultaneous identical success webhooks → all 200, PAID once", statuses.every((x) => x === 200) && order?.status === "PAID", statuses.join(","));
    check("8c. …one commission, one PAYMENT_SUCCEEDED event", (await commissions(o.orderId)) === 1 && (await paymentSucceededEvents(o.orderId)) === 1);

    const r = await newOrder();
    await Promise.all([
      webhook({ orderId: r.orderId, providerPaymentId: r.providerPaymentId, status: "SUCCEEDED" }),
      webhook({ orderId: r.orderId, providerPaymentId: r.providerPaymentId, status: "FAILED" }),
    ]);
    const [raced] = await admin`select status from orders where id = ${r.orderId}`;
    const [racedPay] = await admin`select status from payments where provider_payment_id = ${r.providerPaymentId}`;
    const n = await commissions(r.orderId);
    // Whichever the provider's notifications land in: paid once, or returned — never both, never lost.
    const paidOnce = raced?.status === "PAID" && racedPay?.status === "SUCCEEDED" && n === 1;
    const returned = raced?.status === "REFUNDED" && racedPay?.status === "REFUNDED" && n === 0;
    check("8d. A success racing a failure: paid exactly once, or recorded and returned", paidOnce || returned, `order=${raced?.status} payment=${racedPay?.status} commissions=${n}`);
  }

  console.log("\n--- 9. Out-of-order: FAILED after SUCCEEDED ---");
  {
    const o = await newOrder();
    await webhook({ orderId: o.orderId, providerPaymentId: o.providerPaymentId, status: "SUCCEEDED" });
    const late = await webhook({ orderId: o.orderId, providerPaymentId: o.providerPaymentId, status: "FAILED" });
    const [order] = await admin`select status from orders where id = ${o.orderId}`;
    const [pay] = await admin`select status from payments where provider_payment_id = ${o.providerPaymentId}`;
    const [g] = await admin`select status from greetings where id = ${o.greetingId}`;
    check("9a. Acknowledged, and nothing is downgraded", late === 200 && order?.status === "PAID" && pay?.status === "SUCCEEDED" && g?.status === "ACTIVE");
  }

  console.log("\n--- 10. Refund ---");
  {
    const o = await newOrder();
    await webhook({ orderId: o.orderId, providerPaymentId: o.providerPaymentId, status: "SUCCEEDED" });
    const both = await Promise.allSettled([refundPaidOrder(adminUserId, o.orderId), refundPaidOrder(adminUserId, o.orderId)]);
    const [order] = await admin`select status from orders where id = ${o.orderId}`;
    const ledger = await admin`select type, amount_minor from partner_ledger_entries where order_id = ${o.orderId} order by created_at`;
    check("10a. Two simultaneous refunds: the order is REFUNDED", order?.status === "REFUNDED", both.map((b) => b.status).join(","));
    check("10b. …exactly one reversal, the earned entry kept (history intact)", ledger.length === 2 && ledger.filter((l) => l.type === "COMMISSION_EARNED").length === 1 && ledger.filter((l) => l.type === "COMMISSION_REVERSAL").length === 1);
    check("10c. …the reversal is the exact negated commission", ledger[0]!.amount_minor === -ledger[1]!.amount_minor);
    const again = await refundPaidOrder(adminUserId, o.orderId);
    check("10d. A later repeat reports alreadyRefunded, changes nothing", again.alreadyRefunded === true);
  }

  console.log("\n--- 11. Authorization ---");
  {
    const a = await newGreeting();
    const b = await newGreeting();
    const crossed = await attempt(() => getOrCreateCheckoutOrder(a.greetingId, b.editToken));
    const [c] = await admin`select count(*)::int as n from orders where greeting_id = ${a.greetingId}`;
    check("11a. Another greeting's edit token opens no checkout", !crossed.ok && c!.n === 0);

    const o = await newOrder();
    const raw = JSON.stringify({ orderId: o.orderId, providerPaymentId: o.providerPaymentId, status: "SUCCEEDED" });
    const forged = new NextRequest("http://localhost/api/webhooks/payments/TEST", { method: "POST", body: raw, headers: { [TEST_WEBHOOK_SIGNATURE_HEADER]: signTestWebhook(raw, "not-the-secret") } });
    const forgedStatus = (await POST(forged, { params: Promise.resolve({ provider: "TEST" }) })).status;
    const [order] = await admin`select status from orders where id = ${o.orderId}`;
    check("11b. A forged webhook signature is rejected (400) without effect", forgedStatus === 400 && order?.status === "PENDING_PAYMENT", `http ${forgedStatus}`);
  }

  console.log("\n--- 12. Theme version ---");
  {
    const g = await newGreeting();
    const [created] = await admin`select theme_version from greetings where id = ${g.greetingId}`;
    check("12a. Recorded at creation (the default template's version)", created?.theme_version === getTemplate("minimal")!.version);
    await updateGreetingTheme(g.greetingId, g.editToken, "wedding");
    const [chosen] = await admin`select theme_version from greetings where id = ${g.greetingId}`;
    check("12b. Recorded when the theme is chosen", chosen?.theme_version === getTemplate("wedding")!.version);
    const { summary } = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    const [pay] = await admin`select provider_payment_id from payments where order_id = ${summary.orderId}`;
    await webhook({ orderId: summary.orderId, providerPaymentId: pay!.provider_payment_id, status: "SUCCEEDED" });
    const change = await attempt(() => updateGreetingTheme(g.greetingId, g.editToken, "birthday"));
    const [frozen] = await admin`select theme_version, (select key from themes where id = theme_id) as key from greetings where id = ${g.greetingId}`;
    check("12c. Frozen once active (no theme change after payment)", !change.ok && frozen?.key === "wedding");
    const loaded = await loadActiveGreetingForRecipient(g.greetingId);
    check("12d. The recipient loads that exact version", loaded.themeKey === "wedding" && loaded.themeVersion === frozen?.theme_version);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await admin.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await admin.end();
  process.exit(1);
});

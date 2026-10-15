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
const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { getOrCreateCheckoutOrder } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
const { confirmPaymentSuccess, settleConfirmedPayment, findPaymentAnomalies } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { recordChargeback, ChargebackError } = require("../src/lib/payments/refunds") as typeof import("../src/lib/payments/refunds");
const { getDisputeEvidence } = require("../src/lib/payments/dispute-evidence") as typeof import("../src/lib/payments/dispute-evidence");
const { recordChargebackSchema } = require("../src/lib/validation/chargebacks") as typeof import("../src/lib/validation/chargebacks");
const { withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
const { getPartnerPayoutStatement, recordManualPayout } = require("../src/lib/payments/payouts") as typeof import("../src/lib/payments/payouts");

/**
 * Chargeback administration (BOG plan §3.7; recommended decisions B5/B6).
 * Provider-independent: a chargeback is money the bank already returned, so
 * nothing is sent to any provider.
 *
 *  1. Recording one on a PAID order: charge + order REFUNDED, one CHARGEBACK
 *     refund row (COMPLETED, with the bank reference), the order's own
 *     snapshot commission reversed exactly once, audited; greeting stays live.
 *  2. Refused for an order that is not PAID (a second record, an unpaid order).
 *  3. Refused while a provider refund for the charge is open.
 *  4. Two simultaneous records → exactly one chargeback, one reversal.
 *  5. Only a platform admin can record one.
 *  6. After a payout: the reversal is netted into the next payout (CLAWBACK).
 *  7. Evidence pack: charge, delivery and recipient views — and no greeting
 *     content.
 *  8. Input validation: reference required; no future date.
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
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e };
  }
}
const tick = () => new Promise((r) => setTimeout(r, 20));
const MESSAGE = `Chargeback suite secret message ${crypto.randomUUID()}`;

async function main() {
  console.log("Setting up fixtures (superuser)...");
  const adminUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING'`;

  async function newPartner() {
    const partnerId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"cb-" + partnerId.slice(0, 8)}, 'Chargeback Partner', 3000, 'ACTIVE')`;
    await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'chargebacks', 50)`;
    // Explicit 10.00 GEL so the suite does not depend on the platform default.
    await admin`insert into prices (product_id, partner_id, currency, amount_minor, active) values (${product!.id}, ${partnerId}, 'GEL', 1000, true)`;
    return { partnerId, batchId };
  }
  const P = await newPartner();

  /** A paid, activated sale through the TEST provider (no refund ever sent to it here). */
  async function sale(p = P) {
    const qrId = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${p.batchId}, ${p.partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    await updateGreetingMessage(greetingId, editToken, MESSAGE);
    const { summary } = await getOrCreateCheckoutOrder(greetingId, editToken);
    const [pay] = await admin`select provider_payment_id, amount_minor, currency from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    await settleConfirmedPayment(
      await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: pay!.provider_payment_id, orderId: summary.orderId, amountMinor: pay!.amount_minor, currency: pay!.currency }),
    );
    return { orderId: summary.orderId, greetingId, editToken, qrId };
  }
  const ledger = async (orderId: string) =>
    (await admin`select type, amount_minor from partner_ledger_entries where order_id = ${orderId} order by created_at`).map((r) => `${r.type}:${r.amount_minor}`).join(",");
  const orderStatus = async (orderId: string) => (await admin`select status from orders where id = ${orderId}`)[0]!.status as string;
  const input = (reference = `CB-${crypto.randomUUID().slice(0, 8)}`) => ({ reference, disputedOn: new Date().toISOString().slice(0, 10) });

  console.log("\n--- 1. Record a chargeback on a PAID order ---");
  const s1 = await sale();
  {
    const ref = `BOG-DISPUTE-${crypto.randomUUID().slice(0, 6)}`;
    const r = await recordChargeback(adminUserId, s1.orderId, { ...input(ref), note: "Cardholder says not received" });
    const [rf] = await admin`select reason, status, provider_action_id, requested_by, amount_minor from payment_refunds where order_id = ${s1.orderId}`;
    const [pay] = await admin`select status from payments where order_id = ${s1.orderId} and provider = 'TEST'`;
    check("1a. Order and charge REFUNDED", (await orderStatus(s1.orderId)) === "REFUNDED" && pay?.status === "REFUNDED");
    check("1b. One CHARGEBACK refund row, COMPLETED, full amount, bank reference and admin recorded", rf?.reason === "CHARGEBACK" && rf.status === "COMPLETED" && rf.provider_action_id === ref && rf.requested_by === adminUserId && rf.amount_minor === 1000, JSON.stringify(rf));
    check("1c. The order's own commission reversed exactly once (+300, −300)", (await ledger(s1.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300" && r.commissionReversedMinor === 300, await ledger(s1.orderId));
    const audits = await admin`select action from audit_logs where target_id = ${s1.orderId} and action in ('PAYMENT_CHARGEBACK_RECORDED', 'ORDER_CHARGED_BACK', 'PAYMENT_REFUND_REQUESTED')`;
    check("1d. Audited (recorded + charged back); no refund was ever requested from a provider", audits.filter((a) => a.action === "PAYMENT_CHARGEBACK_RECORDED").length === 1 && audits.filter((a) => a.action === "ORDER_CHARGED_BACK").length === 1 && !audits.some((a) => a.action === "PAYMENT_REFUND_REQUESTED"));
    const [g] = await admin`select status from greetings where id = ${s1.greetingId}`;
    check("1e. The greeting stays live (moderation is a separate decision)", g?.status === "ACTIVE");
    const anomalies = await findPaymentAnomalies(adminUserId);
    check("1f. Leaves no payment anomaly behind", !anomalies.some((a) => a.orderId === s1.orderId), JSON.stringify(anomalies.filter((a) => a.orderId === s1.orderId)));
  }

  console.log("\n--- 2. Only PAID orders ---");
  {
    const again = await attempt(() => recordChargeback(adminUserId, s1.orderId, input()));
    check("2a. A second chargeback on the same order is refused (ORDER_NOT_PAID), ledger unchanged", !again.ok && again.error instanceof ChargebackError && again.error.code === "ORDER_NOT_PAID" && (await ledger(s1.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300");
    const qrId = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${P.batchId}, ${P.partnerId}, 'AVAILABLE')`;
    const g = await startGreeting(token);
    await updateGreetingMessage(g.greetingId, g.editToken, MESSAGE);
    const { summary } = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    const unpaid = await attempt(() => recordChargeback(adminUserId, summary.orderId, input()));
    check("2b. An unpaid (PENDING_PAYMENT) order is refused", !unpaid.ok && unpaid.error instanceof ChargebackError && unpaid.error.code === "ORDER_NOT_PAID" && (await orderStatus(summary.orderId)) === "PENDING_PAYMENT");
  }

  console.log("\n--- 3. Refused while a provider refund is open ---");
  {
    const s = await sale();
    const [pay] = await admin`select id, amount_minor, currency from payments where order_id = ${s.orderId} and status = 'SUCCEEDED'`;
    await admin`insert into payment_refunds (payment_id, order_id, amount_minor, currency, reason, requested_by) values (${pay!.id}, ${s.orderId}, ${pay!.amount_minor}, ${pay!.currency}, 'ADMIN', ${adminUserId})`;
    const r = await attempt(() => recordChargeback(adminUserId, s.orderId, input()));
    check("3a. REFUND_OPEN; order still PAID, commission untouched", !r.ok && r.error instanceof ChargebackError && r.error.code === "REFUND_OPEN" && (await orderStatus(s.orderId)) === "PAID" && (await ledger(s.orderId)) === "COMMISSION_EARNED:300");
  }

  console.log("\n--- 4. Concurrency ---");
  {
    const s = await sale();
    const results = await Promise.all([1, 2, 3].map(() => attempt(() => recordChargeback(adminUserId, s.orderId, input()))));
    const [{ n }] = (await admin`select count(*)::int as n from payment_refunds where order_id = ${s.orderId} and reason = 'CHARGEBACK'`) as unknown as [{ n: number }];
    check("4a. Three simultaneous records → one succeeds, one CHARGEBACK row, one reversal", results.filter((r) => r.ok).length === 1 && n === 1 && (await ledger(s.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300", JSON.stringify({ ok: results.filter((r) => r.ok).length, n, ledger: await ledger(s.orderId) }));
  }

  console.log("\n--- 5. Admin only ---");
  {
    const s = await sale();
    const notAdmin = crypto.randomUUID();
    const r = await attempt(() => recordChargeback(notAdmin, s.orderId, input()));
    check("5a. A non-admin user id cannot record one; nothing changes", !r.ok && String(r.error).includes("Only a platform admin") && (await orderStatus(s.orderId)) === "PAID" && (await ledger(s.orderId)) === "COMMISSION_EARNED:300", r.ok ? "recorded" : String(r.error));
  }

  console.log("\n--- 6. Chargeback after the commission was paid out ---");
  {
    const Q = await newPartner();
    await tick();
    const t0 = new Date();
    const s = await sale(Q);
    await tick();
    const t1 = new Date();
    const asAdmin = <T>(fn: Parameters<typeof withAdminContext<T>>[1]) => withAdminContext(adminUserId, fn);
    const st = await asAdmin((tx) => getPartnerPayoutStatement(tx, { partnerId: Q.partnerId, currency: "GEL", periodFrom: t0, periodTo: t1 }));
    const payout = await asAdmin((tx) =>
      recordManualPayout(tx, adminUserId, { partnerId: Q.partnerId, currency: "GEL", periodFrom: t0, periodTo: t1, expectedAmountMinor: st.payableMinor, expectedLedgerEntryIds: st.eligibleLedgerEntryIds }),
    );
    check("6a. The sale's 300 commission was paid out", payout.amountMinor === 300);
    await tick();
    await recordChargeback(adminUserId, s.orderId, input());
    await tick();
    const t2 = new Date();
    const next = await asAdmin((tx) => getPartnerPayoutStatement(tx, { partnerId: Q.partnerId, currency: "GEL", periodFrom: new Date(t1.getTime() + 1), periodTo: t2 }));
    const clawback = next.candidates.find((c) => c.orderId === s.orderId && c.type === "COMMISSION_REVERSAL");
    check("6b. The reversal is a CLAWBACK of −300, netted into the next payout", clawback?.state === "CLAWBACK" && clawback.amountMinor === -300, JSON.stringify(clawback));
  }

  console.log("\n--- 7. Dispute evidence ---");
  {
    const s = await sale();
    await admin`insert into analytics_events (event_type, qr_code_id, greeting_id, partner_id) values ('RECIPIENT_VIEWED', ${s.qrId}, ${s.greetingId}, ${P.partnerId}), ('RECIPIENT_VIEWED', ${s.qrId}, ${s.greetingId}, ${P.partnerId})`;
    const e = await getDisputeEvidence(adminUserId, s.orderId);
    const json = JSON.stringify(e);
    check("7a. Order, charge (provider reference) and amounts", e.order.id === s.orderId && e.order.amountMinor === 1000 && e.charges.length === 1 && !!e.charges[0]!.providerReference && e.charges[0]!.status === "SUCCEEDED");
    check("7b. Proof of delivery: activation times and 2 recipient views", !!e.delivery.greetingActivatedAt && !!e.delivery.cardActivatedAt && e.delivery.recipientViews === 2 && !!e.delivery.firstRecipientViewAt);
    check("7c. No greeting content and no edit token", !json.includes(MESSAGE) && !json.includes(s.editToken));
    const notAdmin = await attempt(() => getDisputeEvidence(crypto.randomUUID(), s.orderId));
    check("7d. A non-admin gets nothing", !notAdmin.ok);
    const charged = await getDisputeEvidence(adminUserId, s1.orderId);
    check("7e. A charged-back order's pack lists the chargeback with its reference", charged.refunds.length === 1 && charged.refunds[0]!.reason === "CHARGEBACK" && !!charged.refunds[0]!.reference);
  }

  console.log("\n--- 8. Input validation ---");
  {
    const tomorrow2 = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    check("8a. Valid input is accepted", recordChargebackSchema.safeParse({ reference: " CB-1 ", disputedOn: "2026-10-01" }).success);
    check("8b. Empty reference refused", !recordChargebackSchema.safeParse({ reference: "  ", disputedOn: "2026-10-01" }).success);
    check("8c. A future date refused", !recordChargebackSchema.safeParse({ reference: "CB-1", disputedOn: tomorrow2 }).success);
    check("8d. A malformed date refused", !recordChargebackSchema.safeParse({ reference: "CB-1", disputedOn: "01/10/2026" }).success);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    await admin.end();
    process.exit(failed ? 1 : 0);
  });

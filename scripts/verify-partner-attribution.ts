import Module from "node:module";

// See verify-commercial-invariants.ts: neutralize `import "server-only"` for
// this standalone process only, so the REAL service code runs unmodified.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { eq } = require("drizzle-orm") as typeof import("drizzle-orm");

const { generateEditToken, hashEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startCheckout, confirmPaymentSuccess, settleConfirmedPayment, activatePaidOrder, markPaymentFailed, refundPaidOrder } =
  require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { recordManualPayout, getPartnerUnpaidBalance, getPartnerPayoutStatement } =
  require("../src/lib/payments/payouts") as typeof import("../src/lib/payments/payouts");
const { getPartnerMetrics } = require("../src/lib/dashboard/partner-metrics") as typeof import("../src/lib/dashboard/partner-metrics");
const { getBatchPerformance, listPartnerSalesTrace } = require("../src/lib/dashboard/attribution") as typeof import("../src/lib/dashboard/attribution");
const { recordAnalyticsEvent } = require("../src/lib/analytics") as typeof import("../src/lib/analytics");
const { withPartnerContext, withEditableGreeting, withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
const { orders, qrCodes, qrBatches, greetings } = require("../src/db/schema") as typeof import("../src/db/schema");

/**
 * Partner QR attribution + commission ledger, end to end (cases A–O of the
 * attribution spec, plus the DB-level guarantees from migrations/0013).
 * Exercises the REAL service functions under the REAL app_runtime RLS role.
 * The superuser connection (MIGRATIONS_DATABASE_URL) is used only for
 * fixtures, read-back assertions, and the "even a superuser can't" checks
 * that prove a rule lives in the database rather than in app code.
 */

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const admin = postgres(migrationsUrl, { max: 4 });

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

async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

const MESSAGE = "PRIVATE-GREETING-MESSAGE-attribution-verify";

const created = {
  partners: [] as string[],
  users: [] as string[],
  adminUsers: [] as string[],
  batches: [] as string[],
  qrs: [] as string[],
  greetings: [] as string[],
};

async function main() {
  console.log("Setting up fixtures (superuser)...");

  const [product] = await admin`select id from products where key = 'PHOTO_GREETING' limit 1`;
  const [theme] = await admin`select id from themes where key = 'minimal' limit 1`;
  if (!product || !theme) throw new Error("Seed data missing — run npm run db:seed first");
  const productId = product.id as string;

  async function makePartner(label: string, rateBps: number) {
    const id = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await admin`insert into partners (id, slug, name, commission_rate_bps) values (${id}, ${`attr-${label}-${id.slice(0, 8)}`}, ${`Attribution ${label}`}, ${rateBps})`;
    await admin`insert into partner_members (partner_id, user_id, role) values (${id}, ${userId}, 'OWNER')`;
    // Partner-specific price: lets case J change "today's price" without touching the shared platform default.
    await admin`insert into prices (product_id, partner_id, currency, amount_minor) values (${productId}, ${id}, 'GEL', 1500)`;
    created.partners.push(id);
    created.users.push(userId);
    return { id, userId };
  }

  async function makeBatch(partnerId: string, label: string) {
    const id = crypto.randomUUID();
    await admin`insert into qr_batches (id, partner_id, label, quantity) values (${id}, ${partnerId}, ${label}, 10)`;
    created.batches.push(id);
    return id;
  }

  /** A card whose sender has written a greeting (DRAFT, message present) — ready for checkout. */
  async function makeGreeting(partnerId: string, batchId: string) {
    const qrId = crypto.randomUUID();
    const greetingId = crypto.randomUUID();
    const editToken = generateEditToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${generatePublicToken()}, ${batchId}, ${partnerId}, 'DRAFT')`;
    await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values (${greetingId}, ${qrId}, ${theme!.id}, ${productId}, 'DRAFT', ${hashEditToken(editToken)})`;
    await admin`insert into greeting_content (greeting_id, type, slot, text_value, status) values (${greetingId}, 'text', 0, ${MESSAGE}, 'READY')`;
    created.qrs.push(qrId);
    created.greetings.push(greetingId);
    return { qrId, greetingId, editToken };
  }

  /** Full happy path through the real services: checkout -> provider-confirmed success -> activation. */
  async function sell(partnerId: string, batchId: string) {
    const g = await makeGreeting(partnerId, batchId);
    const { order } = await startCheckout({ greetingId: g.greetingId, editToken: g.editToken, productId });
    const providerPaymentId = `test_${order.grossAmountMinor}_${order.currency}_${crypto.randomUUID()}`;
    await confirmPaymentSuccess({ provider: "TEST", providerPaymentId, orderId: order.id, amountMinor: order.grossAmountMinor, currency: order.currency });
    await activatePaidOrder(order.id);
    return { ...g, order, providerPaymentId };
  }

  const ledgerFor = (orderId: string) => admin`select partner_id, type, amount_minor, currency from partner_ledger_entries where order_id = ${orderId} order by created_at`;
  const ledgerForQr = (qrId: string) => admin`select l.id from partner_ledger_entries l join orders o on o.id = l.order_id where o.qr_code_id = ${qrId}`;

  const A = await makePartner("a", 2000);
  const B = await makePartner("b", 3000);
  const batchA1 = await makeBatch(A.id, "BATCH-A1");
  const batchA2 = await makeBatch(A.id, "BATCH-A2");
  const batchB = await makeBatch(B.id, "BATCH-B");
  const adminUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  created.adminUsers.push(adminUserId);

  // ---------------------------------------------------------------------
  console.log("\n--- A/B. Attribution follows QR -> batch -> partner ---");
  const saleA = await sell(A.id, batchA1);
  const [chainA] = await admin`
    select b.partner_id as batch_partner, o.partner_id as order_partner, o.status, l.partner_id as ledger_partner, l.amount_minor, o.partner_commission_minor
      from qr_codes q join qr_batches b on b.id = q.batch_id
      join orders o on o.qr_code_id = q.id
      join partner_ledger_entries l on l.order_id = o.id and l.type = 'COMMISSION_EARNED'
     where q.id = ${saleA.qrId}`;
  check("A. Partner A's QR -> commission belongs to Partner A", chainA?.batch_partner === A.id && chainA?.order_partner === A.id && chainA?.ledger_partner === A.id);
  check("   commission = 20% of 15.00 GEL from the stored snapshot (300)", chainA?.amount_minor === 300 && chainA?.partner_commission_minor === 300, JSON.stringify(chainA));
  check("   order records the commission rate in force at checkout", saleA.order.commissionRateBps === 2000);

  const saleB = await sell(B.id, batchB);
  const ledgerB = await ledgerFor(saleB.order.id);
  check("B. Partner B's QR -> commission belongs to Partner B", saleB.order.partnerId === B.id && ledgerB.length === 1 && ledgerB[0]?.partner_id === B.id);
  check("   at Partner B's own rate (30% of 1500 = 450)", ledgerB[0]?.amount_minor === 450);

  // ---------------------------------------------------------------------
  console.log("\n--- C/D/E. No commission before authoritative payment success ---");
  {
    const [scanOnly] = await admin`insert into qr_codes (public_token, batch_id, partner_id) values (${generatePublicToken()}, ${batchA1}, ${A.id}) returning id`;
    created.qrs.push(scanOnly!.id);
    await recordAnalyticsEvent({ eventType: "QR_SCANNED", qrCodeId: scanOnly!.id }, { partnerId: A.id });
    check("C. Scan only -> no order, no commission", (await admin`select id from orders where qr_code_id = ${scanOnly!.id}`).length === 0 && (await ledgerForQr(scanOnly!.id)).length === 0);

    const draftOnly = await makeGreeting(A.id, batchA1);
    check("D. Greeting created (with message) -> no commission", (await ledgerForQr(draftOnly.qrId)).length === 0);

    const failing = await makeGreeting(A.id, batchA1);
    const { order: failOrder } = await startCheckout({ greetingId: failing.greetingId, editToken: failing.editToken, productId });
    check("   checkout opened (PENDING_PAYMENT) -> no commission yet", (await ledgerFor(failOrder.id)).length === 0);
    await markPaymentFailed(failOrder.id);
    const [failedRow] = await admin`select status from orders where id = ${failOrder.id}`;
    check("E. Failed payment -> order FAILED, no commission", failedRow?.status === "FAILED" && (await ledgerFor(failOrder.id)).length === 0);
    // A late provider "success" for a FAILED order is never applied: no
    // commission, never PAID — and the charge is recorded for return rather
    // than dropped (lib/payments/service.ts, "ORDER_CLOSED").
    const lateId = `late_${crypto.randomUUID()}`;
    const late = await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: lateId, orderId: failOrder.id, amountMinor: failOrder.grossAmountMinor, currency: failOrder.currency });
    const [lateOrder] = await admin`select status from orders where id = ${failOrder.id}`;
    const [lateCharge] = await admin`select status from payments where provider_payment_id = ${lateId}`;
    check(
      "   a late 'success' for a FAILED order is never applied (no commission, not PAID) and is queued for return",
      late.outcome === "REFUND_REQUIRED" && lateOrder?.status === "REFUND_REQUIRED" && lateCharge?.status === "SUCCEEDED" && (await ledgerFor(failOrder.id)).length === 0,
    );
  }

  // ---------------------------------------------------------------------
  console.log("\n--- F/G. Exactly one commission, even with duplicate callbacks ---");
  check("F. Successful payment -> exactly one commission", (await ledgerFor(saleA.order.id)).length === 1);
  {
    const replay = await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: saleA.providerPaymentId, orderId: saleA.order.id, amountMinor: saleA.order.grossAmountMinor, currency: saleA.order.currency });
    const replayOtherId = await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: `test_${crypto.randomUUID()}`, orderId: saleA.order.id, amountMinor: saleA.order.grossAmountMinor, currency: saleA.order.currency });
    // The same charge again is a replay; a DIFFERENT charge id for a paid order is
    // a second capture — recorded for return, never silently ignored or booked.
    check("G. Duplicate success callback -> recognized as already processed; a second charge is a duplicate capture", replay.alreadyProcessed && replayOtherId.outcome === "DUPLICATE_CAPTURE");
    check("   still exactly one commission", (await ledgerFor(saleA.order.id)).length === 1);
    check(
      "   DB unique index rejects a second COMMISSION_EARNED even from a superuser",
      await expectThrows(() => admin`insert into partner_ledger_entries (partner_id, order_id, type, amount_minor, currency) values (${A.id}, ${saleA.order.id}, 'COMMISSION_EARNED', 300, 'GEL')`),
    );
  }

  // ---------------------------------------------------------------------
  console.log("\n--- H. Concurrent duplicate confirmation ---");
  {
    const g = await makeGreeting(A.id, batchA2);
    const { order } = await startCheckout({ greetingId: g.greetingId, editToken: g.editToken, productId });
    const pid = `test_${order.grossAmountMinor}_GEL_${crypto.randomUUID()}`;
    const confirm = (id: string) => confirmPaymentSuccess({ provider: "TEST", providerPaymentId: id, orderId: order.id, amountMinor: order.grossAmountMinor, currency: order.currency });
    const results = await Promise.allSettled([confirm(pid), confirm(pid), confirm(pid), confirm(`test_${crypto.randomUUID()}`)]);
    const bookings = results.filter((r) => r.status === "fulfilled" && r.value.outcome === "PAID" && !r.value.alreadyProcessed).length;
    check("H. 4 concurrent confirmations -> exactly one does the booking", bookings === 1, JSON.stringify(results.map((r) => (r.status === "fulfilled" ? `${r.value.outcome}${r.value.alreadyProcessed ? "(replay)" : ""}` : String(r.reason)))));
    // The distinct charge among them is returned, as every caller does (settleConfirmedPayment).
    for (const r of results) if (r.status === "fulfilled" && r.value.outcome === "DUPLICATE_CAPTURE") await settleConfirmedPayment(r.value);
    const activations = await Promise.all([activatePaidOrder(order.id), activatePaidOrder(order.id)]);
    check("   concurrent activation -> exactly one activates", activations.filter((a) => a.activated).length === 1);
    const [state] = await admin`
      select (select count(*)::int from orders where greeting_id = ${g.greetingId} and status = 'PAID') as paid,
             (select count(*)::int from payments where order_id = ${order.id} and status = 'SUCCEEDED') as succeeded,
             (select count(*)::int from payments where order_id = ${order.id} and status = 'REFUNDED') as returned,
             (select count(*)::int from partner_ledger_entries where order_id = ${order.id}) as ledger,
             (select status::text from qr_codes where id = ${g.qrId}) as qr_status`;
    check("   ONE paid order, ONE successful payment (the second charge returned), ONE commission, QR ACTIVE", state?.paid === 1 && state?.succeeded === 1 && state?.returned === 1 && state?.ledger === 1 && state?.qr_status === "ACTIVE", JSON.stringify(state));
  }

  // ---------------------------------------------------------------------
  console.log("\n--- J. Historical snapshot survives price/commission changes ---");
  {
    await admin`update partners set commission_rate_bps = 5000 where id = ${A.id}`;
    await admin`update prices set amount_minor = 2500 where partner_id = ${A.id}`;
    const [oldOrder] = await admin`select gross_amount_minor, partner_commission_minor, commission_rate_bps from orders where id = ${saleA.order.id}`;
    const oldLedger = await ledgerFor(saleA.order.id);
    check("J. Old sale keeps 15.00 gross / 3.00 commission / 20% after config change", oldOrder?.gross_amount_minor === 1500 && oldOrder?.partner_commission_minor === 300 && oldOrder?.commission_rate_bps === 2000 && oldLedger[0]?.amount_minor === 300);
    const saleA3 = await sell(A.id, batchA2);
    check("   new sale uses the new config (25.00 at 50% = 12.50)", saleA3.order.grossAmountMinor === 2500 && saleA3.order.partnerCommissionMinor === 1250 && saleA3.order.commissionRateBps === 5000);
    check(
      "   order snapshot is immutable in the DB, even for a superuser",
      await expectThrows(() => admin`update orders set partner_commission_minor = 1, platform_share_minor = gross_amount_minor - 1 where id = ${saleA.order.id}`),
    );
  }

  // ---------------------------------------------------------------------
  console.log("\n--- K. Partner can't be changed by request payload or later edits ---");
  {
    const g = await makeGreeting(A.id, batchA1);
    const forged = { greetingId: g.greetingId, editToken: g.editToken, productId, partnerId: B.id, partnerCommissionMinor: 1500 } as unknown as Parameters<typeof startCheckout>[0];
    const { order } = await startCheckout(forged);
    check("K. Extra partnerId/commission in the checkout payload is ignored", order.partnerId === A.id && order.partnerCommissionMinor === 1250, JSON.stringify({ partnerId: order.partnerId, commission: order.partnerCommissionMinor }));

    const g2 = await makeGreeting(A.id, batchA1);
    check(
      "   sender context can't INSERT an order attributed to Partner B",
      await expectThrows(() =>
        withEditableGreeting(g2.greetingId, (tx) =>
          tx.insert(orders).values({ greetingId: g2.greetingId, qrCodeId: g2.qrId, partnerId: B.id, productId, currency: "GEL", grossAmountMinor: 1500, partnerCommissionMinor: 0, platformShareMinor: 1500 }),
        ),
      ),
    );

    // A user who is a member of BOTH partners — RLS alone would let them re-point a QR.
    await admin`insert into partner_members (partner_id, user_id, role) values (${B.id}, ${A.userId}, 'OWNER')`;
    check(
      "   a member of both partners can't move a sold QR from A to B",
      await expectThrows(() => withPartnerContext(A.userId, A.id, (tx) => tx.update(qrCodes).set({ partnerId: B.id, batchId: batchB }).where(eq(qrCodes.id, saleA.qrId)))),
    );
    check(
      "   nor move a batch from A to B",
      await expectThrows(() => withPartnerContext(A.userId, A.id, (tx) => tx.update(qrBatches).set({ partnerId: B.id }).where(eq(qrBatches.id, batchA1)))),
    );
    await admin`delete from partner_members where partner_id = ${B.id} and user_id = ${A.userId}`;
    check(
      "   an admin can't reassign a QR either",
      await expectThrows(() => withAdminContext(adminUserId, (tx) => tx.update(qrCodes).set({ partnerId: B.id, batchId: batchB }).where(eq(qrCodes.id, saleA.qrId)))),
    );
    check("   nor a superuser (DB trigger)", await expectThrows(() => admin`update qr_codes set partner_id = ${B.id}, batch_id = ${batchB} where id = ${saleA.qrId}`));
    check("   a QR can't be minted under a batch of another partner", await expectThrows(() => admin`insert into qr_codes (public_token, batch_id, partner_id) values (${generatePublicToken()}, ${batchB}, ${A.id})`));
    const [spare] = await admin`insert into qr_codes (public_token, batch_id, partner_id) values (${generatePublicToken()}, ${batchB}, ${B.id}) returning id`;
    created.qrs.push(spare!.id);
    check(
      "   a draft greeting can't hop to another partner's card",
      await expectThrows(() => withEditableGreeting(g2.greetingId, (tx) => tx.update(greetings).set({ qrCodeId: spare!.id }).where(eq(greetings.id, g2.greetingId)))),
    );
    check("   a PAID order can't be rolled back to PENDING_PAYMENT", await expectThrows(() => admin`update orders set status = 'PENDING_PAYMENT' where id = ${saleA.order.id}`));
    // Temporarily remove a real sale's commission so the per-order unique
    // index can't be what rejects the forged rows below — only the trigger.
    const s = await sell(A.id, batchA1);
    await admin`delete from partner_ledger_entries where order_id = ${s.order.id}`;
    check(
      "   a COMMISSION_EARNED row can't name a different partner than its order",
      await expectThrows(() => admin`insert into partner_ledger_entries (partner_id, order_id, type, amount_minor, currency) values (${B.id}, ${s.order.id}, 'COMMISSION_EARNED', ${s.order.partnerCommissionMinor}, 'GEL')`),
    );
    check(
      "   nor a different amount than the order's snapshot",
      await expectThrows(() => admin`insert into partner_ledger_entries (partner_id, order_id, type, amount_minor, currency) values (${A.id}, ${s.order.id}, 'COMMISSION_EARNED', ${s.order.partnerCommissionMinor + 1}, 'GEL')`),
    );
    check(
      "   and an orderless COMMISSION_EARNED is rejected",
      await expectThrows(() => admin`insert into partner_ledger_entries (partner_id, type, amount_minor, currency) values (${A.id}, 'COMMISSION_EARNED', 100, 'GEL')`),
    );
    await admin`insert into partner_ledger_entries (partner_id, order_id, type, amount_minor, currency) values (${A.id}, ${s.order.id}, 'COMMISSION_EARNED', ${s.order.partnerCommissionMinor}, 'GEL')`;
  }

  // ---------------------------------------------------------------------
  console.log("\n--- L. Partner dashboard exposes aggregates only ---");
  {
    const dash = await withPartnerContext(A.userId, A.id, async (tx) => ({
      metrics: await getPartnerMetrics(tx, A.id),
      batches: await getBatchPerformance(tx, A.id),
    }));
    const json = JSON.stringify(dash);
    check("L. Dashboard data contains no greeting message text", !json.includes(MESSAGE));
    check(
      "   only numeric aggregates / labels, no content-shaped fields",
      !/text_value|textValue|storagePath|storage_path|mediaUrl|edit_token/i.test(json),
    );
    check("   gross sales / earned / scanned derive from stored rows", dash.metrics.grossSalesMinor > 0 && dash.metrics.commissionEarnedMinor > 0 && dash.metrics.qrScanned >= 1);
  }

  // ---------------------------------------------------------------------
  console.log("\n--- I. Refund reverses commission without deleting history ---");
  const balanceBeforeRefund = await withAdminContext(adminUserId, (tx) => getPartnerUnpaidBalance(tx, B.id, "GEL"));
  {
    check("   only a PAID order can be refunded", await expectThrows(() => refundPaidOrder(adminUserId, crypto.randomUUID())));
    check(
      "   a reversal can't be booked for an order that isn't REFUNDED",
      await expectThrows(() => admin`insert into partner_ledger_entries (partner_id, order_id, type, amount_minor, currency) values (${B.id}, ${saleB.order.id}, 'COMMISSION_REVERSAL', -450, 'GEL')`),
    );
    const r1 = await refundPaidOrder(adminUserId, saleB.order.id);
    const r2 = await refundPaidOrder(adminUserId, saleB.order.id);
    const ledger = await ledgerFor(saleB.order.id);
    const [st] = await admin`select o.status::text as o, (select string_agg(status::text, ',') from payments where order_id = o.id and status <> 'PENDING') as p from orders o where o.id = ${saleB.order.id}`;
    check("I. Refund -> order + payment REFUNDED", r1.alreadyRefunded === false && st?.o === "REFUNDED" && st?.p === "REFUNDED", JSON.stringify(st));
    check("   original COMMISSION_EARNED kept, COMMISSION_REVERSAL of -450 added", ledger.length === 2 && ledger[0]?.type === "COMMISSION_EARNED" && ledger[1]?.type === "COMMISSION_REVERSAL" && ledger[1]?.amount_minor === -450);
    check("   repeat refund is idempotent (one reversal only)", r2.alreadyRefunded === true && ledger.length === 2);
    const balanceAfter = await withAdminContext(adminUserId, (tx) => getPartnerUnpaidBalance(tx, B.id, "GEL"));
    check("   partner balance drops by exactly the commission", balanceAfter === balanceBeforeRefund - 450);
    const metricsB = await withPartnerContext(B.userId, B.id, (tx) => getPartnerMetrics(tx, B.id));
    check("   refunded sale no longer counts as a sale; reversal visible", metricsB.successfulSales === 0 && metricsB.commissionReversedMinor === 450 && metricsB.commissionUnpaidMinor === 0);
    check("   a REFUNDED order can't be flipped back to PAID", await expectThrows(() => admin`update orders set status = 'PAID' where id = ${saleB.order.id}`));
  }

  // ---------------------------------------------------------------------
  console.log("\n--- M. Paid commission never enters another payout ---");
  {
    const balance = await withAdminContext(adminUserId, (tx) => getPartnerUnpaidBalance(tx, A.id, "GEL"));
    // Itemized payouts (migrations/0014): a closed period, paying exactly the statement's rows.
    const period = { periodFrom: new Date(Date.now() - 3600_000), periodTo: new Date() };
    const statement = await withAdminContext(adminUserId, (tx) => getPartnerPayoutStatement(tx, { partnerId: A.id, currency: "GEL", ...period }));
    check("   period statement: payable = net commission of the period = balance", statement.payableMinor === balance && statement.netCommissionMinor === balance && statement.paidActivations >= 4, JSON.stringify({ ...statement, candidates: statement.candidates.length }));
    const payout = () =>
      withAdminContext(adminUserId, (tx) =>
        recordManualPayout(tx, adminUserId, { partnerId: A.id, currency: "GEL", ...period, expectedAmountMinor: statement.payableMinor, expectedLedgerEntryIds: statement.eligibleLedgerEntryIds }),
      );

    const race = await Promise.allSettled([payout(), payout()]);
    check("M. Two concurrent payouts of the same commissions -> only one succeeds", race.filter((r) => r.status === "fulfilled").length === 1, JSON.stringify(race.map((r) => r.status)));
    const after = await withAdminContext(adminUserId, (tx) => getPartnerUnpaidBalance(tx, A.id, "GEL"));
    check("   balance is now zero, not negative", after === 0);
    const [items] = await admin`select count(*)::int as n from partner_payout_items where partner_id = ${A.id}`;
    check("   every paid commission is linked to the payout", items?.n === statement.eligibleLedgerEntryIds.length);
    const later = { periodFrom: new Date(Date.now() - 1000), periodTo: new Date() };
    const statementLater = await withAdminContext(adminUserId, (tx) => getPartnerPayoutStatement(tx, { partnerId: A.id, currency: "GEL", ...later }));
    check("   a later period has nothing left to pay", statementLater.blocker !== null && statementLater.payableMinor === 0);
    check(
      "   a PAYOUT ledger row without a matching payout is rejected by the DB even for a superuser",
      await expectThrows(() => admin`insert into partner_ledger_entries (partner_id, type, amount_minor, currency) values (${A.id}, 'PAYOUT', -1, 'GEL')`),
    );
    const statementAfter = await withAdminContext(adminUserId, (tx) => getPartnerPayoutStatement(tx, { partnerId: A.id, currency: "GEL", ...period }));
    check("   the same period's statement now shows 0 payable, every row already paid", statementAfter.payableMinor === 0 && statementAfter.alreadyPaidCount === statement.eligibleLedgerEntryIds.length);
  }

  // ---------------------------------------------------------------------
  console.log("\n--- N. Several batches of one partner aggregate correctly ---");
  {
    const perf = await withPartnerContext(A.userId, A.id, (tx) => getBatchPerformance(tx, A.id));
    const metrics = await withPartnerContext(A.userId, A.id, (tx) => getPartnerMetrics(tx, A.id));
    const [db] = await admin`
      select count(*) filter (where q.batch_id = ${batchA1})::int as a1, count(*) filter (where q.batch_id = ${batchA2})::int as a2
        from orders o join qr_codes q on q.id = o.qr_code_id where o.partner_id = ${A.id} and o.status = 'PAID'`;
    const p1 = perf.find((p) => p.batchId === batchA1);
    const p2 = perf.find((p) => p.batchId === batchA2);
    check("N. Per-batch paid activations match the DB", p1?.paidActivations === db?.a1 && p2?.paidActivations === db?.a2, JSON.stringify({ p1, p2, db }));
    check("   batches sum to the partner total", (p1?.paidActivations ?? 0) + (p2?.paidActivations ?? 0) === metrics.successfulSales);
    check("   per-batch net commission sums to the partner's earned commission", (p1?.netCommissionMinor ?? 0) + (p2?.netCommissionMinor ?? 0) === metrics.commissionEarnedMinor - metrics.commissionReversedMinor);
    check("   batch A1 scan was counted and conversion computed", (p1?.scanned ?? 0) >= 1 && p1?.conversionPct !== null);
  }

  // ---------------------------------------------------------------------
  console.log("\n--- O. Partners stay financially isolated ---");
  {
    const bSeesA = await withPartnerContext(B.userId, B.id, async (tx) => ({
      orders: await tx.select().from(orders).where(eq(orders.partnerId, A.id)),
      perf: await getBatchPerformance(tx, A.id),
    }));
    check("O. Partner B sees none of Partner A's orders or batches", bSeesA.orders.length === 0 && bSeesA.perf.length === 0);
    const [iso] = await admin`
      select (select coalesce(sum(amount_minor), 0)::int from partner_ledger_entries where partner_id = ${B.id}) as b_balance,
             (select count(*)::int from partner_ledger_entries l join orders o on o.id = l.order_id where l.partner_id = ${B.id} and o.partner_id <> ${B.id}) as b_foreign`;
    check("   Partner B's ledger has only its own sale (earned + reversed = 0)", iso?.b_balance === 0 && iso?.b_foreign === 0, JSON.stringify(iso));
    const trace = await withAdminContext(adminUserId, (tx) => listPartnerSalesTrace(tx, A.id));
    // Every money-bearing order carries its QR, batch and payment; every one that
    // was PAID carries its commission. A REFUND_REQUIRED order (money captured but
    // never applied — e.g. E's late success) rightly has none.
    check(
      "   admin trace for A lists only A's sales, each with QR, batch, payment and (if it was paid) commission",
      trace.length >= 4 && trace.every((r) => r.batchLabel.startsWith("BATCH-A") && r.providerPaymentId && (r.orderStatus === "REFUND_REQUIRED" || r.commissionEarnedMinor !== null)),
    );
    check("   a captured-but-never-paid order in the trace carries no commission", trace.filter((r) => r.orderStatus === "REFUND_REQUIRED").every((r) => r.commissionEarnedMinor === null));
    check("   admin trace never carries greeting content", !JSON.stringify(trace).includes(MESSAGE));
  }

  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

async function cleanup() {
  console.log("\nCleaning up fixtures...");
  const p = created.partners;
  if (p.length === 0) return;
  await admin`delete from partner_payout_items where partner_id in ${admin(p)}`;
  await admin`delete from partner_ledger_entries where partner_id in ${admin(p)}`;
  await admin`delete from partner_payouts where partner_id in ${admin(p)}`;
  await admin`delete from payments where order_id in (select id from orders where partner_id in ${admin(p)})`;
  await admin`delete from orders where partner_id in ${admin(p)}`;
  await admin`delete from analytics_events where partner_id in ${admin(p)}`;
  if (created.greetings.length) {
    await admin`delete from greeting_content where greeting_id in ${admin(created.greetings)}`;
    await admin`delete from greetings where id in ${admin(created.greetings)}`;
  }
  await admin`delete from qr_codes where partner_id in ${admin(p)}`;
  await admin`delete from qr_batches where partner_id in ${admin(p)}`;
  await admin`delete from partner_members where partner_id in ${admin(p)}`;
  if (created.adminUsers.length) await admin`delete from admin_users where user_id in ${admin(created.adminUsers)}`;
  await admin`delete from partners where id in ${admin(p)}`;
  await admin.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await cleanup();
  } catch (cleanupErr) {
    console.error("cleanup failed:", cleanupErr);
  }
  process.exit(1);
});

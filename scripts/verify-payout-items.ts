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
const { startCheckout, confirmPaymentSuccess, activatePaidOrder, refundPaidOrder } =
  require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { recordManualPayout, getPartnerUnpaidBalance, getPartnerPayoutStatement, listPartnerPayoutsWithItems, findPayoutForLedgerEntry } =
  require("../src/lib/payments/payouts") as typeof import("../src/lib/payments/payouts");
const { withPartnerContext, withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
const { partnerPayoutItems } = require("../src/db/schema") as typeof import("../src/db/schema");

/**
 * Sale-level payout traceability (migrations/0014): cases A–K of the payout
 * items spec plus the DB-level guarantees. REAL services under the REAL
 * app_runtime RLS role; the superuser connection is used for fixtures,
 * read-back, and "even a superuser / a buggy caller can't" checks.
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
const tick = () => new Promise((r) => setTimeout(r, 20));

const MESSAGE = "PRIVATE-GREETING-MESSAGE-payout-items-verify";
const created = { partners: [] as string[], adminUsers: [] as string[], greetings: [] as string[] };

async function main() {
  console.log("Setting up fixtures (superuser)...");
  const [product] = await admin`select id from products where key = 'PHOTO_GREETING' limit 1`;
  const [theme] = await admin`select id from themes where key = 'minimal' limit 1`;
  if (!product || !theme) throw new Error("Seed data missing — run npm run db:seed first");
  const productId = product.id as string;

  async function makePartner(label: string) {
    const id = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    await admin`insert into partners (id, slug, name, commission_rate_bps) values (${id}, ${`payitems-${label}-${id.slice(0, 8)}`}, ${`Payout Items ${label}`}, 2000)`;
    await admin`insert into partner_members (partner_id, user_id, role) values (${id}, ${userId}, 'OWNER')`;
    await admin`insert into prices (product_id, partner_id, currency, amount_minor) values (${productId}, ${id}, 'GEL', 1500)`;
    await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${id}, ${`PAYITEMS-${label}`}, 50)`;
    created.partners.push(id);
    return { id, userId, batchId };
  }

  /** Real sale: claimable card + greeting with message -> checkout -> confirmed payment -> activation. Returns its COMMISSION_EARNED row id. */
  async function sell(p: { id: string; batchId: string }) {
    const qrId = crypto.randomUUID();
    const greetingId = crypto.randomUUID();
    const editToken = generateEditToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${generatePublicToken()}, ${p.batchId}, ${p.id}, 'DRAFT')`;
    await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values (${greetingId}, ${qrId}, ${theme!.id}, ${productId}, 'DRAFT', ${hashEditToken(editToken)})`;
    await admin`insert into greeting_content (greeting_id, type, slot, text_value, status) values (${greetingId}, 'text', 0, ${MESSAGE}, 'READY')`;
    created.greetings.push(greetingId);
    const { order } = await startCheckout({ greetingId, editToken, productId });
    await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: `test_${order.grossAmountMinor}_GEL_${crypto.randomUUID()}`, orderId: order.id, amountMinor: order.grossAmountMinor, currency: order.currency });
    await activatePaidOrder(order.id);
    const [ledger] = await admin`select id from partner_ledger_entries where order_id = ${order.id} and type = 'COMMISSION_EARNED'`;
    return { orderId: order.id, ledgerId: ledger!.id as string, commission: order.partnerCommissionMinor };
  }

  const adminUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  created.adminUsers.push(adminUserId);
  const asAdmin = <T,>(fn: Parameters<typeof withAdminContext<T>>[1]) => withAdminContext(adminUserId, fn);
  const statementFor = (partnerId: string, periodFrom: Date, periodTo: Date) => asAdmin((tx) => getPartnerPayoutStatement(tx, { partnerId, currency: "GEL", periodFrom, periodTo }));
  const payFor = async (partnerId: string, periodFrom: Date, periodTo: Date, override: { expectedAmountMinor?: number; expectedLedgerEntryIds?: string[] } = {}) => {
    const s = await statementFor(partnerId, periodFrom, periodTo);
    return asAdmin((tx) =>
      recordManualPayout(tx, adminUserId, { partnerId, currency: "GEL", periodFrom, periodTo, expectedAmountMinor: s.payableMinor, expectedLedgerEntryIds: s.eligibleLedgerEntryIds, ...override }),
    );
  };
  const itemsOf = async (payoutId: string) => (await admin`select ledger_entry_id from partner_payout_items where payout_id = ${payoutId} order by ledger_entry_id`).map((r) => r.ledger_entry_id as string);
  const balanceOf = (partnerId: string) => asAdmin((tx) => getPartnerUnpaidBalance(tx, partnerId, "GEL"));

  const A = await makePartner("a");
  const B = await makePartner("b");
  await tick();
  const t0 = new Date();

  // ---------------------------------------------------------------------
  console.log("\n--- A. Three unpaid commissions -> one payout links all three ---");
  const s1 = await sell(A);
  const s2 = await sell(A);
  const s3 = await sell(A);
  await tick();
  const t1 = new Date();
  const st1 = await statementFor(A.id, t0, t1);
  check("   statement lists exactly the 3 commissions as eligible", st1.blocker === null && st1.eligibleLedgerEntryIds.length === 3 && st1.payableMinor === 900, JSON.stringify({ blocker: st1.blocker, ids: st1.eligibleLedgerEntryIds.length, payable: st1.payableMinor }));
  check("   statement rows carry order, QR and batch for each sale", st1.candidates.every((c) => c.orderId && c.qrPublicToken && c.batchLabel === "PAYITEMS-a" && c.grossAmountMinor === 1500));
  const p1 = await payFor(A.id, t0, t1);
  const p1Items = await itemsOf(p1.id);
  check("A. Payout links exactly commissions 1, 2, 3", JSON.stringify(p1Items) === JSON.stringify([s1.ledgerId, s2.ledgerId, s3.ledgerId].sort()));
  check("   reverse lookup: each commission -> this payout", (await Promise.all([s1, s2, s3].map((s) => asAdmin((tx) => findPayoutForLedgerEntry(tx, s.ledgerId))))).every((id) => id === p1.id));
  check("J. Payout amount = SUM(items) = 900 (server-computed)", p1.amountMinor === 900 && p1.itemized === true);
  const [p1Ledger] = await admin`select amount_minor from partner_ledger_entries where payout_id = ${p1.id} and type = 'PAYOUT'`;
  check("   ...and its PAYOUT ledger row is exactly -900", p1Ledger?.amount_minor === -900);

  // ---------------------------------------------------------------------
  console.log("\n--- C. Different, later commissions -> later payout succeeds ---");
  await tick();
  const s4 = await sell(A);
  const s5 = await sell(A);
  await tick();
  const t2 = new Date();
  const p2From = new Date(t1.getTime() + 1);
  const p2 = await payFor(A.id, p2From, t2);
  check("C. Second payout contains only commissions 4 and 5", JSON.stringify(await itemsOf(p2.id)) === JSON.stringify([s4.ledgerId, s5.ledgerId].sort()) && p2.amountMinor === 600);

  // ---------------------------------------------------------------------
  console.log("\n--- B. Already-paid commissions can never enter another payout ---");
  check(
    "B. Service: a payout claiming commissions 1-3 again is rejected",
    await expectThrows(() =>
      asAdmin((tx) => recordManualPayout(tx, adminUserId, { partnerId: A.id, currency: "GEL", periodFrom: new Date(t2.getTime() + 1), periodTo: new Date(), expectedAmountMinor: 900, expectedLedgerEntryIds: [s1.ledgerId, s2.ledgerId, s3.ledgerId] })),
    ),
  );
  check("   DB: re-linking commission 1 to payout 2 violates the primary key, even for a superuser", await expectThrows(() => admin`insert into partner_payout_items (ledger_entry_id, payout_id, partner_id, currency) values (${s1.ledgerId}, ${p2.id}, ${A.id}, 'GEL')`));
  check("   DB: an admin can't re-point an item to another payout (immutable)", await expectThrows(() => admin`update partner_payout_items set payout_id = ${p2.id} where ledger_entry_id = ${s1.ledgerId}`));
  check("   DB: a payout with items can't be deleted", await expectThrows(() => admin`delete from partner_payouts where id = ${p1.id}`));
  check("   DB: a payout's amount can't be edited", await expectThrows(() => admin`update partner_payouts set amount_minor = 1 where id = ${p1.id}`));
  const adminDelete = await asAdmin((tx) => tx.delete(partnerPayoutItems).where(eq(partnerPayoutItems.ledgerEntryId, s1.ledgerId)).returning());
  check("   RLS: an admin session can't delete payout items (no delete policy)", adminDelete.length === 0 && (await itemsOf(p1.id)).length === 3);

  // ---------------------------------------------------------------------
  console.log("\n--- D. Partner A's payout can never contain Partner B's commission ---");
  const sb = await sell(B);
  check(
    "D. Service: Partner B's commission in Partner A's expected items is rejected",
    await expectThrows(() => asAdmin((tx) => recordManualPayout(tx, adminUserId, { partnerId: A.id, currency: "GEL", periodFrom: new Date(t2.getTime() + 1), periodTo: new Date(), expectedAmountMinor: sb.commission, expectedLedgerEntryIds: [sb.ledgerId] }))),
  );
  check("   DB: item claiming A's payout with B's ledger row fails the composite FK (as A)", await expectThrows(() => admin`insert into partner_payout_items (ledger_entry_id, payout_id, partner_id, currency) values (${sb.ledgerId}, ${p2.id}, ${A.id}, 'GEL')`));
  check("   DB: ...and fails the other composite FK (as B)", await expectThrows(() => admin`insert into partner_payout_items (ledger_entry_id, payout_id, partner_id, currency) values (${sb.ledgerId}, ${p2.id}, ${B.id}, 'GEL')`));
  const bSeesA = await withPartnerContext(B.userId, B.id, (tx) => tx.select().from(partnerPayoutItems).where(eq(partnerPayoutItems.partnerId, A.id)));
  const aSeesOwn = await withPartnerContext(A.userId, A.id, (tx) => tx.select().from(partnerPayoutItems).where(eq(partnerPayoutItems.partnerId, A.id)));
  check("   RLS: Partner B can't read Partner A's payout items; A reads its own", bSeesA.length === 0 && aSeesOwn.length === 5);
  check(
    "   RLS: a partner session can't create payout items",
    await expectThrows(() => withPartnerContext(B.userId, B.id, (tx) => tx.insert(partnerPayoutItems).values({ ledgerEntryId: sb.ledgerId, payoutId: p2.id, partnerId: B.id, currency: "GEL" }))),
  );

  // ---------------------------------------------------------------------
  console.log("\n--- I. Old payout detail is unchanged by later rate/price changes ---");
  const p1Before = JSON.stringify((await asAdmin((tx) => listPartnerPayoutsWithItems(tx, A.id))).find((p) => p.id === p1.id)?.items.map((i) => [i.ledgerEntryId, i.amountMinor, i.grossAmountMinor]));
  await admin`update partners set commission_rate_bps = 5000 where id = ${A.id}`;
  await admin`update prices set amount_minor = 3000 where partner_id = ${A.id}`;
  const p1After = (await asAdmin((tx) => listPartnerPayoutsWithItems(tx, A.id))).find((p) => p.id === p1.id);
  check("I. Payout 1 still shows 3 × (15.00 sale, 3.00 commission) and 9.00 total", JSON.stringify(p1After?.items.map((i) => [i.ledgerEntryId, i.amountMinor, i.grossAmountMinor])) === p1Before && p1After?.amountMinor === 900 && p1Before.includes("1500"));
  await admin`update partners set commission_rate_bps = 2000 where id = ${A.id}`;
  await admin`update prices set amount_minor = 1500 where partner_id = ${A.id}`;

  // ---------------------------------------------------------------------
  console.log("\n--- E. Refund before payout -> excluded from the payable amount ---");
  await tick();
  const s6 = await sell(A);
  const s7 = await sell(A);
  await refundPaidOrder(adminUserId, s6.orderId);
  await tick();
  const t3 = new Date();
  const p3From = new Date(t2.getTime() + 1);
  const st3 = await statementFor(A.id, p3From, t3);
  const s6Rows = st3.candidates.filter((c) => c.orderId === s6.orderId);
  check("E. Refunded sale's commission and its reversal are both REVERSED, not payable", s6Rows.length === 2 && s6Rows.every((c) => c.state === "REVERSED") && !st3.eligibleLedgerEntryIds.includes(s6.ledgerId));
  check("   payable is only the un-refunded sale (3.00)", st3.payableMinor === 300 && st3.eligibleLedgerEntryIds.length === 1 && st3.reversedCount === 2);
  check("   DB: the refunded commission can't be linked to a payout even directly", await expectThrows(() => admin`insert into partner_payout_items (ledger_entry_id, payout_id, partner_id, currency) values (${s6.ledgerId}, ${p2.id}, ${A.id}, 'GEL')`));
  const p3 = await payFor(A.id, p3From, t3);
  check("   payout 3 = commission 7 only", JSON.stringify(await itemsOf(p3.id)) === JSON.stringify([s7.ledgerId]) && p3.amountMinor === 300);
  check("   balance is back to exactly zero", (await balanceOf(A.id)) === 0);

  // ---------------------------------------------------------------------
  console.log("\n--- F. Refund after payout -> history kept, reversal hits the balance ---");
  await refundPaidOrder(adminUserId, s1.orderId);
  check("F. Payout 1 still links commission 1 (history is not rewritten)", (await itemsOf(p1.id)).includes(s1.ledgerId) && (await admin`select amount_minor from partner_payouts where id = ${p1.id}`)[0]?.amount_minor === 900);
  check("   partner balance goes negative by the reversed commission (-3.00)", (await balanceOf(A.id)) === -300);
  const p1Detail = (await asAdmin((tx) => listPartnerPayoutsWithItems(tx, A.id))).find((p) => p.id === p1.id);
  const s1Item = p1Detail?.items.find((i) => i.ledgerEntryId === s1.ledgerId);
  check("   payout 1 detail shows the later refund as still open", s1Item?.laterReversalMinor === -300 && s1Item?.laterReversalSettledByPayoutId === null);
  await tick();
  const s8 = await sell(A);
  const s9 = await sell(A);
  await tick();
  const t4 = new Date();
  const p4From = new Date(t3.getTime() + 1);
  const st4 = await statementFor(A.id, p4From, t4);
  const clawback = st4.candidates.find((c) => c.state === "CLAWBACK");
  check("   next statement nets the claw-back: 2 × 3.00 − 3.00 = 3.00", !!clawback && clawback.orderId === s1.orderId && st4.payableMinor === 300 && st4.eligibleLedgerEntryIds.length === 3);
  const p4 = await payFor(A.id, p4From, t4);
  const p4Items = await itemsOf(p4.id);
  check("   payout 4 settles commissions 8, 9 and the claw-back", p4.amountMinor === 300 && p4Items.length === 3 && p4Items.includes(s8.ledgerId) && p4Items.includes(s9.ledgerId) && p4Items.includes(clawback!.ledgerEntryId));
  const s1ItemAfter = (await asAdmin((tx) => listPartnerPayoutsWithItems(tx, A.id))).find((p) => p.id === p1.id)?.items.find((i) => i.ledgerEntryId === s1.ledgerId);
  check("   payout 1 detail now shows that refund settled by payout 4", s1ItemAfter?.laterReversalSettledByPayoutId === p4.id);
  check("   balance is zero again", (await balanceOf(A.id)) === 0);

  // ---------------------------------------------------------------------
  console.log("\n--- G. Concurrent payouts can't both claim the same commissions ---");
  await tick();
  const s10 = await sell(A);
  await tick();
  const t5 = new Date();
  const p5From = new Date(t4.getTime() + 1);
  const st5 = await statementFor(A.id, p5From, t5);
  const pay5 = () => asAdmin((tx) => recordManualPayout(tx, adminUserId, { partnerId: A.id, currency: "GEL", periodFrom: p5From, periodTo: t5, expectedAmountMinor: st5.payableMinor, expectedLedgerEntryIds: st5.eligibleLedgerEntryIds }));
  const race = await Promise.allSettled([pay5(), pay5(), pay5()]);
  check("G. 3 concurrent service payouts for the same commission -> exactly one succeeds", race.filter((r) => r.status === "fulfilled").length === 1, JSON.stringify(race.map((r) => r.status)));

  // Bypass the service entirely: two raw superuser transactions (different,
  // non-overlapping periods, so the period constraint can't be what stops
  // them) both try to settle the SAME new commission.
  const s11 = await sell(A);
  // Extra unpaid commission so the balance covers BOTH raw payouts: only the
  // item primary key (not the balance trigger) can stop the second one.
  const s11b = await sell(A);
  const rawPayout = (from: string, to: string) =>
    admin.begin(async (tx) => {
      const [p] = await tx`insert into partner_payouts (partner_id, currency, amount_minor, status, period_from, period_to, itemized) values (${A.id}, 'GEL', ${s11.commission}, 'PAID', ${from}, ${to}, true) returning id`;
      await tx`insert into partner_payout_items (ledger_entry_id, payout_id, partner_id, currency) values (${s11.ledgerId}, ${p!.id}, ${A.id}, 'GEL')`;
      await tx`insert into partner_ledger_entries (partner_id, payout_id, type, amount_minor, currency) values (${A.id}, ${p!.id}, 'PAYOUT', ${-s11.commission}, 'GEL')`;
    });
  const rawRace = await Promise.allSettled([rawPayout("2020-01-01", "2020-01-31"), rawPayout("2020-02-01", "2020-02-28")]);
  const [s11Links] = await admin`select count(*)::int as n from partner_payout_items where ledger_entry_id = ${s11.ledgerId}`;
  check("   2 concurrent raw DB transactions on one commission -> exactly one commits", rawRace.filter((r) => r.status === "fulfilled").length === 1 && s11Links?.n === 1, JSON.stringify(rawRace.map((r) => r.status)));
  check("   (the balance would have allowed both — the primary key is what stopped it)", (await balanceOf(A.id)) === s11b.commission);
  check("   s10 is linked to exactly one payout", (await admin`select count(*)::int as n from partner_payout_items where ledger_entry_id = ${s10.ledgerId}`)[0]?.n === 1);

  // ---------------------------------------------------------------------
  console.log("\n--- H. Client-supplied totals are never authoritative ---");
  await tick();
  const s12 = await sell(A);
  const s13 = await sell(A);
  await tick();
  const t6 = new Date();
  const p6From = new Date(t5.getTime() + 1);
  const st6 = await statementFor(A.id, p6From, t6);
  check("H. Tampered amount (+1) is rejected", await expectThrows(() => payFor(A.id, p6From, t6, { expectedAmountMinor: st6.payableMinor + 1 })));
  check("   partial payout (one commission's worth) is rejected — no splitting", await expectThrows(() => payFor(A.id, p6From, t6, { expectedAmountMinor: s12.commission, expectedLedgerEntryIds: [s12.ledgerId] })));
  check("   a fabricated ledger id is rejected", await expectThrows(() => payFor(A.id, p6From, t6, { expectedLedgerEntryIds: [...st6.eligibleLedgerEntryIds.slice(1), crypto.randomUUID()] })));
  check("   an open (not yet ended) period is rejected", await expectThrows(() => payFor(A.id, p6From, new Date(Date.now() + 3600_000))));
  check(
    "   DB: payout amount ≠ SUM(items) is rejected at COMMIT even for a superuser",
    await expectThrows(() =>
      admin.begin(async (tx) => {
        const [p] = await tx`insert into partner_payouts (partner_id, currency, amount_minor, status, period_from, period_to, itemized) values (${A.id}, 'GEL', ${s12.commission + 1}, 'PAID', '2020-03-01', '2020-03-31', true) returning id`;
        await tx`insert into partner_payout_items (ledger_entry_id, payout_id, partner_id, currency) values (${s12.ledgerId}, ${p!.id}, ${A.id}, 'GEL')`;
        await tx`insert into partner_ledger_entries (partner_id, payout_id, type, amount_minor, currency) values (${A.id}, ${p!.id}, 'PAYOUT', ${-(s12.commission + 1)}, 'GEL')`;
      }),
    ),
  );
  check(
    "   DB: an itemized payout without its PAYOUT ledger row is rejected at COMMIT",
    await expectThrows(() =>
      admin.begin(async (tx) => {
        const [p] = await tx`insert into partner_payouts (partner_id, currency, amount_minor, status, period_from, period_to, itemized) values (${A.id}, 'GEL', ${s12.commission}, 'PAID', '2020-04-01', '2020-04-30', true) returning id`;
        await tx`insert into partner_payout_items (ledger_entry_id, payout_id, partner_id, currency) values (${s12.ledgerId}, ${p!.id}, ${A.id}, 'GEL')`;
      }),
    ),
  );
  check("   DB: a payout with no items is rejected at COMMIT", await expectThrows(() => admin`insert into partner_payouts (partner_id, currency, amount_minor, status, period_from, period_to, itemized) values (${A.id}, 'GEL', 100, 'PAID', '2020-05-01', '2020-05-31', true)`));
  const p6 = await payFor(A.id, p6From, t6);
  check("   the untampered payout then succeeds with the server's amount", p6.amountMinor === st6.payableMinor && (await itemsOf(p6.id)).includes(s12.ledgerId) && (await itemsOf(p6.id)).includes(s13.ledgerId));

  // Legacy payouts keep working but can never receive items.
  const [legacy] = await admin`insert into partner_payouts (partner_id, currency, amount_minor, status, period_from, period_to, itemized) values (${B.id}, 'GEL', 100, 'PAID', '2020-06-01', '2020-06-30', false) returning id`;
  check("   DB: a legacy (non-itemized) payout can't be given items retroactively", await expectThrows(() => admin`insert into partner_payout_items (ledger_entry_id, payout_id, partner_id, currency) values (${sb.ledgerId}, ${legacy!.id}, ${B.id}, 'GEL')`));

  // ---------------------------------------------------------------------
  console.log("\n--- J. Every payout reconciles with its items and the ledger ---");
  const [recon] = await admin`
    select count(*) filter (where p.amount_minor <> coalesce(s.items_sum, -1) or coalesce(pl.amount_minor, 0) <> -p.amount_minor)::int as bad, count(*)::int as total
      from partner_payouts p
      left join (select i.payout_id, sum(l.amount_minor) as items_sum from partner_payout_items i join partner_ledger_entries l on l.id = i.ledger_entry_id group by i.payout_id) s on s.payout_id = p.id
      left join partner_ledger_entries pl on pl.payout_id = p.id and pl.type = 'PAYOUT'
     where p.partner_id = ${A.id}`;
  check("J. All of Partner A's payouts: amount = SUM(items) = −PAYOUT row", recon?.bad === 0 && (recon?.total ?? 0) >= 6, JSON.stringify(recon));
  const [unsettled] = await admin`
    select coalesce(sum(l.amount_minor), 0)::int as n from partner_ledger_entries l
     where l.partner_id = ${A.id} and l.type <> 'PAYOUT' and not exists (select 1 from partner_payout_items i where i.ledger_entry_id = l.id)`;
  check("   balance = SUM of rows not yet settled by any payout", unsettled?.n === (await balanceOf(A.id)));

  // ---------------------------------------------------------------------
  console.log("\n--- K. No greeting content in any financial view ---");
  const adminDetail = await asAdmin((tx) => listPartnerPayoutsWithItems(tx, A.id));
  const partnerDetail = await withPartnerContext(A.userId, A.id, (tx) => listPartnerPayoutsWithItems(tx, A.id));
  const stmt = await statementFor(A.id, t0, t6);
  const json = JSON.stringify([adminDetail, partnerDetail, stmt]);
  check("K. Admin payout detail, partner payout history and statement contain no message text", !json.includes(MESSAGE) && !/text_value|textValue|storage_path|edit_token/i.test(json));
  check("   partner sees its own payout history with paid-sales counts", partnerDetail.length === adminDetail.length && partnerDetail.find((p) => p.id === p1.id)?.paidSalesCount === 3);
  const partnerBSees = await withPartnerContext(B.userId, B.id, (tx) => listPartnerPayoutsWithItems(tx, A.id));
  check("   Partner B sees none of Partner A's payouts", partnerBSees.length === 0);

  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

async function cleanup() {
  console.log("\nCleaning up fixtures...");
  const p = created.partners;
  if (p.length) {
    await admin`delete from partner_payout_items where partner_id in ${admin(p)}`;
    await admin`delete from partner_ledger_entries where partner_id in ${admin(p)}`;
    await admin`delete from partner_payouts where partner_id in ${admin(p)}`;
    await admin`delete from payments where order_id in (select id from orders where partner_id in ${admin(p)})`;
    await admin`delete from orders where partner_id in ${admin(p)}`;
    await admin`delete from analytics_events where partner_id in ${admin(p)}`;
  }
  if (created.greetings.length) {
    await admin`delete from greeting_content where greeting_id in ${admin(created.greetings)}`;
    await admin`delete from greetings where id in ${admin(created.greetings)}`;
  }
  if (p.length) {
    await admin`delete from qr_codes where partner_id in ${admin(p)}`;
    await admin`delete from qr_batches where partner_id in ${admin(p)}`;
    await admin`delete from partner_members where partner_id in ${admin(p)}`;
    await admin`delete from partners where id in ${admin(p)}`;
  }
  if (created.adminUsers.length) {
    await admin`delete from audit_logs where actor_id in ${admin(created.adminUsers)}`;
    await admin`delete from admin_users where user_id in ${admin(created.adminUsers)}`;
  }
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

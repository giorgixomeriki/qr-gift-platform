/**
 * verify:qr-handover — Scan-to-Assign and physical handover (migrations/0026).
 *
 * Runs the REAL service code under the REAL app_runtime role (RLS on) against
 * the local stack only. The superuser connection is used for fixtures,
 * read-back assertions and "even the app role can't" checks.
 *
 * Covers: scan parsing (approved origins only), eligibility, reservation,
 * all-or-nothing creation, idempotency, concurrency (create + accept),
 * authorization (admin / partner / wrong partner / viewer), atomic
 * acceptance, dispute / reopen / reject / cancel, the attribution trigger's
 * single exception, inventory consistency, and financial non-effects
 * (no order, payment, ledger entry, activation or analytics event), plus a
 * sale after handover being attributed to the receiving partner.
 */
import Module from "node:module";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { sql, eq } = require("drizzle-orm") as typeof import("drizzle-orm");
const { withAdminContext, withPartnerContext, withUserContext } = require("../src/db/client") as typeof import("../src/db/client");
const { qrCodes, qrHandovers, qrHandoverItems, partners } = require("../src/db/schema") as typeof import("../src/db/schema");
const H = require("../src/lib/qr/handovers") as typeof import("../src/lib/qr/handovers");
const { parseScannedQr, tokenHint } = require("../src/lib/qr/scan-parse") as typeof import("../src/lib/qr/scan-parse");
const { createQrBatch } = require("../src/lib/qr/batches") as typeof import("../src/lib/qr/batches");
const { getPartnerInventorySummary } = require("../src/lib/dashboard/inventory") as typeof import("../src/lib/dashboard/inventory");
const { getPartnerMetrics } = require("../src/lib/dashboard/partner-metrics") as typeof import("../src/lib/dashboard/partner-metrics");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { generateEditToken, hashEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { resolveQrState } = require("../src/lib/qr/resolve-state") as typeof import("../src/lib/qr/resolve-state");
const { startCheckout, confirmPaymentSuccess, activatePaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
if (/supabase\.co|pooler\.supabase\.com/.test(migrationsUrl)) throw new Error("refusing to run against a hosted Supabase database");
const su = postgres(migrationsUrl, { max: 4 });
const RUN = randomUUID().slice(0, 8);

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}
async function errorOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const e = err as { code?: string; message?: string; cause?: { message?: string } };
    return [e.code, e.message, e.cause?.message].filter(Boolean).join(" | ") || "error";
  }
}

const APP = "https://qrapp.ge";

async function main() {
  // -------------------------------------------------------------------------
  console.log("\n--- 1. Scan parsing: only QR STARR card URLs ---");
  {
    const t = generatePublicToken();
    const ok = (raw: string) => { const r = parseScannedQr(raw, "http://localhost:3992"); return r.ok ? r.token : null; };
    check("printed URL recognized", ok(`${APP}/g/${t}`) === t);
    check("www host + trailing slash recognized", ok(`https://www.qrapp.ge/g/${t}/`) === t);
    check("running app's own origin recognized", ok(`http://localhost:3992/g/${t}`) === t);
    check("bare token (manual entry, any case) recognized", ok(t.toLowerCase()) === t);
    check("foreign host rejected", ok(`https://example.com/g/${t}`) === null);
    check("look-alike host rejected", ok(`https://qrapp.ge.evil.example/g/${t}`) === null && ok(`https://evilqrapp.ge/g/${t}`) === null);
    check("http:// production host rejected (scheme is part of the origin)", ok(`http://qrapp.ge/g/${t}`) === null);
    check("credentials in URL rejected", ok(`https://user:pw@qrapp.ge/g/${t}`) === null);
    check("query / fragment rejected", ok(`${APP}/g/${t}?x=1`) === null && ok(`${APP}/g/${t}#a`) === null);
    check("other paths rejected", ok(`${APP}/admin/g/${t}`) === null && ok(`${APP}/g/${t}/edit`) === null && ok(`${APP}/print/batch/${t}`) === null);
    check("malformed token rejected", ok(`${APP}/g/${t.slice(0, 23)}`) === null && ok(`${APP}/g/${t.slice(0, 23)}0`) === null);
    check("plain text / empty rejected", ok("hello world") === null && ok("   ") === null && !parseScannedQr(42, APP).ok);
    check("hint shows only last 4 chars", tokenHint(t) === `…${t.slice(-4)}` && !tokenHint(t).includes(t.slice(0, 8)));
  }

  // -------------------------------------------------------------------------
  console.log("\nSetting up fixtures...");
  const adminUserId = randomUUID();
  await su`insert into admin_users (user_id) values (${adminUserId})`;
  const [product] = await su`select id from products where key = 'PHOTO_GREETING' limit 1`;
  const [theme] = await su`select id from themes where key = 'minimal' limit 1`;
  if (!product || !theme) throw new Error("Seed data missing — run npm run db:seed first");

  // Leftover central stock from an earlier run on this test DB: retire it.
  await su`update partners set is_central_stock = false, slug = slug || '-retired-' || ${RUN} where is_central_stock or slug = 'qr-starr-central-stock'`;

  async function makePartner(tag: string, opts: { status?: "ACTIVE" | "SUSPENDED"; rateBps?: number } = {}) {
    const [p] = await su<{ id: string }[]>`insert into partners (slug, name, status, commission_rate_bps) values (${`ho-${tag}-${RUN}`}, ${`Handover ${tag} ${RUN}`}, ${opts.status ?? "ACTIVE"}, ${opts.rateBps ?? 0}) returning id`;
    const owner = randomUUID();
    await su`insert into partner_members (partner_id, user_id, role) values (${p!.id}, ${owner}, 'OWNER')`;
    await su`insert into prices (product_id, partner_id, currency, amount_minor) values (${product!.id}, ${p!.id}, 'GEL', 1500)`;
    return { id: p!.id, owner };
  }
  const A = await makePartner("a", { rateBps: 2000 });
  const B = await makePartner("b");
  const S = await makePartner("suspended", { status: "SUSPENDED" });
  const viewerA = randomUUID();
  await su`insert into partner_members (partner_id, user_id, role) values (${A.id}, ${viewerA}, 'VIEWER')`;

  const asAdmin = <T>(fn: (tx: import("../src/db/client").Tx) => Promise<T>) => withAdminContext(adminUserId, fn);

  const central = await asAdmin((tx) => H.ensureCentralStockPartner(tx, adminUserId));
  const centralAgain = await asAdmin((tx) => H.ensureCentralStockPartner(tx, adminUserId));
  check("central stock created once (idempotent), SUSPENDED, 0% commission",
    central.id === centralAgain.id && central.status === "SUSPENDED" &&
    (await su`select commission_rate_bps from partners where id = ${central.id}`)[0]?.commission_rate_bps === 0);
  check("a second central stock is impossible (unique index)",
    (await errorOf(() => su`insert into partners (slug, name, is_central_stock) values (${`dup-${RUN}`}, 'dup', true)`)) !== null);

  // Option A (existing workflow) prints central stock: a normal batch.
  const { batch: centralBatch, qrCodeIds } = await asAdmin((tx) =>
    createQrBatch(tx, { actorType: "ADMIN", actorId: adminUserId }, central.id, { label: `Print run ${RUN}`, quantity: 40 }),
  );
  check("existing batch creation works for central stock (40 cards)", qrCodeIds.length === 40);
  const cards = await su<{ id: string; public_token: string }[]>`select id, public_token from qr_codes where batch_id = ${centralBatch.id} order by public_token`;
  const tok = cards.map((c) => c.public_token);
  const idOf = new Map(cards.map((c) => [c.public_token, c.id]));

  // A partner-owned card (existing workflow) and lifecycle fixtures.
  const { batch: aBatch } = await asAdmin((tx) => createQrBatch(tx, { actorType: "ADMIN", actorId: adminUserId }, A.id, { label: `A own ${RUN}`, quantity: 2 }));
  const [aCard] = await su<{ public_token: string }[]>`select public_token from qr_codes where batch_id = ${aBatch.id} limit 1`;
  async function setStatus(token: string, status: string) {
    await su.begin(async (t) => {
      await t`set local session_replication_role = replica`;
      await t`update qr_codes set status = ${status}::qr_status where public_token = ${token}`;
    });
  }
  const [draftTok, activeTok, blockedTok, historyTok] = [tok[36]!, tok[37]!, tok[38]!, tok[39]!];
  await setStatus(draftTok, "DRAFT");
  await setStatus(activeTok, "ACTIVE");
  await setStatus(blockedTok, "BLOCKED");
  // A card whose draft was released back to AVAILABLE still has a greeting row.
  await su`insert into greetings (qr_code_id, theme_id, product_id, status) values (${idOf.get(historyTok)!}, ${theme!.id}, ${product!.id}, 'DRAFT')`;

  // Money / analytics baseline (must not move because of anything below except the explicit sale in §9).
  const money = async () => (await su`
    select (select count(*)::int from orders) o, (select count(*)::int from payments) p,
           (select count(*)::int from partner_ledger_entries) l, (select count(*)::int from analytics_events) e,
           (select count(*)::int from qr_codes where status = 'ACTIVE') act`)[0]!;
  const money0 = await money();

  // -------------------------------------------------------------------------
  console.log("\n--- 2. Eligibility (scan = identification, not ownership) ---");
  {
    const res = await asAdmin((tx) => H.evaluateCards(tx, [tok[0]!, draftTok, activeTok, blockedTok, historyTok, aCard!.public_token, generatePublicToken()]));
    const r = (i: number) => (res[i]!.eligible ? "eligible" : (res[i] as { reason: string }).reason);
    check("central AVAILABLE card eligible", r(0) === "eligible");
    check("DRAFT rejected", r(1) === "draft");
    check("ACTIVE rejected", r(2) === "active");
    check("BLOCKED rejected", r(3) === "blocked");
    check("card with greeting history rejected", r(4) === "has_history");
    check("a partner's AVAILABLE card is eligible for admin redistribution (holder reported)", r(5) === "eligible" && (res[5] as { holderName?: string }).holderName === `Handover a ${RUN}`);
    const scoped = await asAdmin((tx) => H.evaluateCards(tx, [aCard!.public_token], { sourcePartnerId: central.id }));
    check("…but refused in a central-stock handover (other source, holder named)", !scoped[0]!.eligible && (scoped[0] as { reason: string }).reason === "other_source" && (scoped[0] as { partnerName?: string }).partnerName === `Handover a ${RUN}`);
    const self = await asAdmin((tx) => H.evaluateCards(tx, [aCard!.public_token], { destinationPartnerId: A.id }));
    check("…and refused when the destination already holds it", !self[0]!.eligible && (self[0] as { reason: string }).reason === "same_as_destination");
    check("unknown token rejected", r(6) === "not_found");
    const partnerTry = await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => tx.select().from(qrHandovers)));
    check("partner can query only through RLS (no error, own rows only)", partnerTry === null);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 3. Create handover: exact cards, idempotent, all-or-nothing ---");
  const key1 = randomUUID();
  const sel1 = tok.slice(0, 20);
  const h1 = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: key1, toPartnerId: A.id, tokens: [...sel1, sel1[0]!] }));
  check("20 scanned cards (+1 duplicate scan) -> handover of exactly 20", h1.ok && h1.quantity === 20 && !h1.duplicate, h1);
  const h1Id = h1.ok ? h1.handoverId : "";
  const items1 = await su<{ public_token: string; reserved: boolean }[]>`select q.public_token, i.reserved from qr_handover_items i join qr_codes q on q.id = i.qr_code_id where i.handover_id = ${h1Id}`;
  check("items are exactly the scanned cards, all reserved", items1.length === 20 && items1.every((i) => i.reserved && sel1.includes(i.public_token)));
  const [row1] = await su`select status, from_partner_id, to_partner_id, created_by, quantity from qr_handovers where id = ${h1Id}`;
  check("handover records source, destination, actor, PENDING", row1?.status === "PENDING" && row1?.from_partner_id === central.id && row1?.to_partner_id === A.id && row1?.created_by === adminUserId);
  check("cards still owned by central stock while pending (creation ≠ delivery)",
    (await su`select count(*)::int n from qr_codes where public_token in ${su(sel1)} and partner_id = ${central.id}`)[0]?.n === 20);
  const replay = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: key1, toPartnerId: A.id, tokens: sel1 }));
  check("repeat submission (same key) returns the same handover, no duplicate", replay.ok && replay.duplicate && replay.handoverId === h1Id &&
    (await su`select count(*)::int n from qr_handovers where idempotency_key = ${key1}`)[0]?.n === 1);
  check("same key for another partner refused", (await errorOf(() => asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: key1, toPartnerId: B.id, tokens: sel1 })))) !== null);

  const reservedRes = await asAdmin((tx) => H.evaluateCards(tx, [sel1[3]!]));
  check("reserved card shows 'reserved' for the destination", !reservedRes[0]!.eligible && (reservedRes[0] as { reason: string }).reason === "reserved");
  const overlap = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: [tok[20]!, sel1[5]!] }));
  check("a reserved card can't go into a second handover (whole request refused)", !overlap.ok &&
    (await su`select count(*)::int n from qr_handover_items where qr_code_id = ${idOf.get(tok[20]!)!}`)[0]?.n === 0);
  const mixed = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: [tok[21]!, draftTok] }));
  check("one ineligible card (DRAFT) -> nothing created", !mixed.ok && (await su`select count(*)::int n from qr_handovers where to_partner_id = ${B.id}`)[0]?.n === 0);
  check("handover to central stock itself refused", (await errorOf(() => asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: A.id, idempotencyKey: randomUUID(), toPartnerId: central.id, tokens: [tok[22]!] })))) ?.includes("partner_is_central_stock") === true);
  check("handover to a suspended partner refused", (await errorOf(() => asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: S.id, tokens: [tok[22]!] })))) ?.includes("partner_inactive") === true);

  // -------------------------------------------------------------------------
  console.log("\n--- 4. Concurrency: two admins, overlapping cards ---");
  {
    const shared = [tok[22]!, tok[23]!];
    const results = await Promise.allSettled([
      asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: [...shared, tok[24]!] })),
      asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: A.id, tokens: [...shared, tok[25]!] })),
    ]);
    const okCount = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    const reservations = (await su`select count(*)::int n from qr_handover_items where qr_code_id in ${su(shared.map((t) => idOf.get(t)!))} and reserved`)[0]?.n;
    check("exactly one of two concurrent handovers wins; each card reserved once", okCount === 1 && reservations === 2, results.map((r) => (r.status === "fulfilled" ? r.value.ok : String(r.reason))));
    const keyC = randomUUID();
    const same = await Promise.allSettled([0, 1, 2].map(() => asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: keyC, toPartnerId: B.id, tokens: [tok[26]!] }))));
    check("3 concurrent submits with one key -> one handover", (await su`select count(*)::int n from qr_handovers where idempotency_key = ${keyC}`)[0]?.n === 1 &&
      same.every((r) => r.status === "fulfilled" && r.value.ok), same.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason))));
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 5. Authorization ---");
  {
    const stranger = randomUUID();
    check("signed-in non-admin can't create a handover (RLS)",
      (await errorOf(() => withUserContext(stranger, (tx) => H.createHandover(tx, stranger, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: A.id, tokens: [tok[27]!] })))) !== null);
    check("partner owner can't create a handover (RLS)",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => H.createHandover(tx, A.owner, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: A.id, tokens: [tok[27]!] })))) !== null);
    const bSees = await withPartnerContext(B.owner, B.id, (tx) => tx.select({ id: qrHandovers.id }).from(qrHandovers).where(eq(qrHandovers.id, h1Id)));
    const bItems = await withPartnerContext(B.owner, B.id, (tx) => tx.select().from(qrHandoverItems).where(eq(qrHandoverItems.handoverId, h1Id)));
    check("partner B can't see partner A's handover or its items", bSees.length === 0 && bItems.length === 0);
    const aList = await withPartnerContext(A.owner, A.id, (tx) => H.listPartnerHandovers(tx, A.id));
    check("partner A sees its own handover", aList.some((h) => h.id === h1Id));
    const wrong = await errorOf(() => withPartnerContext(B.owner, B.id, (tx) => H.partnerAcceptHandover(tx, h1Id)));
    check("wrong partner can't accept (looks like not found)", wrong?.includes("handover_not_found") === true, wrong);
    const viewer = await errorOf(() => withPartnerContext(viewerA, A.id, (tx) => H.partnerAcceptHandover(tx, h1Id)));
    check("VIEWER of the right partner can't accept", viewer?.includes("handover_forbidden") === true, viewer);
    check("partner can't update a handover row directly",
      (await withPartnerContext(A.owner, A.id, (tx) => tx.update(qrHandovers).set({ status: "CANCELLED" }).where(eq(qrHandovers.id, h1Id)).returning())).length === 0);
    check("partner can't flag itself as central stock",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => tx.update(partners).set({ isCentralStock: true }).where(eq(partners.id, A.id))))) !== null);
    check("app role can't write the acceptance mark table",
      (await errorOf(() => asAdmin((tx) => tx.execute(sql`insert into qr_handover_acceptance_marks (handover_id, txid) values (${h1Id}, txid_current())`)))) !== null);
    check("admin can't mark a handover ACCEPTED directly",
      (await errorOf(() => asAdmin((tx) => tx.update(qrHandovers).set({ status: "ACCEPTED", resolvedAt: new Date(), resultBatchId: centralBatch.id }).where(eq(qrHandovers.id, h1Id))))) !== null);
    check("admin can't move a reserved card's owner directly (0013 rule still holds)",
      (await errorOf(() => asAdmin((tx) => tx.update(qrCodes).set({ partnerId: A.id, batchId: aBatch.id }).where(eq(qrCodes.publicToken, sel1[0]!))))) !== null);
    check("…not even with a forged session flag",
      (await errorOf(() => asAdmin(async (tx) => {
        await tx.execute(sql`select set_config('app.qr_handover_transfer', ${h1Id}, true)`);
        await tx.update(qrCodes).set({ partnerId: A.id, batchId: aBatch.id }).where(eq(qrCodes.publicToken, sel1[0]!));
      }))) !== null);
    check("handover items can't be deleted by the app role",
      (await errorOf(() => asAdmin((tx) => tx.delete(qrHandoverItems).where(eq(qrHandoverItems.handoverId, h1Id))))) !== null);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 6. Acceptance: atomic, idempotent, inventory consistent ---");
  const invA0 = await asAdmin((tx) => getPartnerInventorySummary(tx, A.id));
  const phys0 = await asAdmin((tx) => H.getPhysicalInventorySummary(tx));
  const batchesA0 = (await su`select count(*)::int n from qr_batches where partner_id = ${A.id}`)[0]?.n as number;
  const acc = await Promise.allSettled([0, 1].map(() => withPartnerContext(A.owner, A.id, (tx) => H.partnerAcceptHandover(tx, h1Id))));
  const batchIds = acc.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ batchId: string }>).value.batchId);
  check("two concurrent confirmations -> both succeed, ONE new batch", batchIds.length === 2 && batchIds[0] === batchIds[1] &&
    (await su`select count(*)::int n from qr_batches where partner_id = ${A.id}`)[0]?.n === batchesA0 + 1, acc.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason))));
  const again = await withPartnerContext(A.owner, A.id, (tx) => H.partnerAcceptHandover(tx, h1Id));
  check("repeat confirmation is a no-op returning the same batch", again.batchId === batchIds[0]);
  const moved = await su`select partner_id, batch_id, status, distribution_status, public_token from qr_codes where public_token in ${su(sel1)}`;
  check("all 20 cards now owned by A in the new batch, DISTRIBUTED, still AVAILABLE",
    moved.length === 20 && moved.every((c) => c.partner_id === A.id && c.batch_id === batchIds[0] && c.status === "AVAILABLE" && c.distribution_status === "DISTRIBUTED"));
  check("printed tokens unchanged (URLs stay valid)", moved.every((c) => sel1.includes(c.public_token as string)));
  const [hAcc] = await su`select status, resolved_by, resolved_actor_type, result_batch_id from qr_handovers where id = ${h1Id}`;
  check("handover ACCEPTED by the partner user", hAcc?.status === "ACCEPTED" && hAcc?.resolved_by === A.owner && hAcc?.resolved_actor_type === "PARTNER");
  check("reservations released", (await su`select count(*)::int n from qr_handover_items where handover_id = ${h1Id} and reserved`)[0]?.n === 0);
  check("audit trail: created + accepted", (await su`select action from audit_logs where target_id = ${h1Id} order by created_at`).map((r) => r.action).join(",") === "QR_HANDOVER_CREATED,QR_HANDOVER_ACCEPTED");
  const invA1 = await asAdmin((tx) => getPartnerInventorySummary(tx, A.id));
  const metA1 = await withPartnerContext(A.owner, A.id, (tx) => getPartnerMetrics(tx, A.id));
  check("A's inventory +20 issued / +20 available / +20 distributed (admin view)",
    invA1.issued === invA0.issued + 20 && invA1.available === invA0.available + 20 && invA1.distributed === invA0.distributed + 20, { invA0, invA1 });
  check("partner dashboard shows the same numbers as the admin page",
    metA1.qrIssued === invA1.issued && metA1.qrAvailable === invA1.available && metA1.qrDistributed === invA1.distributed);
  const phys1 = await asAdmin((tx) => H.getPhysicalInventorySummary(tx));
  check("admin physical inventory: central -20, partners +20, received +20, generated unchanged",
    phys1.inCentralStock === phys0.inCentralStock - 20 && phys1.heldByPartners === phys0.heldByPartners + 20 &&
    phys1.receivedByPartners === phys0.receivedByPartners + 20 && phys1.generated === phys0.generated &&
    phys1.inCentralStock + phys1.heldByPartners === phys1.generated, { phys0, phys1 });
  check("accepted handover is terminal (admin can't cancel it)",
    (await errorOf(() => asAdmin((tx) => H.adminTransitionHandover(tx, adminUserId, h1Id, "cancel")))) !== null);
  check("moved card is now A's: refused for a central-stock handover, eligible only as an A-sourced redistribution",
    (await asAdmin((tx) => H.evaluateCards(tx, [sel1[0]!], { sourcePartnerId: central.id })))[0]!.eligible === false &&
    (await asAdmin((tx) => H.evaluateCards(tx, [sel1[0]!], { sourcePartnerId: A.id })))[0]!.eligible === true);

  // -------------------------------------------------------------------------
  console.log("\n--- 7. Failure is all-or-nothing ---");
  {
    const sel = [tok[28]!, tok[29]!, tok[30]!];
    const h = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: sel }));
    const hid = h.ok ? h.handoverId : "";
    await setStatus(sel[1]!, "DRAFT"); // a customer started this card meanwhile
    const batchesB0 = (await su`select count(*)::int n from qr_batches where partner_id = ${B.id}`)[0]?.n;
    const err = await errorOf(() => withPartnerContext(B.owner, B.id, (tx) => H.partnerAcceptHandover(tx, hid)));
    check("acceptance refused when one card became ineligible", err?.includes("handover_cards_ineligible:1") === true, err);
    check("…and nothing moved, no batch created, still PENDING",
      (await su`select count(*)::int n from qr_codes where public_token in ${su(sel)} and partner_id = ${central.id}`)[0]?.n === 3 &&
      (await su`select count(*)::int n from qr_batches where partner_id = ${B.id}`)[0]?.n === batchesB0 &&
      (await su`select status from qr_handovers where id = ${hid}`)[0]?.status === "PENDING");
    await asAdmin((tx) => H.adminTransitionHandover(tx, adminUserId, hid, "cancel", "card started by a customer"));
    const again2 = await asAdmin((tx) => H.adminTransitionHandover(tx, adminUserId, hid, "cancel"));
    check("admin cancel releases reservations; repeat cancel is a no-op",
      again2.status === "CANCELLED" && (await su`select count(*)::int n from qr_handover_items where handover_id = ${hid} and reserved`)[0]?.n === 0);
    check("released cards are eligible again", (await asAdmin((tx) => H.evaluateCards(tx, [sel[0]!, sel[2]!]))).every((c) => c.eligible));
    check("cancelled handover can't be accepted", (await errorOf(() => withPartnerContext(B.owner, B.id, (tx) => H.partnerAcceptHandover(tx, hid))))?.includes("handover_not_pending") === true);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 8. Discrepancy: held for admin resolution ---");
  {
    const sel = [tok[31]!, tok[32]!, tok[33]!];
    const h = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: sel }));
    const hid = h.ok ? h.handoverId : "";
    check("empty discrepancy note refused", (await errorOf(() => withPartnerContext(B.owner, B.id, (tx) => H.partnerDisputeHandover(tx, hid, 2, "  "))))?.includes("dispute_note_invalid") === true);
    await withPartnerContext(B.owner, B.id, (tx) => H.partnerDisputeHandover(tx, hid, 2, "Only 2 cards in the envelope"));
    await withPartnerContext(B.owner, B.id, (tx) => H.partnerDisputeHandover(tx, hid, 2, "again"));
    const [d] = await su`select status, dispute_received_count, dispute_note from qr_handovers where id = ${hid}`;
    check("partner report -> DISPUTED with count + note (repeat is a no-op)", d?.status === "DISPUTED" && d?.dispute_received_count === 2 && d?.dispute_note === "Only 2 cards in the envelope");
    check("reservation kept while disputed", (await su`select count(*)::int n from qr_handover_items where handover_id = ${hid} and reserved`)[0]?.n === 3);
    check("disputed handover can't be accepted", (await errorOf(() => withPartnerContext(B.owner, B.id, (tx) => H.partnerAcceptHandover(tx, hid))))?.includes("handover_not_pending") === true);
    check("admin can't cancel a disputed one (must reopen or reject)", (await errorOf(() => asAdmin((tx) => H.adminTransitionHandover(tx, adminUserId, hid, "cancel")))) !== null);
    await asAdmin((tx) => H.adminTransitionHandover(tx, adminUserId, hid, "reopen"));
    check("admin reopen -> PENDING again", (await su`select status from qr_handovers where id = ${hid}`)[0]?.status === "PENDING");
    await withPartnerContext(B.owner, B.id, (tx) => H.partnerDisputeHandover(tx, hid, 2, "still 2"));
    await asAdmin((tx) => H.adminTransitionHandover(tx, adminUserId, hid, "reject", "recount: wrong envelope"));
    const [r] = await su`select status, resolved_actor_type from qr_handovers where id = ${hid}`;
    check("admin reject -> REJECTED, reservations released, cards still central",
      r?.status === "REJECTED" && r?.resolved_actor_type === "ADMIN" &&
      (await su`select count(*)::int n from qr_handover_items where handover_id = ${hid} and reserved`)[0]?.n === 0 &&
      (await su`select count(*)::int n from qr_codes where public_token in ${su(sel)} and partner_id = ${central.id}`)[0]?.n === 3);
    check("terminal handover can't be reopened", (await errorOf(() => asAdmin((tx) => H.adminTransitionHandover(tx, adminUserId, hid, "reopen")))) !== null);
    check("audit trail for the dispute path",
      (await su`select action from audit_logs where target_id = ${hid} order by created_at`).map((x) => x.action).join(",") ===
      "QR_HANDOVER_CREATED,QR_HANDOVER_DISPUTED,QR_HANDOVER_REOPENED,QR_HANDOVER_DISPUTED,QR_HANDOVER_REJECTED");
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 9. Database integrity rules ---");
  {
    check("quantity must equal items (checked at commit)",
      (await errorOf(() => asAdmin(async (tx) => {
        const [h] = await tx.insert(qrHandovers).values({ fromPartnerId: central.id, toPartnerId: B.id, quantity: 2, idempotencyKey: randomUUID(), createdBy: adminUserId }).returning();
        await tx.insert(qrHandoverItems).values({ handoverId: h!.id, qrCodeId: idOf.get(tok[34]!)!, fromBatchId: centralBatch.id });
      }))) !== null);
    check("items can't be added to a non-pending handover",
      (await errorOf(() => asAdmin((tx) => tx.insert(qrHandoverItems).values({ handoverId: h1Id, qrCodeId: idOf.get(tok[35]!)!, fromBatchId: centralBatch.id })))) !== null);
    check("an item must be held by the handover's source (checked by the DB)",
      (await errorOf(() => asAdmin(async (tx) => {
        const [h] = await tx.insert(qrHandovers).values({ fromPartnerId: central.id, toPartnerId: B.id, quantity: 1, idempotencyKey: randomUUID(), createdBy: adminUserId }).returning();
        const [aOwn] = await tx.select({ id: qrCodes.id }).from(qrCodes).where(eq(qrCodes.batchId, aBatch.id)).limit(1);
        await tx.insert(qrHandoverItems).values({ handoverId: h!.id, qrCodeId: aOwn!.id, fromBatchId: aBatch.id });
      }))) !== null);
    check("handover identity is immutable",
      (await errorOf(() => su`update qr_handovers set to_partner_id = ${B.id} where id = ${h1Id}`)) !== null);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 10. Financial: handover never sells, pays, activates or commissions ---");
  const money1 = await money();
  check("no order, payment, ledger entry, analytics event or activation created by scan/handover/accept/dispute",
    money1.o === money0.o && money1.p === money0.p && money1.l === money0.l && money1.e === money0.e && money1.act === money0.act, { money0, money1 });
  {
    // A customer later buys one of the handed-over cards: attribution is the receiving partner.
    const qrId = idOf.get(sel1[7]!)!;
    const greetingId = randomUUID();
    const editToken = generateEditToken();
    await su.begin(async (t) => {
      await t`update qr_codes set status = 'DRAFT' where id = ${qrId}`;
      await t`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values (${greetingId}, ${qrId}, ${theme!.id}, ${product!.id}, 'DRAFT', ${hashEditToken(editToken)})`;
      await t`insert into greeting_content (greeting_id, type, slot, text_value, status) values (${greetingId}, 'text', 0, 'handover verify', 'READY')`;
    });
    const { order } = await startCheckout({ greetingId, editToken, productId: product!.id as string });
    await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: `test_${order.grossAmountMinor}_${order.currency}_${randomUUID()}`, orderId: order.id, amountMinor: order.grossAmountMinor, currency: order.currency });
    await activatePaidOrder(order.id);
    const [chain] = await su`select o.partner_id, o.partner_commission_minor, l.partner_id ledger_partner, l.amount_minor from orders o join partner_ledger_entries l on l.order_id = o.id where o.id = ${order.id}`;
    check("a sale after handover is attributed to the receiving partner at its rate (20% of 15.00)",
      chain?.partner_id === A.id && chain?.ledger_partner === A.id && chain?.amount_minor === 300, chain);
    check("a sold card's owner can never change again",
      (await errorOf(() => asAdmin((tx) => tx.update(qrCodes).set({ partnerId: B.id }).where(eq(qrCodes.id, qrId))))) !== null);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 11. Admin-only redistribution: partner A -> partner B ---");
  {
    const moneyBefore = await money();
    const ledgerA = await su`select id, amount_minor from partner_ledger_entries where partner_id = ${A.id} order by id`;
    const soldTok = sel1[7]!; // sold in §10, attributed to A
    const pick = sel1.slice(8, 18); // 10 of A's received cards
    const invA0 = await asAdmin((tx) => getPartnerInventorySummary(tx, A.id));
    const invB0 = await asAdmin((tx) => getPartnerInventorySummary(tx, B.id));
    const total0 = (await su`select count(*)::int n from qr_codes`)[0]!.n;

    check("partner can't create a redistribution (RLS: admin only)",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => H.createHandover(tx, A.owner, { fromPartnerId: A.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: pick })))) !== null);
    const withSold = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: A.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: [...pick, soldTok] }));
    check("a sold (ACTIVE, ordered) card refuses the whole redistribution", !withSold.ok && (withSold.cards.find((c) => c.token === soldTok) as { reason?: string })?.reason === "active");
    const wrongSource = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: pick }));
    check("declared source must hold every card", !wrongSource.ok && wrongSource.cards.every((c) => !c.eligible && (c as { reason: string }).reason === "other_source"));
    check("source = destination refused", (await errorOf(() => asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: A.id, idempotencyKey: randomUUID(), toPartnerId: A.id, tokens: pick }))))?.includes("same_partner") === true);

    const h = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: A.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: pick }));
    const hid = h.ok ? h.handoverId : "";
    check("admin creates A -> B handover of 10", h.ok && h.quantity === 10);
    check("cards stay with A while pending", (await su`select count(*)::int n from qr_codes where public_token in ${su(pick)} and partner_id = ${A.id}`)[0]?.n === 10);
    check("sender A does not see the handover (only the receiver does)",
      (await withPartnerContext(A.owner, A.id, (tx) => tx.select({ id: qrHandovers.id }).from(qrHandovers).where(eq(qrHandovers.id, hid)))).length === 0);
    check("sender A can't accept it", (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => H.partnerAcceptHandover(tx, hid))))?.includes("handover_not_found") === true);
    const bList = await withPartnerContext(B.owner, B.id, (tx) => H.listPartnerHandovers(tx, B.id));
    check("receiver's view has no source partner field", bList.some((x) => x.id === hid) && bList.every((x) => !("fromPartnerName" in x)));
    const conc = await Promise.allSettled([
      asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: A.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: [pick[0]!] })),
    ]);
    check("a card in a pending redistribution can't be reserved again", conc.every((r) => r.status === "fulfilled" && !r.value.ok));

    await withPartnerContext(B.owner, B.id, (tx) => H.partnerAcceptHandover(tx, hid));
    const invA1 = await asAdmin((tx) => getPartnerInventorySummary(tx, A.id));
    const invB1 = await asAdmin((tx) => getPartnerInventorySummary(tx, B.id));
    const total1 = (await su`select count(*)::int n from qr_codes`)[0]!.n;
    check("A -10, B +10, global unchanged", invA1.issued === invA0.issued - 10 && invB1.issued === invB0.issued + 10 && total1 === total0, { invA0: invA0.issued, invA1: invA1.issued, invB0: invB0.issued, invB1: invB1.issued });
    check("status totals consistent (available moved, nothing else)", invA1.available === invA0.available - 10 && invB1.available === invB0.available + 10 && invA1.active === invA0.active && invB1.draft === invB0.draft);
    const metB = await withPartnerContext(B.owner, B.id, (tx) => getPartnerMetrics(tx, B.id));
    check("partner B dashboard = admin view of B", metB.qrIssued === invB1.issued && metB.qrAvailable === invB1.available && metB.qrDistributed === invB1.distributed);
    const hist = await su`select count(*)::int n from qr_handover_items i join qr_batches b on b.id = i.from_batch_id where i.handover_id = ${hid} and b.partner_id = ${A.id}`;
    check("history keeps each card's original batch (A's)", hist[0]?.n === 10);
    check("the earlier sale stays attributed to A (order + ledger unchanged)",
      (await su`select o.partner_id from orders o join qr_codes q on q.id = o.qr_code_id where q.public_token = ${soldTok}`)[0]?.partner_id === A.id &&
      JSON.stringify(await su`select id, amount_minor from partner_ledger_entries where partner_id = ${A.id} order by id`) === JSON.stringify(ledgerA));
    const moneyAfter = await money();
    check("redistribution created no order, payment, commission, analytics event or activation", JSON.stringify(moneyAfter) === JSON.stringify(moneyBefore), { moneyBefore, moneyAfter });
    check("audit: created (kind PARTNER_TO_PARTNER) + accepted",
      (await su`select action, metadata->>'kind' kind from audit_logs where target_id = ${hid} order by created_at`).map((r) => `${r.action}${r.kind ? `:${r.kind}` : ""}`).join(",") === "QR_HANDOVER_CREATED:PARTNER_TO_PARTNER,QR_HANDOVER_ACCEPTED");
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 12. Central stock is never a commercial partner ---");
  {
    check("can't be reactivated", (await errorOf(() => asAdmin((tx) => tx.update(partners).set({ status: "ACTIVE" }).where(eq(partners.id, central.id))))) !== null);
    check("can't earn commission", (await errorOf(() => su`update partners set commission_rate_bps = 1000 where id = ${central.id}`)) !== null);
    check("can't get a login (member)", (await errorOf(() => su`insert into partner_members (partner_id, user_id, role) values (${central.id}, ${randomUUID()}, 'OWNER')`)) !== null);
    check("can't get an invitation",
      (await errorOf(() => su`insert into partner_invitations (partner_id, channel, contact, expires_at, created_by) values (${central.id}, 'EMAIL', ${`c-${RUN}@verify.test`}, now() + interval '1 day', ${adminUserId})`)) !== null);
    check("can't receive a handover (even inserted directly)",
      (await errorOf(() => su.begin(async (t) => {
        await t`insert into qr_handovers (from_partner_id, to_partner_id, quantity, idempotency_key, created_by) values (${A.id}, ${central.id}, 1, ${randomUUID()}, ${adminUserId})`;
      }))) !== null);
    check("a partner with a login can't be flagged as central stock",
      (await errorOf(() => su.begin(async (t) => {
        await t`update partners set is_central_stock = false where id = ${central.id}`;
        await t`update partners set status = 'SUSPENDED', is_central_stock = true where id = ${B.id}`;
      }))) !== null);
    const [centralCard] = await su<{ public_token: string }[]>`select public_token from qr_codes where partner_id = ${central.id} and status = 'AVAILABLE' limit 1`;
    const state = await resolveQrState(centralCard!.public_token);
    check("a central-stock card can't be started by a customer (/g resolves blocked)", state.kind === "blocked", state);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await su.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await su.end();
  process.exit(1);
});

/**
 * verify:qr-handover — Scan-to-Assign and admin QR transfers (migrations/0026 + 0027).
 *
 * Runs the REAL service code under the REAL app_runtime role (RLS on) against
 * the local stack only. The superuser connection is used for fixtures,
 * read-back assertions and "even the app role can't" checks.
 *
 * Covers (0026 + 0027 immediate admin transfers): scan parsing (approved
 * origins only), eligibility (service AND database function), immediate
 * atomic transfer with no partner step, idempotency, concurrency, partial-
 * failure rollback, authorization (admin only; partners can't transfer,
 * accept, approve or reassign — not even calling the DB directly), function
 * and table privileges, non-blocking count-mismatch reports, the legacy
 * PENDING transition (never auto-accepted), inventory consistency between the
 * admin and partner views, and financial non-effects (no order, payment,
 * ledger entry, activation or analytics event), plus a sale after a transfer
 * being attributed to the receiving partner.
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
const { getBatchPerformance, getQrResults } = require("../src/lib/dashboard/attribution") as typeof import("../src/lib/dashboard/attribution");
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
    createQrBatch(tx, { actorType: "ADMIN", actorId: adminUserId }, central.id, { label: `Print run ${RUN}`, quantity: 60 }),
  );
  check("existing QR generation still works (central stock batch of 60)", qrCodeIds.length === 60);
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
  const [draftTok, activeTok, blockedTok, historyTok] = [tok[56]!, tok[57]!, tok[58]!, tok[59]!];
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
  console.log("\n--- 3. Admin transfer: immediate, exact cards, no partner step ---");
  const invA0 = await asAdmin((tx) => getPartnerInventorySummary(tx, A.id));
  const phys0 = await asAdmin((tx) => H.getPhysicalInventorySummary(tx));
  const batchesA0 = (await su`select count(*)::int n from qr_batches where partner_id = ${A.id}`)[0]?.n as number;
  const key1 = randomUUID();
  const sel1 = tok.slice(0, 20);
  const h1 = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: key1, toPartnerId: A.id, tokens: [...sel1, sel1[0]!] }));
  check("20 scanned cards (+1 duplicate scan) -> one transfer of exactly 20", h1.ok && h1.quantity === 20 && !h1.duplicate, h1);
  const h1Id = h1.ok ? h1.handoverId : "";
  const [row1] = await su`select status, from_partner_id, to_partner_id, created_by, resolved_by, resolved_actor_type, result_batch_id, resolved_at from qr_handovers where id = ${h1Id}`;
  check("transfer is complete at once: ACCEPTED, resolved by the ADMIN, never PENDING",
    row1?.status === "ACCEPTED" && row1?.resolved_actor_type === "ADMIN" && row1?.resolved_by === adminUserId && row1?.created_by === adminUserId &&
    row1?.from_partner_id === central.id && row1?.to_partner_id === A.id && row1?.resolved_at !== null);
  const moved = await su`select partner_id, batch_id, status, distribution_status, public_token from qr_codes where public_token in ${su(sel1)}`;
  check("all 20 cards now owned by A in one new batch, DISTRIBUTED, still AVAILABLE",
    moved.length === 20 && moved.every((c) => c.partner_id === A.id && c.batch_id === row1?.result_batch_id && c.status === "AVAILABLE" && c.distribution_status === "DISTRIBUTED"));
  check("exactly one new batch for A", (await su`select count(*)::int n from qr_batches where partner_id = ${A.id}`)[0]?.n === batchesA0 + 1);
  check("printed tokens unchanged (URLs stay valid)", moved.every((c) => sel1.includes(c.public_token as string)));
  const items1 = await su<{ reserved: boolean; from_batch_id: string }[]>`select reserved, from_batch_id from qr_handover_items where handover_id = ${h1Id}`;
  check("history keeps the 20 exact cards with their original batch; nothing left reserved", items1.length === 20 && items1.every((i) => !i.reserved && i.from_batch_id === centralBatch.id));
  check("audit: one QR_HANDOVER_TRANSFERRED (CENTRAL_TO_PARTNER, 20 cards)",
    JSON.stringify((await su`select action, metadata->>'kind' kind, (metadata->>'quantity')::int q from audit_logs where target_id = ${h1Id} order by created_at`).map((r) => [r.action, r.kind, r.q])) ===
    JSON.stringify([["QR_HANDOVER_TRANSFERRED", "CENTRAL_TO_PARTNER", 20]]));
  check("result reports the new totals (A holds +20 available; central -20)",
    h1.ok && h1.totals.destinationAvailable === invA0.available + 20 && h1.totals.sourceHeld === phys0.inCentralStock - 20, h1.ok ? h1.totals : h1);

  const invA1 = await asAdmin((tx) => getPartnerInventorySummary(tx, A.id));
  const metA1 = await withPartnerContext(A.owner, A.id, (tx) => getPartnerMetrics(tx, A.id));
  check("partner A's inventory updated without any partner action (+20 issued / available / distributed)",
    invA1.issued === invA0.issued + 20 && invA1.available === invA0.available + 20 && invA1.distributed === invA0.distributed + 20, { invA0, invA1 });
  check("partner dashboard shows the same numbers as the admin page",
    metA1.qrIssued === invA1.issued && metA1.qrAvailable === invA1.available && metA1.qrDistributed === invA1.distributed);
  const aList = await withPartnerContext(A.owner, A.id, (tx) => H.listPartnerHandovers(tx, A.id));
  check("partner A sees the transfer in its history (read-only, status ACCEPTED)", aList.some((h) => h.id === h1Id && h.status === "ACCEPTED"));
  const phys1 = await asAdmin((tx) => H.getPhysicalInventorySummary(tx));
  check("admin physical inventory: central -20, partners +20, received +20, generated unchanged, nothing reserved/open",
    phys1.inCentralStock === phys0.inCentralStock - 20 && phys1.heldByPartners === phys0.heldByPartners + 20 &&
    phys1.receivedByPartners === phys0.receivedByPartners + 20 && phys1.generated === phys0.generated &&
    phys1.inCentralStock + phys1.heldByPartners === phys1.generated && phys1.reserved === 0 && phys1.pendingHandovers === 0 && phys1.disputedHandovers === 0, { phys0, phys1 });
  check("completed transfer is terminal (admin can't cancel it)",
    (await errorOf(() => asAdmin((tx) => H.adminTransitionHandover(tx, adminUserId, h1Id, "cancel")))) !== null);
  check("moved card is now A's: refused from central, eligible only as an A-sourced redistribution",
    (await asAdmin((tx) => H.evaluateCards(tx, [sel1[0]!], { sourcePartnerId: central.id })))[0]!.eligible === false &&
    (await asAdmin((tx) => H.evaluateCards(tx, [sel1[0]!], { sourcePartnerId: A.id })))[0]!.eligible === true);

  // -------------------------------------------------------------------------
  console.log("\n--- 4. Idempotency and concurrency ---");
  {
    const replay = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: key1, toPartnerId: A.id, tokens: sel1 }));
    check("repeat submission (same key) returns the same transfer, nothing moves twice", replay.ok && replay.duplicate && replay.handoverId === h1Id &&
      (await su`select count(*)::int n from qr_handovers where idempotency_key = ${key1}`)[0]?.n === 1 &&
      (await su`select count(*)::int n from qr_batches where partner_id = ${A.id}`)[0]?.n === batchesA0 + 1);
    check("same key for another partner refused", (await errorOf(() => asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: key1, toPartnerId: B.id, tokens: sel1 }))))?.includes("idempotency_conflict") === true);
    check("same key with a different card count refused", (await errorOf(() => asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: key1, toPartnerId: A.id, tokens: sel1.slice(0, 5) }))))?.includes("idempotency_conflict") === true);

    const keyC = randomUUID();
    const same = await Promise.allSettled([0, 1, 2].map(() => asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: keyC, toPartnerId: B.id, tokens: [tok[20]!] }))));
    check("3 concurrent submits with one key -> one transfer, one batch, all report success",
      (await su`select count(*)::int n from qr_handovers where idempotency_key = ${keyC}`)[0]?.n === 1 &&
      same.every((r) => r.status === "fulfilled" && r.value.ok) &&
      same.filter((r) => r.status === "fulfilled" && r.value.ok && !r.value.duplicate).length === 1,
      same.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason))));

    const shared = [tok[21]!, tok[22]!];
    const batchesAB0 = (await su`select count(*)::int n from qr_batches where partner_id in (${A.id}, ${B.id})`)[0]?.n as number;
    const results = await Promise.allSettled([
      asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: [...shared, tok[23]!] })),
      asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: A.id, tokens: [...shared, tok[24]!] })),
    ]);
    const wins = results.filter((r) => r.status === "fulfilled" && r.value.ok);
    const owners = await su<{ partner_id: string }[]>`select distinct partner_id from qr_codes where public_token in ${su(shared)}`;
    const winner = wins.length === 1 ? (await su`select to_partner_id from qr_handovers where id = ${(wins[0] as PromiseFulfilledResult<{ ok: true; handoverId: string }>).value.handoverId}`)[0]?.to_partner_id : null;
    const loserCard = winner === B.id ? tok[24]! : tok[23]!;
    check("two concurrent transfers of the same cards to different partners: exactly one wins, cards have ONE owner",
      wins.length === 1 && owners.length === 1 && owners[0]!.partner_id === winner &&
      (await su`select partner_id from qr_codes where public_token = ${loserCard}`)[0]?.partner_id === central.id &&
      (await su`select count(*)::int n from qr_batches where partner_id in (${A.id}, ${B.id})`)[0]?.n === batchesAB0 + 1,
      results.map((r) => (r.status === "fulfilled" ? r.value.ok : String(r.reason))));
    check("…the losing request moved nothing (its own non-shared card is still in central stock)",
      (await su`select count(*)::int n from qr_handover_items i join qr_codes q on q.id = i.qr_code_id where q.public_token = ${loserCard}`)[0]?.n === 0);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 5. Eligibility is enforced by the database, not just the UI ---");
  {
    const call = (fromId: string, toId: string, ids: string[]) =>
      asAdmin((tx) => tx.execute(sql`select app_admin_transfer_qr_cards(${randomUUID()}::uuid, ${fromId}::uuid, ${toId}::uuid, ${`{${ids.join(",")}}`}::uuid[], null)`));
    const good = idOf.get(tok[25]!)!;
    for (const [label, t] of [["DRAFT", draftTok], ["ACTIVE", activeTok], ["BLOCKED", blockedTok], ["greeting history", historyTok]] as const) {
      const err = await errorOf(() => call(central.id, B.id, [good, idOf.get(t)!]));
      check(`DB function refuses a ${label} card (whole request, nothing moved)`,
        err?.includes("handover_cards_ineligible:1") === true && (await su`select partner_id from qr_codes where id = ${good}`)[0]?.partner_id === central.id, err);
    }
    check("DB function refuses a card the declared source doesn't hold",
      (await errorOf(() => call(central.id, B.id, [good, idOf.get(sel1[1]!)!])))?.includes("handover_cards_ineligible:1") === true);
    check("DB function refuses an unknown card id",
      (await errorOf(() => call(central.id, B.id, [good, randomUUID()])))?.includes("handover_cards_ineligible:1") === true);
    check("DB function refuses an empty list / >500 cards",
      (await errorOf(() => call(central.id, B.id, [])))?.includes("no_cards") === true &&
      (await errorOf(() => call(central.id, B.id, Array.from({ length: 501 }, () => randomUUID()))))?.includes("too_many_cards") === true);
    check("DB function refuses central stock as destination / suspended partner / same partner",
      (await errorOf(() => call(A.id, central.id, [idOf.get(sel1[1]!)!])))?.includes("partner_is_central_stock") === true &&
      (await errorOf(() => call(central.id, S.id, [good])))?.includes("partner_inactive") === true &&
      (await errorOf(() => call(central.id, central.id, [good])))?.includes("same_partner") === true);
    const mixed = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: [tok[25]!, draftTok, activeTok, blockedTok] }));
    check("service layer: mixed selection -> friendly per-card reasons, nothing created",
      !mixed.ok && ["draft", "active", "blocked"].every((r) => mixed.cards.some((c) => !c.eligible && (c as { reason: string }).reason === r)) &&
      (await su`select count(*)::int n from qr_handover_items where qr_code_id = ${good}`)[0]?.n === 0);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 6. Authorization: only an admin transfers; partners can't accept, approve or reassign ---");
  {
    const stranger = randomUUID();
    check("signed-in non-admin can't transfer",
      (await errorOf(() => withUserContext(stranger, (tx) => H.createHandover(tx, stranger, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: A.id, tokens: [tok[26]!] })))) !== null);
    check("partner owner can't transfer through the service",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => H.createHandover(tx, A.owner, { fromPartnerId: A.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: [sel1[2]!] })))) !== null);
    check("partner owner calling the DB transfer function directly -> handover_forbidden",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => tx.execute(sql`select app_admin_transfer_qr_cards(${randomUUID()}::uuid, ${A.id}::uuid, ${B.id}::uuid, ${`{${idOf.get(sel1[2]!)!}}`}::uuid[], null)`))))?.includes("handover_forbidden") === true);
    check("partner can't call the old accept function (privilege revoked)",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => tx.execute(sql`select app_accept_qr_handover(${h1Id}::uuid)`))))?.includes("permission denied") === true);
    check("partner can't call the old dispute function (privilege revoked)",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => tx.execute(sql`select app_dispute_qr_handover(${h1Id}::uuid, 1, 'x')`))))?.includes("permission denied") === true);
    check("partner can't insert a handover row",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => tx.insert(qrHandovers).values({ fromPartnerId: A.id, toPartnerId: B.id, quantity: 1, idempotencyKey: randomUUID(), createdBy: A.owner })))) !== null);
    check("partner can't update a handover row (RLS: 0 rows)",
      (await withPartnerContext(A.owner, A.id, (tx) => tx.update(qrHandovers).set({ resolutionNote: "x" }).where(eq(qrHandovers.id, h1Id)).returning())).length === 0);
    check("partner can't move a card's owner directly",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => tx.update(qrCodes).set({ partnerId: B.id }).where(eq(qrCodes.publicToken, sel1[2]!)).returning()))) !== null ||
      (await su`select partner_id from qr_codes where public_token = ${sel1[2]!}`)[0]?.partner_id === A.id);
    check("…card still A's", (await su`select partner_id from qr_codes where public_token = ${sel1[2]!}`)[0]?.partner_id === A.id);
    check("partner can't flag itself as central stock",
      (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => tx.update(partners).set({ isCentralStock: true }).where(eq(partners.id, A.id))))) !== null);
    check("even the admin app role can't insert handover rows directly (only via the function)",
      (await errorOf(() => asAdmin((tx) => tx.insert(qrHandovers).values({ fromPartnerId: central.id, toPartnerId: B.id, quantity: 1, idempotencyKey: randomUUID(), createdBy: adminUserId })))) !== null);
    check("app role can't write the acceptance mark table",
      (await errorOf(() => asAdmin((tx) => tx.execute(sql`insert into qr_handover_acceptance_marks (handover_id, txid) values (${h1Id}, txid_current())`)))) !== null);
    check("admin can't move a card's owner directly (0013 rule still holds)",
      (await errorOf(() => asAdmin((tx) => tx.update(qrCodes).set({ partnerId: B.id, batchId: aBatch.id }).where(eq(qrCodes.publicToken, tok[26]!))))) !== null);
    check("…not even with a forged session flag",
      (await errorOf(() => asAdmin(async (tx) => {
        await tx.execute(sql`select set_config('app.qr_handover_transfer', ${h1Id}, true)`);
        await tx.update(qrCodes).set({ partnerId: A.id, batchId: aBatch.id }).where(eq(qrCodes.publicToken, tok[26]!));
      }))) !== null);
    check("handover items can't be deleted by the app role",
      (await errorOf(() => asAdmin((tx) => tx.delete(qrHandoverItems).where(eq(qrHandoverItems.handoverId, h1Id))))) !== null);
    const bSees = await withPartnerContext(B.owner, B.id, (tx) => tx.select({ id: qrHandovers.id }).from(qrHandovers).where(eq(qrHandovers.id, h1Id)));
    const bItems = await withPartnerContext(B.owner, B.id, (tx) => tx.select().from(qrHandoverItems).where(eq(qrHandoverItems.handoverId, h1Id)));
    check("partner B can't see partner A's transfer or its items", bSees.length === 0 && bItems.length === 0);
    const fnPriv = await su`select p.proname, has_function_privilege('app_runtime', p.oid, 'execute') x, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, p.prosecdef d
      from pg_proc p where p.proname in ('app_admin_transfer_qr_cards','app_report_qr_handover_discrepancy','app_accept_qr_handover','app_dispute_qr_handover') order by 1`;
    const priv = Object.fromEntries(fnPriv.map((r) => [r.proname, r]));
    check("function privileges: transfer/report runnable by app_runtime only; accept/dispute by nobody; anon/authenticated none",
      priv.app_admin_transfer_qr_cards?.x === true && priv.app_report_qr_handover_discrepancy?.x === true &&
      priv.app_accept_qr_handover?.x === false && priv.app_dispute_qr_handover?.x === false &&
      fnPriv.every((r) => r.a === false && r.u === false && r.d === true), fnPriv);
    const tPriv = await su`select has_table_privilege('app_runtime','qr_handovers','insert') hi, has_table_privilege('app_runtime','qr_handover_items','insert') ii,
      has_table_privilege('app_runtime','qr_handover_reports','insert') ri, has_table_privilege('anon','qr_handover_reports','select') ra,
      has_table_privilege('authenticated','qr_handover_reports','select') rau`;
    check("table privileges: no direct inserts by app_runtime; reports not exposed to anon/authenticated",
      Object.values(tPriv[0]!).every((v) => v === false), tPriv[0]);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 7. Partial failure rolls back the whole transfer ---");
  {
    const sel = [tok[27]!, tok[28]!, tok[29]!];
    const before = await su`select count(*)::int h, (select count(*)::int from qr_batches where partner_id = ${B.id}) b from qr_handovers`;
    // Fail the transaction at the very last statement of the transfer (the audit row).
    await su.unsafe(`create or replace function verify_fail_transfer_audit() returns trigger language plpgsql as $f$ begin
      if new.action = 'QR_HANDOVER_TRANSFERRED' then raise exception 'injected failure'; end if; return new; end $f$`);
    await su.unsafe(`create trigger verify_fail_transfer_audit before insert on audit_logs for each row execute function verify_fail_transfer_audit()`);
    let err: string | null;
    try {
      err = await errorOf(() => asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: sel })));
    } finally {
      await su.unsafe(`drop trigger verify_fail_transfer_audit on audit_logs`);
      await su.unsafe(`drop function verify_fail_transfer_audit()`);
    }
    const after = await su`select count(*)::int h, (select count(*)::int from qr_batches where partner_id = ${B.id}) b from qr_handovers`;
    check("an injected failure at the last step surfaces as an error", err?.includes("injected failure") === true, err);
    check("…and NOTHING persisted: no handover, no items, no batch, cards still in central stock",
      after[0]!.h === before[0]!.h && after[0]!.b === before[0]!.b &&
      (await su`select count(*)::int n from qr_codes where public_token in ${su(sel)} and partner_id = ${central.id} and distribution_status <> 'DISTRIBUTED'`)[0]?.n === 3 &&
      (await su`select count(*)::int n from qr_handover_items i join qr_codes q on q.id = i.qr_code_id where q.public_token in ${su(sel)}`)[0]?.n === 0);
    const retry = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: sel }));
    check("the same cards transfer normally afterwards", retry.ok && retry.quantity === 3);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 8. Database integrity rules ---");
  {
    check("a handover can never be left PENDING (even inserted by the superuser)",
      (await errorOf(() => su.begin(async (t) => {
        const [h] = await t`insert into qr_handovers (from_partner_id, to_partner_id, quantity, idempotency_key, created_by) values (${central.id}, ${B.id}, 1, ${randomUUID()}, ${adminUserId}) returning id`;
        await t`insert into qr_handover_items (handover_id, qr_code_id, from_batch_id) values (${h!.id}, ${idOf.get(tok[30]!)!}, ${centralBatch.id})`;
      })))?.includes("cannot remain PENDING") === true);
    check("items can't be added to a completed handover",
      (await errorOf(() => su`insert into qr_handover_items (handover_id, qr_code_id, from_batch_id) values (${h1Id}, ${idOf.get(tok[30]!)!}, ${centralBatch.id})`)) !== null);
    check("handover identity is immutable", (await errorOf(() => su`update qr_handovers set to_partner_id = ${B.id} where id = ${h1Id}`)) !== null);
    check("a completed handover is terminal", (await errorOf(() => su`update qr_handovers set status = 'CANCELLED' where id = ${h1Id}`)) !== null);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 9. Count-mismatch report: non-blocking support only ---");
  {
    const hid = h1Id;
    const owners0 = JSON.stringify(await su`select id, partner_id, batch_id from qr_codes where public_token in ${su(sel1)} order by id`);
    check("empty note refused", (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => H.partnerReportDiscrepancy(tx, hid, 18, "  "))))?.includes("dispute_note_invalid") === true);
    check("VIEWER can't report", (await errorOf(() => withPartnerContext(viewerA, A.id, (tx) => H.partnerReportDiscrepancy(tx, hid, 18, "x"))))?.includes("handover_forbidden") === true);
    check("another partner can't report on A's transfer (looks like not found)",
      (await errorOf(() => withPartnerContext(B.owner, B.id, (tx) => H.partnerReportDiscrepancy(tx, hid, 18, "x"))))?.includes("handover_not_found") === true);
    const r = await withPartnerContext(A.owner, A.id, (tx) => H.partnerReportDiscrepancy(tx, hid, 18, "Only 18 cards in the envelope"));
    check("receiving partner reports a mismatch", typeof r.reportId === "string");
    check("…ownership unchanged, transfer still ACCEPTED (not reversed)",
      JSON.stringify(await su`select id, partner_id, batch_id from qr_codes where public_token in ${su(sel1)} order by id`) === owners0 &&
      (await su`select status from qr_handovers where id = ${hid}`)[0]?.status === "ACCEPTED");
    const adminReports = await asAdmin((tx) => H.listHandoverReports(tx, [hid]));
    const aReports = await withPartnerContext(A.owner, A.id, (tx) => H.listHandoverReports(tx, [hid]));
    const bReports = await withPartnerContext(B.owner, B.id, (tx) => H.listHandoverReports(tx, [hid]));
    check("admin and the reporting partner see the report; another partner doesn't",
      adminReports.length === 1 && adminReports[0]!.receivedCount === 18 && aReports.length === 1 && bReports.length === 0);
    check("app role can't write reports directly", (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => tx.execute(sql`insert into qr_handover_reports (handover_id, partner_id, reported_by, note) values (${hid}, ${A.id}, ${A.owner}, 'x')`)))) !== null);
    for (let i = 0; i < 4; i++) await withPartnerContext(A.owner, A.id, (tx) => H.partnerReportDiscrepancy(tx, hid, null, `follow-up ${i}`));
    check("at most 5 reports per transfer", (await errorOf(() => withPartnerContext(A.owner, A.id, (tx) => H.partnerReportDiscrepancy(tx, hid, null, "6th"))))?.includes("report_limit") === true);
    check("reports are audited", (await su`select count(*)::int n from audit_logs where target_id = ${hid} and action = 'QR_HANDOVER_DISCREPANCY_REPORTED'`)[0]?.n === 5);
    check("admin summary counts reports", (await asAdmin((tx) => H.getPhysicalInventorySummary(tx))).discrepancyReports >= 5);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 10. Legacy PENDING handover (created before 0027): never auto-accepted ---");
  {
    // Simulate a row left by the old two-step flow (triggers off = as it was written before 0027).
    const legacyId = randomUUID();
    const legacyCards = [tok[31]!, tok[32]!];
    await su.begin(async (t) => {
      await t`set local session_replication_role = replica`;
      await t`insert into qr_handovers (id, from_partner_id, to_partner_id, quantity, idempotency_key, created_by) values (${legacyId}, ${central.id}, ${B.id}, 2, ${randomUUID()}, ${adminUserId})`;
      for (const c of legacyCards) await t`insert into qr_handover_items (handover_id, qr_code_id, from_batch_id) values (${legacyId}, ${idOf.get(c)!}, ${centralBatch.id})`;
    });
    check("legacy pending cards stay with their holder (no auto-accept)",
      (await su`select count(*)::int n from qr_codes where public_token in ${su(legacyCards)} and partner_id = ${central.id}`)[0]?.n === 2);
    check("a card reserved by a legacy handover can't be transferred",
      !(await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: A.id, tokens: [legacyCards[0]!] }))).ok);
    check("the receiving partner can't accept it (function revoked)",
      (await errorOf(() => withPartnerContext(B.owner, B.id, (tx) => tx.execute(sql`select app_accept_qr_handover(${legacyId}::uuid)`))))?.includes("permission denied") === true);
    check("admin can't mark it ACCEPTED directly",
      (await errorOf(() => asAdmin((tx) => tx.update(qrHandovers).set({ status: "ACCEPTED", resolvedAt: new Date(), resultBatchId: centralBatch.id }).where(eq(qrHandovers.id, legacyId))))) !== null);
    const physL = await asAdmin((tx) => H.getPhysicalInventorySummary(tx));
    check("admin summary shows it as open/reserved until closed", physL.pendingHandovers === 1 && physL.reserved === 2);
    await asAdmin((tx) => H.adminTransitionHandover(tx, adminUserId, legacyId, "cancel", "closed after switch to immediate transfers"));
    const [l] = await su`select status, created_at, resolved_actor_type from qr_handovers where id = ${legacyId}`;
    check("admin closes it explicitly: CANCELLED, reservations released, history kept",
      l?.status === "CANCELLED" && l?.resolved_actor_type === "ADMIN" && l?.created_at !== null &&
      (await su`select count(*)::int n from qr_handover_items where handover_id = ${legacyId} and reserved`)[0]?.n === 0 &&
      (await su`select count(*)::int n from qr_handover_items where handover_id = ${legacyId}`)[0]?.n === 2);
    const re = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: legacyCards }));
    check("…then the cards are transferred with the new flow", re.ok && re.quantity === 2);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 11. Financial: transfers never sell, pay, activate or commission ---");
  const money1 = await money();
  check("no order, payment, ledger entry, analytics event or activation created by scan/transfer/report",
    money1.o === money0.o && money1.p === money0.p && money1.l === money0.l && money1.e === money0.e && money1.act === money0.act, { money0, money1 });
  const soldTok = sel1[7]!;
  {
    // A customer later buys one of the transferred cards: attribution is the receiving partner.
    const qrId = idOf.get(soldTok)!;
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
    check("a sale after the transfer is attributed to the receiving partner at its rate (20% of 15.00)",
      chain?.partner_id === A.id && chain?.ledger_partner === A.id && chain?.amount_minor === 300, chain);
    check("a sold card's owner can never change again",
      (await errorOf(() => asAdmin((tx) => tx.update(qrCodes).set({ partnerId: B.id }).where(eq(qrCodes.id, qrId))))) !== null);
    check("DB transfer function refuses the sold (ACTIVE, payment-linked) card",
      (await errorOf(() => asAdmin((tx) => tx.execute(sql`select app_admin_transfer_qr_cards(${randomUUID()}::uuid, ${A.id}::uuid, ${B.id}::uuid, ${`{${qrId}}`}::uuid[], null)`))))?.includes("handover_cards_ineligible:1") === true);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 12. Admin redistribution A -> B: immediate, history and attribution preserved ---");
  {
    const pick = sel1.slice(8, 18); // 10 of A's cards
    for (const t of pick.slice(0, 3)) await su`insert into analytics_events (event_type, qr_code_id, partner_id) values ('QR_SCANNED', ${idOf.get(t)!}, ${A.id})`;
    const scanA0 = (await asAdmin((tx) => getPartnerInventorySummary(tx, A.id))).scannedCards;
    const scanB0 = (await asAdmin((tx) => getPartnerInventorySummary(tx, B.id))).scannedCards;
    const moneyBefore = await money();
    const ledgerA = await su`select id, amount_minor, partner_id, order_id from partner_ledger_entries where partner_id = ${A.id} order by id`;
    const ordersAll = JSON.stringify(await su`select id, partner_id, partner_commission_minor, status from orders order by id`);
    const payAll = JSON.stringify(await su`select id, order_id, status, amount_minor from payments order by id`);
    const h1Row = JSON.stringify(await su`select * from qr_handovers where id = ${h1Id}`);
    const invA0b = await asAdmin((tx) => getPartnerInventorySummary(tx, A.id));
    const invB0 = await asAdmin((tx) => getPartnerInventorySummary(tx, B.id));
    const total0 = (await su`select count(*)::int n from qr_codes`)[0]!.n;

    const withSold = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: A.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: [...pick, soldTok] }));
    check("a sold card refuses the whole redistribution", !withSold.ok && (withSold.cards.find((c) => c.token === soldTok) as { reason?: string })?.reason === "active");
    const wrongSource = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: central.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: pick }));
    check("declared source must hold every card", !wrongSource.ok && wrongSource.cards.every((c) => !c.eligible && (c as { reason: string }).reason === "other_source"));

    const h = await asAdmin((tx) => H.createHandover(tx, adminUserId, { fromPartnerId: A.id, idempotencyKey: randomUUID(), toPartnerId: B.id, tokens: pick }));
    const hid = h.ok ? h.handoverId : "";
    check("admin transfers A -> B (10) immediately", h.ok && h.quantity === 10 &&
      (await su`select count(*)::int n from qr_codes where public_token in ${su(pick)} and partner_id = ${B.id}`)[0]?.n === 10);
    check("sender A does not see the transfer (only the receiver does)",
      (await withPartnerContext(A.owner, A.id, (tx) => tx.select({ id: qrHandovers.id }).from(qrHandovers).where(eq(qrHandovers.id, hid)))).length === 0);
    const bList = await withPartnerContext(B.owner, B.id, (tx) => H.listPartnerHandovers(tx, B.id));
    check("receiver's view has no source partner field", bList.some((x) => x.id === hid) && bList.every((x) => !("fromPartnerName" in x)));
    const invA1b = await asAdmin((tx) => getPartnerInventorySummary(tx, A.id));
    const invB1 = await asAdmin((tx) => getPartnerInventorySummary(tx, B.id));
    const total1 = (await su`select count(*)::int n from qr_codes`)[0]!.n;
    check("A -10, B +10, global unchanged", invA1b.issued === invA0b.issued - 10 && invB1.issued === invB0.issued + 10 && total1 === total0);
    check("status totals consistent (available moved, nothing else)", invA1b.available === invA0b.available - 10 && invB1.available === invB0.available + 10 && invA1b.active === invA0b.active && invB1.draft === invB0.draft);
    const metB = await withPartnerContext(B.owner, B.id, (tx) => getPartnerMetrics(tx, B.id));
    check("partner B dashboard = admin view of B", metB.qrIssued === invB1.issued && metB.qrAvailable === invB1.available && metB.qrDistributed === invB1.distributed);
    check("history keeps each card's original batch (A's)",
      (await su`select count(*)::int n from qr_handover_items i join qr_batches b on b.id = i.from_batch_id where i.handover_id = ${hid} and b.partner_id = ${A.id}`)[0]?.n === 10);
    check("earlier transfer record unchanged", JSON.stringify(await su`select * from qr_handovers where id = ${h1Id}`) === h1Row);
    check("the earlier sale stays attributed to A (orders, payments, ledger byte-identical)",
      JSON.stringify(await su`select id, amount_minor, partner_id, order_id from partner_ledger_entries where partner_id = ${A.id} order by id`) === JSON.stringify(ledgerA) &&
      JSON.stringify(await su`select id, partner_id, partner_commission_minor, status from orders order by id`) === ordersAll &&
      JSON.stringify(await su`select id, order_id, status, amount_minor from payments order by id`) === payAll);
    const scanA1 = (await asAdmin((tx) => getPartnerInventorySummary(tx, A.id))).scannedCards;
    const scanB1 = (await asAdmin((tx) => getPartnerInventorySummary(tx, B.id))).scannedCards;
    const scanA1p = (await withPartnerContext(A.owner, A.id, (tx) => getPartnerMetrics(tx, A.id))).qrScanned;
    const scanB1p = (await withPartnerContext(B.owner, B.id, (tx) => getPartnerMetrics(tx, B.id))).qrScanned;
    check("historical scans stay with A", scanA1 === scanA0 && scanA1p === scanA1, { scanA0, scanA1, scanA1p });
    check("B doesn't inherit A's scans; admin view of B = B's dashboard", scanB1 === scanB0 && scanB1p === scanB1, { scanB0, scanB1, scanB1p });
    const perfB = await asAdmin((tx) => getBatchPerformance(tx, B.id));
    const resultBatch = (await su`select result_batch_id from qr_handovers where id = ${hid}`)[0]!.result_batch_id;
    check("B's received batch line shows 0 scanned", perfB.find((p) => p.batchId === resultBatch)?.scanned === 0);
    const resultsB = await withPartnerContext(B.owner, B.id, (tx) => getQrResults(tx, B.id));
    check("B's per-card results don't show A's customer scans", resultsB.every((r) => !pick.slice(0, 3).some((t) => idOf.get(t) === r.qrCodeId)));
    const moneyAfter = await money();
    check("redistribution created no order, payment, commission, analytics event or activation", JSON.stringify(moneyAfter) === JSON.stringify(moneyBefore), { moneyBefore, moneyAfter });
    check("audit: one QR_HANDOVER_TRANSFERRED (PARTNER_TO_PARTNER)",
      (await su`select action, metadata->>'kind' kind from audit_logs where target_id = ${hid} order by created_at`).map((r) => `${r.action}:${r.kind}`).join(",") === "QR_HANDOVER_TRANSFERRED:PARTNER_TO_PARTNER");
  }

  // -------------------------------------------------------------------------
  console.log("\n--- 13. Central stock is never a commercial partner ---");
  {
    check("can't be reactivated", (await errorOf(() => asAdmin((tx) => tx.update(partners).set({ status: "ACTIVE" }).where(eq(partners.id, central.id))))) !== null);
    check("can't earn commission", (await errorOf(() => su`update partners set commission_rate_bps = 1000 where id = ${central.id}`)) !== null);
    check("can't get a login (member)", (await errorOf(() => su`insert into partner_members (partner_id, user_id, role) values (${central.id}, ${randomUUID()}, 'OWNER')`)) !== null);
    check("can't receive a transfer (even inserted directly)",
      (await errorOf(() => su.begin(async (t) => {
        await t`insert into qr_handovers (from_partner_id, to_partner_id, quantity, idempotency_key, created_by) values (${A.id}, ${central.id}, 1, ${randomUUID()}, ${adminUserId})`;
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

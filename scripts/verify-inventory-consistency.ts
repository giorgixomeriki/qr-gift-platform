/**
 * verify:inventory-consistency — the partner dashboard and the admin's page for
 * that partner show the same QR inventory, equal to qr_codes (P1 2026-11-21).
 *
 * Seeds two throwaway partners on the local stack (never production), then
 * compares getPartnerMetrics (partner context, as the partner dashboard runs
 * it) and getPartnerInventorySummary (admin context, as the admin page runs
 * it) against plain SQL over the same rows.
 */
import Module from "node:module";
import { randomUUID } from "node:crypto";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { withAdminContext, withPartnerContext } = require("../src/db/client") as typeof import("../src/db/client");
const { getPartnerMetrics } = require("../src/lib/dashboard/partner-metrics") as typeof import("../src/lib/dashboard/partner-metrics");
const { getPartnerInventorySummary } = require("../src/lib/dashboard/inventory") as typeof import("../src/lib/dashboard/inventory");
const { getBatchPerformance } = require("../src/lib/dashboard/attribution") as typeof import("../src/lib/dashboard/attribution");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
if (/supabase\.co|pooler\.supabase\.com/.test(migrationsUrl)) throw new Error("refusing to run against a hosted Supabase database");
const admin = postgres(migrationsUrl, { max: 2 });
const RUN = randomUUID().slice(0, 8);

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const partnerIds: string[] = [];
const adminUserId = randomUUID();

async function makePartner(tag: string) {
  const [p] = await admin<{ id: string }[]>`insert into partners (slug, name) values (${`inv-${tag}-${RUN}`}, ${`Inventory ${tag} ${RUN}`}) returning id`;
  partnerIds.push(p!.id);
  const userId = randomUUID();
  await admin`insert into partner_members (partner_id, user_id, role) values (${p!.id}, ${userId}, 'OWNER')`;
  const [b] = await admin<{ id: string }[]>`insert into qr_batches (partner_id, label, quantity) values (${p!.id}, ${`B-${tag}-${RUN}`}, 50) returning id`;
  return { id: p!.id, userId, batchId: b!.id };
}

/**
 * Fixture-only: puts a card in a status directly. Production reaches DRAFT /
 * ACTIVE / BLOCKED only through the sender, payment and moderation paths
 * (enforced by triggers); this suite tests counting, not those paths, so it
 * sets the column with triggers off — on the local stack only (see the
 * hosted-database guard above).
 */
async function setStatus(qrId: string, status: string) {
  await admin.begin(async (t) => {
    await t`set local session_replication_role = replica`;
    await t`update qr_codes set status = ${status}::qr_status where id = ${qrId}`;
  });
}

async function addCards(p: { id: string; batchId: string }, status: string, n: number, distributed = false): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = randomUUID();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, distribution_status) values (${id}, ${generatePublicToken()}, ${p.batchId}, ${p.id}, ${distributed ? "DISTRIBUTED" : "NOT_DISTRIBUTED"})`;
    if (status !== "AVAILABLE") await setStatus(id, status);
    ids.push(id);
  }
  return ids;
}

async function scan(qrId: string, partnerId: string, times: number) {
  for (let i = 0; i < times; i++) await admin`insert into analytics_events (event_type, qr_code_id, partner_id) values ('QR_SCANNED', ${qrId}, ${partnerId})`;
}

/** Plain SQL over qr_codes / analytics_events: the source of truth. */
async function truth(partnerId: string) {
  const [r] = await admin`
    select count(*)::int issued,
           count(*) filter (where status = 'AVAILABLE')::int available,
           count(*) filter (where status = 'DRAFT')::int draft,
           count(*) filter (where status = 'ACTIVE')::int active,
           count(*) filter (where status = 'BLOCKED')::int blocked,
           count(*) filter (where distribution_status = 'DISTRIBUTED')::int distributed,
           (select count(distinct e.qr_code_id)::int from analytics_events e join qr_codes q on q.id = e.qr_code_id
             where q.partner_id = ${partnerId} and e.event_type = 'QR_SCANNED') scanned_cards,
           (select count(*)::int from qr_batches where partner_id = ${partnerId}) batch_count
      from qr_codes where partner_id = ${partnerId}`;
  return {
    issued: r!.issued as number,
    available: r!.available as number,
    draft: r!.draft as number,
    active: r!.active as number,
    blocked: r!.blocked as number,
    distributed: r!.distributed as number,
    scannedCards: r!.scanned_cards as number,
    batchCount: r!.batch_count as number,
  };
}

/** What each screen shows, computed exactly as each page computes it. */
async function screens(p: { id: string; userId: string }) {
  const m = await withPartnerContext(p.userId, p.id, (tx) => getPartnerMetrics(tx, p.id));
  const partnerView = {
    issued: m.qrIssued,
    available: m.qrAvailable,
    draft: m.qrDraft,
    active: m.qrActive,
    blocked: m.qrBlocked,
    distributed: m.qrDistributed,
    scannedCards: m.qrScanned,
    batchCount: m.batchCount,
  };
  const adminView = await withAdminContext(adminUserId, (tx) => getPartnerInventorySummary(tx, p.id));
  return { partnerView, adminView };
}

const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  const A = await makePartner("a");
  const B = await makePartner("b");

  console.log("--- 1. Same records, same numbers ---");
  await addCards(A, "AVAILABLE", 5);
  const aDistributed = await addCards(A, "AVAILABLE", 2, true);
  const aDraft = await addCards(A, "DRAFT", 3);
  const aActive = await addCards(A, "ACTIVE", 2, true);
  await addCards(A, "BLOCKED", 1);
  await addCards(B, "AVAILABLE", 4);
  const bDraft = await addCards(B, "DRAFT", 1);
  await scan(aDistributed[0]!, A.id, 5); // one card, five scans
  await scan(aDistributed[1]!, A.id, 2);
  await scan(aActive[0]!, A.id, 1);
  await scan(bDraft[0]!, B.id, 3);

  let t = await truth(A.id);
  let s = await screens(A);
  check("1a. partner dashboard = database (partner A)", same(s.partnerView, t), { partner: s.partnerView, db: t });
  check("1b. admin page for A = database", same(s.adminView, t), { admin: s.adminView, db: t });
  check("1c. admin page for A = partner A's dashboard", same(s.adminView, s.partnerView));
  check("1d. available + draft + active + blocked = issued", t.available + t.draft + t.active + t.blocked === t.issued && t.issued === 13, t);
  check("1e. DRAFT and ACTIVE counted apart (3 drafts are not activations)", s.partnerView.draft === 3 && s.partnerView.active === 2);
  check("1f. scanned = distinct cards (3), not scan events (8)", s.partnerView.scannedCards === 3 && s.adminView.scannedCards === 3, s.partnerView.scannedCards);
  const perf = await withPartnerContext(A.userId, A.id, (tx) => getBatchPerformance(tx, A.id));
  check("1g. tile agrees with the per-batch line on the same page", perf.reduce((n, r) => n + r.scanned, 0) === s.partnerView.scannedCards && perf.reduce((n, r) => n + r.distributed, 0) === s.partnerView.distributed, perf);
  check("1h. distributed (4) is independent of status and not a sale", s.partnerView.distributed === 4);

  console.log("\n--- 2. Each card under its own partner ---");
  const tb = await truth(B.id);
  const sb = await screens(B);
  check("2a. partner B: dashboard = admin page = database", same(sb.partnerView, tb) && same(sb.adminView, tb), { partner: sb.partnerView, db: tb });
  check("2b. A's figures include none of B's cards or scans", t.issued === 13 && tb.issued === 5 && tb.scannedCards === 1);
  // A mis-attributed event (B's card logged under A) still counts for the card's owner.
  await admin`insert into analytics_events (event_type, qr_code_id, partner_id) values ('QR_SCANNED', ${bDraft[0]!}, ${A.id})`;
  const s2 = await screens(A);
  check("2c. scans follow the card's owner, not the event's partner_id", s2.partnerView.scannedCards === 3 && (await screens(B)).partnerView.scannedCards === 1);

  console.log("\n--- 3. Changes show on both screens ---");
  const [claim] = await admin<{ id: string }[]>`select id from qr_codes where partner_id = ${A.id} and status = 'AVAILABLE' and distribution_status = 'NOT_DISTRIBUTED' limit 1`;
  await setStatus(claim!.id, "DRAFT");
  await admin`update qr_codes set distribution_status = 'DISTRIBUTED' where id = ${aDraft[0]!}`;
  await setStatus(aDraft[1]!, "ACTIVE");
  t = await truth(A.id);
  s = await screens(A);
  check("3a. after claim / hand-over / activation both screens = database", same(s.partnerView, t) && same(s.adminView, t), { partner: s.partnerView, db: t });
  check("3b. the moved cards land in the right buckets", t.available === 6 && t.draft === 3 && t.active === 3 && t.distributed === 5, t);
  const [newBatch] = await admin<{ id: string }[]>`insert into qr_batches (partner_id, label, quantity) values (${A.id}, ${`B2-${RUN}`}, 50) returning id`;
  await addCards({ id: A.id, batchId: newBatch!.id }, "AVAILABLE", 2);
  s = await screens(A);
  check("3c. a new batch (assignment) raises issued/available/batches on both, not sales", s.partnerView.issued === 15 && s.adminView.issued === 15 && s.partnerView.batchCount === 2 && s.adminView.available === 8);

  console.log(`\n${passed} passed, ${failed} failed`);
}

async function cleanup() {
  for (const id of partnerIds) {
    await admin`delete from analytics_events where partner_id = ${id} or qr_code_id in (select id from qr_codes where partner_id = ${id})`.catch(() => {});
    await admin`delete from qr_codes where partner_id = ${id}`.catch(() => {});
    await admin`delete from qr_batches where partner_id = ${id}`.catch(() => {});
    await admin`delete from partner_members where partner_id = ${id}`.catch(() => {});
    await admin`delete from partners where id = ${id}`.catch(() => {});
  }
  await admin`delete from admin_users where user_id = ${adminUserId}`.catch(() => {});
}

main()
  .catch((err) => {
    failed++;
    console.error(err);
  })
  .finally(async () => {
    await cleanup();
    await admin.end();
    process.exit(failed > 0 ? 1 : 0);
  });

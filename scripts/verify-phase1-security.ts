import Module from "node:module";

// Same server-only shim as verify-commercial-invariants.ts — see that file's
// comment for why this is necessary for a standalone tsx process.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { eq } = require("drizzle-orm") as typeof import("drizzle-orm");

const { withPartnerContext, withPublicContext, withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
const { partners, qrBatches, qrCodes } = require("../src/db/schema") as typeof import("../src/db/schema");
const { createQrBatch, markQrCodesDistributed, getQrBatch, listQrCodesForBatch } = require("../src/lib/qr/batches") as typeof import("../src/lib/qr/batches");
const { buildQrInventoryCsv } = require("../src/lib/qr/csv") as typeof import("../src/lib/qr/csv");
const { publicQrUrl } = require("../src/lib/qr/asset") as typeof import("../src/lib/qr/asset");

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

async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  console.log("Setting up fixtures (superuser)...");

  const partnerA = crypto.randomUUID();
  const partnerB = crypto.randomUUID();
  const partnerSuspended = crypto.randomUUID();
  const ownerA = crypto.randomUUID();
  const staffA = crypto.randomUUID();
  const viewerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();
  const ownerSuspended = crypto.randomUUID();

  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerA}, ${"sec-partner-a-" + partnerA.slice(0, 8)}, 'Security Partner A', 1000, 'ACTIVE')`;
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerB}, ${"sec-partner-b-" + partnerB.slice(0, 8)}, 'Security Partner B', 1000, 'ACTIVE')`;
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerSuspended}, ${"sec-partner-susp-" + partnerSuspended.slice(0, 8)}, 'Suspended Partner, "Quotes" & Comma', 1000, 'SUSPENDED')`;

  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerA}, ${ownerA}, 'OWNER')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerA}, ${staffA}, 'STAFF')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerA}, ${viewerA}, 'VIEWER')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerB}, ${ownerB}, 'OWNER')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerSuspended}, ${ownerSuspended}, 'OWNER')`;

  console.log("\n--- Token generation & bulk uniqueness ---");

  const { batch: batchA, qrCodeIds: batchAIds } = await withPartnerContext(ownerA, partnerA, (tx) =>
    createQrBatch(tx, { actorType: "PARTNER", actorId: ownerA }, partnerA, { label: "Security batch A", quantity: 250 }),
  );
  check("token generation produced the exact requested quantity", batchAIds.length === 250);

  const tokenRows = await admin`select public_token from qr_codes where batch_id = ${batchA.id}`;
  const distinctTokens = new Set(tokenRows.map((r) => (r as { public_token: string }).public_token));
  check("9. Token generation has no duplicates", distinctTokens.size === tokenRows.length);
  check("   bulk generation (250 codes) preserves uniqueness", distinctTokens.size === 250);

  console.log("\n--- Partner A cannot create batches for Partner B ---");

  const forgedBatchInsert = await expectThrows(() =>
    withPartnerContext(ownerA, partnerA, (tx) =>
      createQrBatch(tx, { actorType: "PARTNER", actorId: ownerA }, partnerB, { label: "forged", quantity: 5 }),
    ),
  );
  check("3. Partner A cannot create a batch for Partner B", forgedBatchInsert);

  const directForgedInsert = await expectThrows(() =>
    withPartnerContext(ownerA, partnerA, (tx) => tx.insert(qrBatches).values({ partnerId: partnerB, label: "forged-direct", quantity: 1 })),
  );
  check("   (RLS backstop) direct INSERT into qr_batches for Partner B is rejected", directForgedInsert);

  console.log("\n--- Partner A cannot access Partner B batches / inventory ---");

  const { batch: batchB } = await withPartnerContext(ownerB, partnerB, (tx) =>
    createQrBatch(tx, { actorType: "PARTNER", actorId: ownerB }, partnerB, { label: "Security batch B", quantity: 10 }),
  );

  const batchBFromA = await withPartnerContext(ownerA, partnerA, (tx) => getQrBatch(tx, batchB.id));
  check("1. Partner A cannot read Partner B's batch (getQrBatch)", batchBFromA === null);

  const batchBRowsFromA = await withPartnerContext(ownerA, partnerA, (tx) =>
    tx.select().from(qrBatches).where(eq(qrBatches.id, batchB.id)),
  );
  check("2. Partner A cannot see Partner B's batch via a direct RLS-scoped query", batchBRowsFromA.length === 0);

  console.log("\n--- Partner A cannot distribute Partner B's QR codes ---");

  const [qrCodeOfB] = await admin`select id from qr_codes where batch_id = ${batchB.id} limit 1`;
  const distributedByA = await withPartnerContext(ownerA, partnerA, (tx) =>
    markQrCodesDistributed(tx, { actorType: "PARTNER", actorId: ownerA }, partnerA, [qrCodeOfB!.id]),
  );
  check("4. Partner A marking Partner B's QR as distributed is a no-op (0 rows)", distributedByA.length === 0);
  const [qrBRowAfter] = await admin`select distribution_status from qr_codes where id = ${qrCodeOfB!.id}`;
  check("   Partner B's QR remains NOT_DISTRIBUTED", qrBRowAfter?.distribution_status === "NOT_DISTRIBUTED");

  console.log("\n--- VIEWER cannot perform privileged operations ---");

  const viewerBatchCreate = await expectThrows(() =>
    withPartnerContext(viewerA, partnerA, (tx) =>
      createQrBatch(tx, { actorType: "PARTNER", actorId: viewerA }, partnerA, { label: "viewer-forged", quantity: 1 }),
    ),
  );
  check("5. VIEWER cannot create a QR batch", viewerBatchCreate);

  const [qrCodeOfA] = await admin`select id from qr_codes where batch_id = ${batchA.id} limit 1`;
  const viewerDistribute = await withPartnerContext(viewerA, partnerA, (tx) =>
    markQrCodesDistributed(tx, { actorType: "PARTNER", actorId: viewerA }, partnerA, [qrCodeOfA!.id]),
  );
  check("   VIEWER cannot mark a QR code as distributed (0 rows)", viewerDistribute.length === 0);

  console.log("\n--- STAFF follows defined permissions ---");

  const staffDistribute = await withPartnerContext(staffA, partnerA, (tx) =>
    markQrCodesDistributed(tx, { actorType: "PARTNER", actorId: staffA }, partnerA, [qrCodeOfA!.id]),
  );
  check("6. STAFF CAN mark a QR code as distributed", staffDistribute.length === 1);

  const staffBatchCreate = await expectThrows(() =>
    withPartnerContext(staffA, partnerA, (tx) =>
      createQrBatch(tx, { actorType: "PARTNER", actorId: staffA }, partnerA, { label: "staff-forged", quantity: 1 }),
    ),
  );
  check("   STAFF cannot create a QR batch (OWNER/ADMIN only)", staffBatchCreate);

  console.log("\n--- Anonymous cannot access Partner/Admin operations ---");

  const anonPartnersRead = await withPublicContext((tx) => tx.select().from(partners).where(eq(partners.id, partnerA)));
  check("7. Anonymous cannot read the partners table", anonPartnersRead.length === 0);

  const anonBatchesRead = await withPublicContext((tx) => tx.select().from(qrBatches).where(eq(qrBatches.partnerId, partnerA)));
  check("   Anonymous cannot read qr_batches", anonBatchesRead.length === 0);

  const anonBatchCreate = await expectThrows(() =>
    withPublicContext((tx) => tx.insert(qrBatches).values({ partnerId: partnerA, label: "anon-forged", quantity: 1 })),
  );
  check("   Anonymous cannot create a QR batch", anonBatchCreate);

  console.log("\n--- Public QR token leaks no private Partner data ---");

  // The /g/[token] dispatcher only ever reads qr_codes/greetings with zero
  // actor context — it never joins into `partners`, and even if it tried to,
  // RLS blocks it (proven above). This directly checks the actual read shape
  // that path uses never exposes partner name/commission/etc.
  const [publicQrRow] = await admin`select id from qr_codes where batch_id = ${batchA.id} limit 1`;
  const anonQrRead = await withPublicContext((tx) => tx.select().from(qrCodes).where(eq(qrCodes.id, publicQrRow!.id)));
  const exposedKeys = anonQrRead.length > 0 ? Object.keys(anonQrRead[0]!) : [];
  check(
    "8. Public QR read exposes no partner name/commission/branding fields",
    !exposedKeys.some((k) => ["name", "commissionRateBps", "branding", "defaultLocale"].includes(k)),
  );

  console.log("\n--- Admin authorization remains separate from partner authorization ---");

  const partnerAsAdminRead = await withPartnerContext(ownerA, partnerA, (tx) => tx.select().from(qrBatches).where(eq(qrBatches.partnerId, partnerB)));
  check("10. A partner OWNER is not implicitly an admin (still cannot read Partner B)", partnerAsAdminRead.length === 0);

  // Being an OWNER on partnerA must not, by itself, satisfy app_is_admin() —
  // admin status is a wholly separate grant (admin_users), never derived from
  // any partner_members row. Only after actually inserting ownerA into
  // admin_users does the SAME user gain cross-partner visibility.
  const totalPartnersBefore = await admin`select count(*)::int as c from partners`;
  const ownerAAsAdminBefore = await withAdminContext(ownerA, (tx) => tx.select().from(partners));
  check(
    "   Partner OWNER role alone does not satisfy admin authorization (app_is_admin())",
    ownerAAsAdminBefore.length < Number(totalPartnersBefore[0]!.c),
  );

  await admin`insert into admin_users (user_id) values (${ownerA})`;
  const ownerAAsAdminAfter = await withAdminContext(ownerA, (tx) => tx.select().from(partners));
  check(
    "   The SAME user, once actually granted admin_users, sees every partner",
    ownerAAsAdminAfter.length === Number(totalPartnersBefore[0]!.c),
  );
  await admin`delete from admin_users where user_id = ${ownerA}`;

  console.log("\n--- Blocked (suspended) Partner restrictions work ---");

  const suspendedBatchCreate = await expectThrows(() =>
    withPartnerContext(ownerSuspended, partnerSuspended, (tx) =>
      createQrBatch(tx, { actorType: "PARTNER", actorId: ownerSuspended }, partnerSuspended, { label: "suspended-batch", quantity: 1 }),
    ),
  );
  check("11. A SUSPENDED partner's OWNER cannot create a new QR batch", suspendedBatchCreate);

  // Distribution marking on an existing (pre-suspension) QR should also be blocked.
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (gen_random_uuid(), ${partnerSuspended}, 'pre-existing', 1)`;
  const [preexistingBatch] = await admin`select id from qr_batches where partner_id = ${partnerSuspended} limit 1`;
  const preexistingQrId = crypto.randomUUID();
  await admin`insert into qr_codes (id, public_token, batch_id, partner_id) values (${preexistingQrId}, ${"susp" + preexistingQrId.slice(0, 20)}, ${preexistingBatch!.id}, ${partnerSuspended})`;
  const suspendedDistribute = await withPartnerContext(ownerSuspended, partnerSuspended, (tx) =>
    markQrCodesDistributed(tx, { actorType: "PARTNER", actorId: ownerSuspended }, partnerSuspended, [preexistingQrId]),
  );
  check("   A SUSPENDED partner's OWNER cannot mark a QR as distributed", suspendedDistribute.length === 0);

  console.log("\n--- CSV export leaks no internal UUIDs, escapes correctly ---");

  const csvRows = await withPartnerContext(ownerA, partnerA, (tx) => listQrCodesForBatch(tx, batchA.id));
  const csv = buildQrInventoryCsv(
    csvRows.slice(0, 3).map((r) => ({
      publicToken: r.publicToken,
      batchLabel: 'Batch, with "quotes" და ქართული',
      partnerName: "Partner, Inc.",
      status: r.status,
      distributionStatus: r.distributionStatus,
    })),
  );
  check("12. CSV contains no internal batch/partner UUIDs", !csv.includes(batchA.id) && !csv.includes(partnerA));
  check("   CSV contains the public token and its public URL", csv.includes(csvRows[0]!.publicToken) && csv.includes(publicQrUrl(csvRows[0]!.publicToken)));
  check("   CSV correctly quotes a field containing a comma and embedded quotes", csv.includes('"Batch, with ""quotes"" და ქართული"'));
  check("   CSV correctly quotes a field containing a comma (partner name)", csv.includes('"Partner, Inc."'));

  console.log("\nCleaning up fixtures...");
  await admin`delete from qr_codes where partner_id in (${partnerA}, ${partnerB}, ${partnerSuspended})`;
  await admin`delete from qr_batches where partner_id in (${partnerA}, ${partnerB}, ${partnerSuspended})`;
  await admin`delete from partner_members where partner_id in (${partnerA}, ${partnerB}, ${partnerSuspended})`;
  await admin`delete from analytics_events where partner_id in (${partnerA}, ${partnerB}, ${partnerSuspended})`;
  await admin`delete from partners where id in (${partnerA}, ${partnerB}, ${partnerSuspended})`;

  await admin.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  // Explicit exit: the app_runtime pool opened transitively via
  // require("../src/db/client") keeps idle sockets open with no timeout, which
  // can leave this standalone process alive well after all checks have
  // completed instead of letting Node exit naturally once the event loop empties.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end();
  process.exit(1);
});

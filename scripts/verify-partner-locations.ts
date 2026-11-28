import Module from "node:module";
import { readFileSync } from "node:fs";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { sql: dsql } = require("drizzle-orm") as typeof import("drizzle-orm");
const { withAdminContext, withPartnerContext, withPublicContext, withUserContext } = require("../src/db/client") as typeof import("../src/db/client");
const schema = require("../src/db/schema") as typeof import("../src/db/schema");
const locAdmin = require("../src/lib/partner-locations/admin") as typeof import("../src/lib/partner-locations/admin");
const pub = require("../src/lib/partner-locations/public") as typeof import("../src/lib/partner-locations/public");
const shared = require("../src/lib/partner-locations/shared") as typeof import("../src/lib/partner-locations/shared");
const { partnerMapMocksEnabled } = require("../src/lib/partner-locations/flag") as typeof import("../src/lib/partner-locations/flag");
const { partnerMapMockProblems } = require("../src/lib/env-guards") as typeof import("../src/lib/env-guards");
const { locationInputSchema } = require("../src/lib/validation/partner-locations") as typeof import("../src/lib/validation/partner-locations");
const { buildContentSecurityPolicy, MAP_TILE_ORIGIN } = require("../src/lib/security/csp") as typeof import("../src/lib/security/csp");
const { TILE_ORIGIN } = require("../src/components/maps/map-style") as typeof import("../src/components/maps/map-style");
const { MAPLIBRE_VERSION, MAPLIBRE_WORKER_URL } = require("../src/components/maps/load-maplibre") as typeof import("../src/components/maps/load-maplibre");

/**
 * Partner locations (migrations/0028, lib/partner-locations):
 *
 *  1. Public visibility: only public + verified + ACTIVE-partner + non-mock
 *     rows come out of app_public_partner_locations; mocks only on request.
 *  2. Public payload: display columns only — no partner id, commission,
 *     audit fields, verification actor or stock flags.
 *  3. Availability: derived from distributed + unsold cards and the branch
 *     switch; never AVAILABLE from undistributed or sold cards.
 *  4. Verification: new rows start hidden + unverified even if the caller
 *     says otherwise; moving the shop clears verification and hides it;
 *     public requires verified (CHECK).
 *  5. Access control: anonymous / plain user / partner OWNER cannot read or
 *     write the table; anon/authenticated/service_role hold no privilege on
 *     the table or the function (Data API stays closed, SEC-01).
 *  6. Admin service: create → verify → publish → stock → conflict detection
 *     → hide → delete, one audit row per change; mocks can't be published.
 *  7. Pure helpers + guards: coordinate parsing, search normalisation,
 *     directions URL, validation, mock flag refused on hosted envs, CSP
 *     allows the tile origin + same-origin worker, vendored worker matches
 *     the installed MapLibre.
 */

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const su = postgres(migrationsUrl, { max: 1 });

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}
async function refuses(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

const RUN = `vpl${Date.now().toString(36)}`;
const input = (over: Partial<Record<string, unknown>> = {}) =>
  locationInputSchema.parse({
    branchName: "Verify branch",
    category: "FLOWERS",
    addressKa: "სატესტო მისამართი 1",
    addressEn: "Test address 1",
    cityKa: "თბილისი",
    cityEn: "Tbilisi",
    districtKa: "ვაკე",
    districtEn: "Vake",
    latitude: 41.71,
    longitude: 44.76,
    phone: "+995 555 00 00 09",
    hoursKa: "",
    hoursEn: "",
    stocksCards: true,
    ...over,
  });

async function publicRows(includeMock = false) {
  const rows = await withPublicContext((tx) => tx.execute<Record<string, unknown>>(dsql`select * from app_public_partner_locations(${includeMock})`));
  return Array.from(rows).filter((r) => String(r.partner_name).includes(RUN));
}

async function main() {
  const [adminRow] = await su`select user_id from admin_users limit 1`;
  if (!adminRow) throw new Error("No admin user — run npm run db:dev-bootstrap");
  const adminId = adminRow.user_id as string;

  // Fixtures (superuser): two partners, one suspended, plus a partner owner.
  const [active] = await su`insert into partners (slug, name) values (${RUN + "-a"}, ${"Verify Shop " + RUN}) returning id`;
  const [suspended] = await su`insert into partners (slug, name, status) values (${RUN + "-s"}, ${"Verify Suspended " + RUN}, 'SUSPENDED') returning id`;
  const partnerId = active!.id as string;
  const ownerId = crypto.randomUUID();
  await su`insert into partner_members (partner_id, user_id, role) values (${partnerId}, ${ownerId}, 'OWNER')`;
  const rawInsert = (pid: string, over: Record<string, unknown>) =>
    su`insert into partner_locations ${su({
      partner_id: pid,
      category: "GIFTS",
      address_ka: "სატესტო მისამართი",
      city_ka: "თბილისი",
      latitude: 41.7,
      longitude: 44.8,
      ...over,
    })} returning id`;

  try {
    // ---------------------------------------------------------- 1. visibility
    console.log("\n1. Public visibility");
    const [shown] = await rawInsert(partnerId, { is_public: true, coordinates_verified_at: new Date(), branch_name: "shown" });
    await rawInsert(partnerId, { is_public: false, coordinates_verified_at: new Date(), branch_name: "hidden" });
    await rawInsert(partnerId, { is_public: false, branch_name: "unverified" });
    await rawInsert(suspended!.id as string, { is_public: true, coordinates_verified_at: new Date(), branch_name: "suspended" });
    const [mock] = await rawInsert(partnerId, { is_public: true, is_mock: true, coordinates_verified_at: new Date(), branch_name: "mock" });
    let rows = await publicRows();
    check("1a. only the public, verified, active, non-mock row is public", rows.length === 1 && rows[0]!.branch_name === "shown", rows.map((r) => r.branch_name));
    rows = await publicRows(true);
    check("1b. mocks appear only when explicitly requested", rows.length === 2 && rows.some((r) => r.id === mock!.id && r.is_mock === true));
    check("1c. a public row can't exist unverified (CHECK)", await refuses(() => rawInsert(partnerId, { is_public: true, branch_name: "bad" })));
    await su`update partners set status = 'SUSPENDED' where id = ${partnerId}`;
    check("1d. suspending the partner removes its locations at once", (await publicRows()).length === 0);
    await su`update partners set status = 'ACTIVE' where id = ${partnerId}`;

    // ------------------------------------------------------------ 2. payload
    console.log("\n2. Public payload");
    rows = await publicRows();
    const cols = Object.keys(rows[0] ?? {}).sort();
    const forbidden = ["partner_id", "commission_rate_bps", "coordinates_verified_by", "coordinates_verified_at", "stocks_cards", "is_public", "created_at", "updated_at", "slug"];
    check("2a. no internal column is returned", forbidden.every((c) => !cols.includes(c)), cols);
    const mapped = pub.toPublicLocation(rows[0] as never, "en");
    check("2b. English falls back to Georgian when no English text", mapped.address === "სატესტო მისამართი" && mapped.city === "თბილისი");
    check("2c. sort puts the city with most shops first", pub.sortByCityWeight([{ ...mapped, id: "b", city: "B" }, { ...mapped, id: "a1", city: "A" }, { ...mapped, id: "a2", city: "A" }]).map((l) => l.id).join() === "a1,a2,b");

    // ------------------------------------------------------- 3. availability
    console.log("\n3. Availability");
    const avail = async () => (await publicRows()).find((r) => r.id === shown!.id)?.availability;
    check("3a. no distributed cards → UNKNOWN (no claim)", (await avail()) === "UNKNOWN");
    const [batch] = await su`insert into qr_batches (partner_id, label, quantity) values (${partnerId}, ${RUN}, 2) returning id`;
    const tok = () => `VPL${crypto.randomUUID().replace(/-/g, "").slice(0, 21).toUpperCase()}`;
    const [qr1] = await su`insert into qr_codes (public_token, batch_id, partner_id) values (${tok()}, ${batch!.id}, ${partnerId}) returning id`;
    check("3b. undistributed unsold card → still UNKNOWN", (await avail()) === "UNKNOWN");
    await su`update qr_codes set distribution_status = 'DISTRIBUTED', distributed_at = now() where id = ${qr1!.id}`;
    check("3c. distributed unsold card → AVAILABLE", (await avail()) === "AVAILABLE");
    await su`update qr_codes set status = 'BLOCKED' where id = ${qr1!.id}`;
    check("3d. the only distributed card no longer AVAILABLE → UNKNOWN", (await avail()) === "UNKNOWN");
    await su`update qr_codes set status = 'AVAILABLE' where id = ${qr1!.id}`;
    await su`update partner_locations set stocks_cards = false where id = ${shown!.id}`;
    check("3e. branch marked as not stocking → OUT, whatever the partner holds", (await avail()) === "OUT");
    await su`update partner_locations set stocks_cards = true where id = ${shown!.id}`;

    // ------------------------------------------------------- 4. verification
    console.log("\n4. Verification trigger");
    await su`update partner_locations set latitude = 41.7001 where id = ${shown!.id}`;
    const [moved] = await su`select is_public, coordinates_verified_at from partner_locations where id = ${shown!.id}`;
    check("4a. moving the pin clears verification and hides the row", moved!.is_public === false && moved!.coordinates_verified_at === null);
    await su`update partner_locations set coordinates_verified_at = now(), is_public = true where id = ${shown!.id}`;
    await su`update partner_locations set address_ka = 'სატესტო მისამართი 2' where id = ${shown!.id}`;
    const [moved2] = await su`select is_public from partner_locations where id = ${shown!.id}`;
    check("4b. changing the address does the same", moved2!.is_public === false);
    await su`update partner_locations set coordinates_verified_at = now(), is_public = true where id = ${shown!.id}`;
    await su`update partner_locations set hours_ka = 'ყოველდღე' , phone = '+995 555 11 11 11' where id = ${shown!.id}`;
    const [kept] = await su`select is_public from partner_locations where id = ${shown!.id}`;
    check("4c. editing hours/phone keeps it verified and public", kept!.is_public === true);

    // ------------------------------------------------------ 5. access control
    console.log("\n5. Access control");
    const anonRows = await withPublicContext((tx) => tx.select().from(schema.partnerLocations));
    check("5a. anonymous context reads no rows from the table", anonRows.length === 0);
    const userRows = await withUserContext(crypto.randomUUID(), (tx) => tx.select().from(schema.partnerLocations));
    check("5b. a signed-in non-admin reads no rows", userRows.length === 0);
    const ownerRows = await withPartnerContext(ownerId, partnerId, (tx) => tx.select().from(schema.partnerLocations));
    check("5c. the partner's own OWNER reads no rows (admin-managed)", ownerRows.length === 0);
    check(
      "5d. partner OWNER cannot insert",
      await refuses(() => withPartnerContext(ownerId, partnerId, (tx) => tx.insert(schema.partnerLocations).values({ partnerId, addressKa: "xxx", cityKa: "თბ", latitude: 41.7, longitude: 44.8 }))),
    );
    const updated = await withPartnerContext(ownerId, partnerId, (tx) => tx.update(schema.partnerLocations).set({ isPublic: false }).returning({ id: schema.partnerLocations.id }));
    check("5e. partner OWNER updates nothing", updated.length === 0);
    check("5f. the admin service refuses a non-admin context", await refuses(() => withUserContext(ownerId, (tx) => locAdmin.createLocation(tx, ownerId, partnerId, input()))));
    const privs = await su`
      select grantee, privilege_type from information_schema.role_table_grants
      where table_name = 'partner_locations' and grantee in ('anon','authenticated','service_role','PUBLIC')`;
    check("5g. anon/authenticated/service_role/PUBLIC hold no table privilege", privs.length === 0, privs);
    const fnPrivs = await su`
      select r.rolname from pg_roles r
      where r.rolname in ('anon','authenticated','service_role')
        and has_function_privilege(r.oid, 'app_public_partner_locations(boolean)', 'execute')`;
    check("5h. the public function is not executable by Data API roles", fnPrivs.length === 0, fnPrivs);
    const [rls] = await su`select relrowsecurity from pg_class where relname = 'partner_locations'`;
    check("5i. RLS is enabled", rls!.relrowsecurity === true);

    // ------------------------------------------------------- 6. admin service
    console.log("\n6. Admin service");
    const created = await withAdminContext(adminId, (tx) => locAdmin.createLocation(tx, adminId, partnerId, input()));
    const [fresh] = await su`select is_public, coordinates_verified_at, updated_at, is_mock from partner_locations where id = ${created.id}`;
    check("6a. a new location starts hidden and unverified", fresh!.is_public === false && fresh!.coordinates_verified_at === null && fresh!.is_mock === false);
    const v0 = (fresh!.updated_at as Date).toISOString();
    check("6b. publishing before verifying is refused", await refuses(() => withAdminContext(adminId, (tx) => locAdmin.setLocationVisibility(tx, adminId, partnerId, created.id, v0, true))));
    await withAdminContext(adminId, (tx) => locAdmin.verifyLocation(tx, adminId, partnerId, created.id, v0));
    const ver = async () => ((await su`select updated_at from partner_locations where id = ${created.id}`)[0]!.updated_at as Date).toISOString();
    const v1 = await ver();
    check("6c. a stale version is refused (someone else changed it)", await refuses(() => withAdminContext(adminId, (tx) => locAdmin.setLocationVisibility(tx, adminId, partnerId, created.id, v0, true))));
    await withAdminContext(adminId, (tx) => locAdmin.setLocationVisibility(tx, adminId, partnerId, created.id, v1, true));
    check("6d. verified + published → on the public map", (await publicRows()).some((r) => r.id === created.id));
    await withAdminContext(adminId, async (tx) => locAdmin.setLocationStock(tx, adminId, partnerId, created.id, await ver(), false));
    check("6e. admin 'out of cards' → OUT publicly", (await publicRows()).find((r) => r.id === created.id)?.availability === "OUT");
    const res = await withAdminContext(adminId, async (tx) => locAdmin.updateLocation(tx, adminId, partnerId, created.id, await ver(), input({ latitude: 41.72 })));
    check("6f. moving it through the service reports + applies un-verification", res.verificationCleared === true && !(await publicRows()).some((r) => r.id === created.id));
    const list = await withAdminContext(adminId, (tx) => locAdmin.listPartnerLocations(tx, partnerId));
    check("6g. admin list shows all 5 of the partner's rows (incl. hidden, unverified, mock)", list.length === 5, list.length);
    check("6h. another partner's location can't be edited through this partner", await refuses(async () => withAdminContext(adminId, async (tx) => locAdmin.verifyLocation(tx, adminId, suspended!.id as string, created.id, await ver()))));
    await su`update partner_locations set is_public = false where id = ${mock!.id}`;
    const mockVer = ((await su`select updated_at from partner_locations where id = ${mock!.id}`)[0]!.updated_at as Date).toISOString();
    check("6i. a mock location can never be published by an admin", await refuses(() => withAdminContext(adminId, (tx) => locAdmin.setLocationVisibility(tx, adminId, partnerId, mock!.id, mockVer, true))));
    await withAdminContext(adminId, async (tx) => locAdmin.deleteLocation(tx, adminId, partnerId, created.id, await ver()));
    const audits = await su`select action from audit_logs where target_id = ${created.id} order by created_at`;
    check(
      "6j. one audit row per change",
      audits.map((a) => a.action).join() === "PARTNER_LOCATION_CREATED,PARTNER_LOCATION_VERIFIED,PARTNER_LOCATION_PUBLISHED,PARTNER_LOCATION_OUT_OF_STOCK,PARTNER_LOCATION_UPDATED,PARTNER_LOCATION_DELETED",
      audits.map((a) => a.action),
    );
    check("6k. app_runtime insert can't smuggle in verified/public", await (async () => {
      const r = await withAdminContext(adminId, (tx) =>
        tx.insert(schema.partnerLocations).values({ partnerId, addressKa: "სატესტო 3", cityKa: "თბილისი", latitude: 41.7, longitude: 44.8, isPublic: true, coordinatesVerifiedAt: new Date() }).returning(),
      ).catch(() => null);
      return r === null || (r[0]!.isPublic === false && r[0]!.coordinatesVerifiedAt === null);
    })());

    // ---------------------------------------------------- 7. helpers + guards
    console.log("\n7. Helpers and guards");
    check("7a. parses a Google Maps paste", JSON.stringify(shared.parseCoordinates(" 41.7151, 44.8271 ")) === '{"latitude":41.7151,"longitude":44.8271}');
    check("7b. refuses garbage / out of range", shared.parseCoordinates("Tbilisi") === null && shared.parseCoordinates("91, 44") === null && shared.parseCoordinates("41.7") === null);
    check("7c. flags swapped lat/lng as outside Georgia", shared.isInGeorgia(41.7, 44.8) && !shared.isInGeorgia(44.8, 41.7));
    check("7d. directions URL is a keyless Google Maps link", shared.directionsUrl(41.7, 44.8) === "https://www.google.com/maps/dir/?api=1&destination=41.700000,44.800000");
    check("7e. search is case/punctuation-insensitive", shared.normalizeSearch("  Vake, TBILISI!") === "vake tbilisi" && shared.normalizeSearch("ვაკე") === "ვაკე");
    check("7f. validation refuses a bad phone / short address", await refuses(async () => input({ phone: "call me" })) && await refuses(async () => input({ addressKa: "x" })));
    check("7g. blank optional fields become null", input({ branchName: "  " }).branchName === null);
    check("7h. mock flag ignored on hosted environments", partnerMapMocksEnabled({ PARTNER_MAP_MOCKS: "1" }) && !partnerMapMocksEnabled({ PARTNER_MAP_MOCKS: "1", RENDER: "true" }) && !partnerMapMocksEnabled({ PARTNER_MAP_MOCKS: "1", VERCEL: "1" }));
    check("7i. hosted boot refuses PARTNER_MAP_MOCKS", partnerMapMockProblems({ PARTNER_MAP_MOCKS: "1", RENDER: "true" }).length === 1 && partnerMapMockProblems({ PARTNER_MAP_MOCKS: "1" }).length === 0);
    const csp = buildContentSecurityPolicy("n", "https://x.supabase.co");
    check("7j. CSP allows the tile origin and a same-origin worker, nothing broader", csp.includes(`connect-src 'self' https://x.supabase.co ${MAP_TILE_ORIGIN}`) && csp.includes("worker-src 'self' blob:") && !csp.includes("*"));
    check("7k. style and CSP agree on the tile origin", TILE_ORIGIN === MAP_TILE_ORIGIN);
    const installed = JSON.parse(readFileSync("node_modules/maplibre-gl/package.json", "utf8")).version;
    const vendored = readFileSync(`public${MAPLIBRE_WORKER_URL}`);
    const original = readFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
    check("7l. vendored worker matches the installed MapLibre", installed === MAPLIBRE_VERSION && vendored.equals(original), { installed, MAPLIBRE_VERSION });
    const cats = (await su`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'partner_locations_category_check'`)[0]!.def as string;
    check("7m. category list matches the DB constraint", shared.LOCATION_CATEGORIES.every((c) => cats.includes(`'${c}'`)) && (cats.match(/'[A-Z]+'/g) ?? []).length === shared.LOCATION_CATEGORIES.length);
  } finally {
    await su`delete from audit_logs where target_type = 'partner_location' and metadata->>'partnerId' = ${partnerId}`;
    await su`delete from partner_locations where partner_id in (${partnerId}, ${suspended!.id})`;
    await su`delete from qr_codes where partner_id = ${partnerId}`;
    await su`delete from qr_batches where partner_id = ${partnerId}`;
    await su`delete from partner_members where partner_id = ${partnerId}`;
    await su`delete from partners where id in (${partnerId}, ${suspended!.id})`;
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

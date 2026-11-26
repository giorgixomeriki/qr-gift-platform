import Module from "node:module";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Temporary admin MFA pause (docs/security/ADMIN_MFA_TEMPORARY_PAUSE.md) against a real Supabase Auth server.
 * Real sessions, real TOTP, and the app's own guards, actions and routes. Only
 * the Next.js request cookie store is replaced, by a jar this suite controls.
 * Local stack only.
 */
type Cookie = { name: string; value: string };
class Jar {
  private cookies = new Map<string, string>();
  getAll = (): Cookie[] => [...this.cookies].map(([name, value]) => ({ name, value }));
  get = (name: string) => (this.cookies.has(name) ? { name, value: this.cookies.get(name)! } : undefined);
  set = (name: string, value: string, options?: { maxAge?: number }) => {
    if (value === "" || options?.maxAge === 0) this.cookies.delete(name);
    else this.cookies.set(name, value);
  };
}
let currentJar = new Jar();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  if (request === "next/headers") return { cookies: async () => currentJar, headers: async () => new Headers() };
  if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {} };
  return nodeModuleLoad.call(this, request, ...rest);
};

// The print page is JSX, which tsx compiles to the classic React.createElement.
(globalThis as unknown as { React: unknown }).React = require("react");

const postgres = require("postgres") as typeof import("postgres");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const { NextRequest } = require("next/server") as typeof import("next/server");
const { resolveSecretKey } = require("../src/lib/supabase/keys") as typeof import("../src/lib/supabase/keys");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = resolveSecretKey(process.env)?.key;
if (!migrationsUrl || !supabaseUrl || !secretKey) throw new Error("MIGRATIONS_DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) throw new Error("verify:admin-mfa-pause runs against a local Supabase stack only");

const pg = postgres(migrationsUrl, { max: 1 });
const authAdmin = createClient(supabaseUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

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

// Test-only RFC 6238. The product itself never computes or compares codes.
function totp(secretBase32: string, offsetSteps = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secretBase32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + offsetSteps));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function caught(fn: () => Promise<unknown>): Promise<Error & { digest?: string }> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  return new Error("(did not throw)");
}

const RUN = randomUUID().slice(0, 8);
const PASSWORD = `verify-${RUN}-password-1`;
const email = (who: string) => `${who}-${RUN}@verify.test`;
const createdUsers: string[] = [];
const created = { partnerId: randomUUID(), batchId: randomUUID(), qrId: randomUUID() };
const tempDir = mkdtempSync(join(tmpdir(), "verify-admin-mfa-pause-"));

async function createUser(who: string): Promise<string> {
  const { data, error } = await authAdmin.auth.admin.createUser({ email: email(who), password: PASSWORD, email_confirm: true });
  if (error) throw error;
  createdUsers.push(data.user.id);
  return data.user.id;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function adminAccessCli(args: string[]): { ok: boolean; out: string } {
  const host = new URL(supabaseUrl!).host;
  try {
    const out = execFileSync("./node_modules/.bin/tsx", ["scripts/ops/admin-access.ts", ...args, "--expect-host", host], { stdio: "pipe", env: process.env, encoding: "utf8" });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}


async function main() {
  // Pure decision logic needs no env.
  const { decideAdminAccess, readAdminMfaPause, isMfaPausedFor, ADMIN_MFA_PAUSE_MAX_DAYS } = require("../src/lib/auth/assurance") as typeof import("../src/lib/auth/assurance");

  console.log("\n--- 1. Pause configuration (fails closed) ---");
  const now = Date.parse("2026-11-26T12:00:00Z");
  const id = "e8895f17-0000-4000-8000-000000000001";
  const inDays = (n: number) => new Date(now + n * 86_400_000).toISOString();
  check("1a. unset → off, no problem logged", (() => { const p = readAdminMfaPause(undefined, undefined, now); return !p.active && p.problem === null; })());
  check("1b. empty strings → off", !readAdminMfaPause("", " ", now).active);
  check("1c. only the user id → off", !readAdminMfaPause(id, undefined, now).active);
  check("1d. only the date → off", !readAdminMfaPause(undefined, inDays(5), now).active);
  check("1e. a list of ids → off", !readAdminMfaPause(`${id},${id}`, inDays(5), now).active);
  check("1f. '*' or 'true' → off (no wildcard)", !readAdminMfaPause("*", inDays(5), now).active && !readAdminMfaPause("true", inDays(5), now).active);
  check("1g. date without a zone → off", !readAdminMfaPause(id, "2026-12-01T00:00", now).active && !readAdminMfaPause(id, "2026-12-01", now).active);
  check("1h. past date → off", !readAdminMfaPause(id, inDays(-1), now).active);
  check(`1i. more than ${ADMIN_MFA_PAUSE_MAX_DAYS} days → off`, !readAdminMfaPause(id, inDays(ADMIN_MFA_PAUSE_MAX_DAYS + 1), now).active);
  const ok = readAdminMfaPause(id.toUpperCase(), inDays(10), now);
  check("1j. valid id + future date → on", ok.active && ok.userId === id);
  check("1k. applies to that user only", isMfaPausedFor(ok, id) && !isMfaPausedFor(ok, "e8895f17-0000-4000-8000-000000000002"));
  check("1l. expires by itself (same config, later clock)", !readAdminMfaPause(id, inDays(10), now + 11 * 86_400_000).active);

  console.log("\n--- 2. Decision table with the pause ---");
  const d = (isAdmin: boolean, aal: "aal1" | "aal2" | null, authorizedFactors: number, unauthorizedFactors: number, enrollmentAuthorized: boolean, mfaPaused: boolean) =>
    decideAdminAccess({ signedIn: true, isAdmin, aal, authorizedFactors, unauthorizedFactors, enrollmentAuthorized, mfaPaused });
  check("2a. paused admin, password session, factor on lost phone → GRANTED_MFA_PAUSED", d(true, "aal1", 1, 0, false, true) === "GRANTED_MFA_PAUSED");
  check("2b. paused admin with no factor → GRANTED_MFA_PAUSED", d(true, "aal1", 0, 0, false, true) === "GRANTED_MFA_PAUSED");
  check("2c. non-admin, even if named → NOT_ADMIN", decideAdminAccess({ signedIn: true, isAdmin: false, aal: "aal1", authorizedFactors: 0, unauthorizedFactors: 0, enrollmentAuthorized: false, mfaPaused: true }) === "NOT_ADMIN");
  check("2d. not signed in → ANONYMOUS", decideAdminAccess({ signedIn: false, isAdmin: true, aal: null, authorizedFactors: 0, unauthorizedFactors: 0, enrollmentAuthorized: false, mfaPaused: true }) === "ANONYMOUS");
  check("2e. unauthorized factor still locks while paused", d(true, "aal1", 1, 1, false, true) === "MFA_LOCKED");
  check("2f. enrollment grant beats the pause (restore path)", d(true, "aal1", 0, 0, true, true) === "MFA_ENROLL");
  check("2g. unverifiable token (aal null) is not let in", d(true, null, 1, 0, false, true) === "MFA_CHALLENGE");
  check("2h. real aal2 is still full GRANTED", d(true, "aal2", 1, 0, false, true) === "GRANTED");
  check("2i. without the pause nothing changed", d(true, "aal1", 1, 0, false, false) === "MFA_CHALLENGE" && d(true, "aal1", 0, 0, false, false) === "MFA_LOCKED");

  console.log("\nSetting up fixtures...");
  const ownerId = await createUser("owner");
  const otherAdminId = await createUser("other");
  const partnerUserId = await createUser("partner");
  await pg`insert into admin_users (user_id) values (${ownerId}), (${otherAdminId})`;
  await pg`insert into partners (id, slug, name, commission_rate_bps, status) values (${created.partnerId}, ${`verify-pause-${RUN}`}, 'Verify Pause', 3000, 'ACTIVE')`;
  await pg`insert into partner_members (partner_id, user_id, role) values (${created.partnerId}, ${partnerUserId}, 'OWNER')`;
  await pg`insert into qr_batches (id, partner_id, label, quantity) values (${created.batchId}, ${created.partnerId}, 'verify-pause', 1)`;
  await pg`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${created.qrId}, ${`VPAU${RUN.toUpperCase()}`}, ${created.batchId}, ${created.partnerId}, 'AVAILABLE')`;

  // The app reads its env once at load: set the pause for the owner only, then load it.
  process.env.ADMIN_MFA_PAUSE_USER_ID = ownerId;
  process.env.ADMIN_MFA_PAUSE_UNTIL = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const adminLib = require("../src/lib/auth/admin") as typeof import("../src/lib/auth/admin");
  const { createSupabaseServerClient } = require("../src/lib/supabase/server") as typeof import("../src/lib/supabase/server");
  const actions = require("../src/lib/auth/mfa-actions") as typeof import("../src/lib/auth/mfa-actions");
  const payments = require("../src/lib/payments/admin-actions") as typeof import("../src/lib/payments/admin-actions");
  const payouts = require("../src/lib/payments/payout-actions") as typeof import("../src/lib/payments/payout-actions");
  const pricing = require("../src/lib/payments/pricing-actions") as typeof import("../src/lib/payments/pricing-actions");
  const { GET: qrAsset } = require("../src/app/api/qr/[qrCodeId]/route") as typeof import("../src/app/api/qr/[qrCodeId]/route");
  const { GET: batchExport } = require("../src/app/api/qr/batches/[batchId]/export/route") as typeof import("../src/app/api/qr/batches/[batchId]/export/route");

  async function signIn(who: string, password = PASSWORD): Promise<Jar> {
    const jar = new Jar();
    currentJar = jar;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email(who), password });
    if (error) throw error;
    await sleep(30);
    return jar;
  }
  const access = async (jar: Jar) => {
    currentJar = jar;
    return (await adminLib.getAdminAccess()).access;
  };
  const requireOk = () => adminLib.requireAdmin(async (_tx, uid) => uid);
  const requireFinancial = () => adminLib.requireAdmin(async (_tx, uid) => uid, { financial: true });
  const qr = () => qrAsset(new NextRequest(`http://local.test/api/qr/${created.qrId}`), { params: Promise.resolve({ qrCodeId: created.qrId }) });
  const exportCsv = () => batchExport(new Request("http://local.test/x"), { params: Promise.resolve({ batchId: created.batchId }) });
  const grant = (who: string) => adminAccessCli(["grant-enrollment", "--email", email(who), "--reason", "verify suite", "--minutes", "15", "--apply"]);
  const enrollNow = async () => {
    const e = await actions.startMfaEnrollmentAction();
    if (!e.ok) throw new Error(`enrollment failed: ${e.error}`);
    const c = await actions.confirmMfaEnrollmentAction(e.factorId, totp(e.secret));
    if (!c.ok) throw new Error(`confirm failed: ${c.error}`);
    await sleep(30);
    return e;
  };

  // Both admins enrolled a phone normally, before the pause mattered.
  check("3a. owner enrolment grant issued", grant("owner").ok);
  await signIn("owner");
  const lostPhone = await enrollNow();
  check("3b. other admin enrolment grant issued", grant("other").ok);
  await signIn("other");
  await enrollNow();

  console.log("\n--- 4. Owner signs in with email + password only (phone lost) ---");
  const ownerJar = await signIn("owner");
  check("4a. state is GRANTED_MFA_PAUSED (no TOTP asked)", (await access(ownerJar)) === "GRANTED_MFA_PAUSED", await access(ownerJar));
  check("4b. requireAdmin passes as the owner", (await requireOk()) === ownerId);
  const page = await adminLib.requireAdminPage();
  check("4c. admin pages open (no redirect to /admin/mfa)", page.isAdmin === true && page.user.id === ownerId);
  check("4d. operator view is ADMIN", (await adminLib.resolveOperatorViewer()).kind === "ADMIN");
  check("4e. QR asset 200 (RLS admin view)", (await qr()).status === 200);
  check("4f. batch export 200", (await exportCsv()).status === 200);

  console.log("\n--- 5. Financial actions stay disabled while paused ---");
  check("5a. requireAdmin({ financial }) refuses with MfaRequiredError", (await caught(requireFinancial)).name === "MfaRequiredError");
  const auditBefore = (await pg`select count(*)::int as n from audit_logs where actor_id = ${ownerId}`)[0]!.n as number;
  const ordersBefore = (await pg`select count(*)::int as n, coalesce(sum(case when status = 'REFUNDED' then 1 else 0 end),0)::int as r from orders`)[0]!;
  const mfaMsg = (r: { ok: boolean; error?: string }) => !r.ok && /Multi-factor/.test(r.error ?? "");
  check("5b. refund refused", mfaMsg(await payments.adminRefundPaidOrderAction(randomUUID())));
  check("5c. chargeback refused", mfaMsg(await payments.adminRecordChargebackAction(randomUUID(), { reference: "verify", disputedOn: "2026-11-01" })));
  check("5d. payment reconcile refused", mfaMsg(await payments.adminReconcilePaymentAction(randomUUID())));
  check("5e. activation reconcile refused", mfaMsg(await payments.reconcileActivationsAction()));
  check("5f. payout refused", mfaMsg(await payouts.adminRecordPayoutAction(created.partnerId, { currency: "GEL", periodFrom: "2026-11-01", periodTo: "2026-11-02", expectedAmountMinor: 100, expectedLedgerEntryIds: [randomUUID()] })));
  check("5g. commission change refused", mfaMsg(await pricing.adminSetPartnerCommissionAction(created.partnerId, { commissionRateBps: 1000, expectedCommissionRateBps: 3000 })));
  check("5g2. default price change refused", mfaMsg(await pricing.adminSetDefaultPriceAction({ amountMinor: 1000, expectedAmountMinor: 1000 })));
  check("5g3. partner price change refused", mfaMsg(await pricing.adminSetPartnerPriceAction(created.partnerId, { amountMinor: 1000, expectedAmountMinor: null }).catch((e: Error) => ({ ok: false, error: e.message }))));
  check("5h. partner commission unchanged", (await pg`select commission_rate_bps from partners where id = ${created.partnerId}`)[0]!.commission_rate_bps === 3000);
  const ordersAfter = (await pg`select count(*)::int as n, coalesce(sum(case when status = 'REFUNDED' then 1 else 0 end),0)::int as r from orders`)[0]!;
  check("5i. no order or refund state changed", ordersAfter.n === ordersBefore.n && ordersAfter.r === ordersBefore.r);
  check("5j. no payouts written", (await pg`select count(*)::int as n from partner_payouts where partner_id = ${created.partnerId}`.catch(() => [{ n: 0 }]))[0]!.n === 0);
  check("5k. nothing audited as the owner", (await pg`select count(*)::int as n from audit_logs where actor_id = ${ownerId}`)[0]!.n === auditBefore);

  console.log("\n--- 6. The pause cannot be used to take over MFA ---");
  currentJar = ownerJar;
  check("6a. cannot enroll a new device in the app while paused", !(await actions.startMfaEnrollmentAction()).ok);
  check("6b. cannot remove the lost factor in the app", !(await actions.removeMfaFactorAction(lostPhone.factorId)).ok);
  const direct = await (await createSupabaseServerClient()).auth.mfa.enroll({ factorType: "totp", friendlyName: "x" });
  check("6c. Supabase itself refuses an aal1 enrolment", direct.error !== null);

  console.log("\n--- 7. Everyone else is unchanged ---");
  const otherJar = await signIn("other");
  check("7a. another admin (not named) still gets MFA_CHALLENGE", (await access(otherJar)) === "MFA_CHALLENGE");
  check("7b. …and requireAdmin refuses", (await caught(requireOk)).name === "MfaRequiredError");
  check("7c. …and its QR asset is 403", (await qr()).status === 403);
  const partnerJar = await signIn("partner");
  check("7d. partner owner is NOT_ADMIN", (await access(partnerJar)) === "NOT_ADMIN");
  check("7e. requireAdmin: not an admin", (await caught(requireOk)).message === "Not an admin");
  check("7f. admin page shows NotAdmin", (await adminLib.requireAdminPage()).isAdmin === false);
  check("7g. partner still sees its own QR asset (partner flow unchanged)", (await qr()).status === 200);
  currentJar = new Jar();
  check("7h. anonymous: requireAdmin refuses", (await caught(requireOk)).message === "Not signed in");
  check("7i. anonymous: QR asset 401", (await qr()).status === 401);
  const wrongPw = await (await createSupabaseServerClient()).auth.signInWithPassword({ email: email("owner"), password: "wrong-password-123" });
  check("7j. wrong password is still refused", wrongPw.error !== null);

  console.log("\n--- 8. Losing admin ends the pause ---");
  await pg`delete from admin_users where user_id = ${ownerId}`;
  check("8a. named user removed from admin_users → NOT_ADMIN", (await access(ownerJar)) === "NOT_ADMIN");
  check("8b. requireAdmin: not an admin", (await caught(requireOk)).message === "Not an admin");
  await pg`insert into admin_users (user_id) values (${ownerId})`;

  console.log("\n--- 9. Restoring MFA with a new phone ---");
  const credFile = join(tempDir, "owner-reset.txt");
  const reset = adminAccessCli(["reset-mfa", "--email", email("owner"), "--reason", "verify: new phone", "--credential-file", credFile, "--minutes", "30", "--apply"]);
  check("9a. operator reset-mfa succeeds", reset.ok, reset.out);
  check("9b. old sessions ended", (await access(ownerJar)) === "ANONYMOUS");
  const newPassword = readFileSync(credFile, "utf8").split("\n")[1]!;
  const oldPw = await (await createSupabaseServerClient()).auth.signInWithPassword({ email: email("owner"), password: PASSWORD });
  check("9c. old password no longer works", oldPw.error !== null);
  const freshJar = await signIn("owner", newPassword);
  check("9d. even with the pause still set, the grant routes to MFA_ENROLL", (await access(freshJar)) === "MFA_ENROLL");
  await enrollNow();
  check("9e. new phone enrolled → full GRANTED (aal2)", (await access(freshJar)) === "GRANTED");
  check("9f. financial actions available again at aal2", (await requireFinancial()) === ownerId);
  const { data: f } = await authAdmin.auth.admin.mfa.listFactors({ userId: ownerId });
  check("9g. exactly one factor (the lost phone is gone)", f?.factors.filter((x) => x.status === "verified").length === 1 && !f.factors.some((x) => x.id === lostPhone.factorId));
}

async function cleanup() {
  await pg`delete from audit_logs where actor_id = any(${createdUsers}::uuid[]) or target_id = any(${createdUsers}::text[])`.catch(() => {});
  await pg`delete from audit_logs where target_id in (${created.qrId}, ${created.batchId})`.catch(() => {});
  await pg`delete from rate_limits where key like ${`%${RUN}%`}`.catch(() => {});
  await pg`delete from admin_users where user_id = any(${createdUsers}::uuid[])`.catch(() => {});
  await pg`delete from qr_codes where id = ${created.qrId}`.catch(() => {});
  await pg`delete from qr_batches where id = ${created.batchId}`.catch(() => {});
  await pg`delete from partner_members where partner_id = ${created.partnerId}`.catch(() => {});
  await pg`delete from partners where id = ${created.partnerId}`.catch(() => {});
  for (const uid of createdUsers) await authAdmin.auth.admin.deleteUser(uid).catch(() => {});
  rmSync(tempDir, { recursive: true, force: true });
  await pg.end();
}

main()
  .catch((err) => {
    failed++;
    console.error("Suite aborted:", err);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });

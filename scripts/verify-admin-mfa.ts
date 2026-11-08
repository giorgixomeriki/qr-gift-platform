import Module from "node:module";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/**
 * Admin MFA against a real Supabase Auth server (docs/security/ADMIN_MFA.md).
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
if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) throw new Error("verify:admin-mfa runs against a local Supabase stack only");

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
const wrongCode = (secret: string) => (totp(secret) === "000000" ? "111111" : "000000");

async function caught(fn: () => Promise<unknown>): Promise<Error & { digest?: string }> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  return new Error("(did not throw)");
}
const redirectTarget = (e: Error & { digest?: string }) => e.digest?.split(";")[2] ?? `not a redirect: ${e.message}`;

const RUN = randomUUID().slice(0, 8);
const PASSWORD = `verify-${RUN}-password`;
const email = (who: string) => `${who}-${RUN}@verify.test`;
const createdUsers: string[] = [];
const created = { partnerId: randomUUID(), batchId: randomUUID(), qrId: randomUUID() };
const tempDir = mkdtempSync(join(tmpdir(), "verify-admin-mfa-"));

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

function filesUnder(dir: string, match: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p, match) : match(p) ? [p] : [];
  });
}

async function main() {
  const { decideAdminAccess } = require("../src/lib/auth/assurance") as typeof import("../src/lib/auth/assurance");
  const adminLib = require("../src/lib/auth/admin") as typeof import("../src/lib/auth/admin");
  const { getSessionAssurance } = require("../src/lib/auth/session") as typeof import("../src/lib/auth/session");
  const { createSupabaseServerClient } = require("../src/lib/supabase/server") as typeof import("../src/lib/supabase/server");
  const actions = require("../src/lib/auth/mfa-actions") as typeof import("../src/lib/auth/mfa-actions");
  const { withPartnerContext } = require("../src/db/client") as typeof import("../src/db/client");
  const { GET: qrAsset } = require("../src/app/api/qr/[qrCodeId]/route") as typeof import("../src/app/api/qr/[qrCodeId]/route");
  const { GET: batchExport } = require("../src/app/api/qr/batches/[batchId]/export/route") as typeof import("../src/app/api/qr/batches/[batchId]/export/route");
  const printPage = (require("../src/app/print/batch/[batchId]/page") as typeof import("../src/app/print/batch/[batchId]/page")).default;

  async function signIn(who: string, jar = new Jar()): Promise<Jar> {
    currentJar = jar;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email(who), password: PASSWORD });
    if (error) throw error;
    await sleep(30); // @supabase/ssr flushes cookies on the auth-state event
    return jar;
  }
  const requireOk = () => adminLib.requireAdmin(async (_tx, id) => id);
  const access = async (jar: Jar) => {
    currentJar = jar;
    return (await adminLib.getAdminAccess()).access;
  };
  const qr = () => qrAsset(new NextRequest(`http://local.test/api/qr/${created.qrId}`), { params: Promise.resolve({ qrCodeId: created.qrId }) });
  const exportCsv = () => batchExport(new Request("http://local.test/x"), { params: Promise.resolve({ batchId: created.batchId }) });
  const print = () => printPage({ params: Promise.resolve({ batchId: created.batchId }) });

  console.log("\n--- 1. Decision table ---");
  const d = (signedIn: boolean, isAdmin: boolean, aal: "aal1" | "aal2" | null, hasVerifiedFactor: boolean) => decideAdminAccess({ signedIn, isAdmin, aal, hasVerifiedFactor });
  check("1a. no session → ANONYMOUS", d(false, false, null, false) === "ANONYMOUS");
  check("1b. non-admin, even aal2 → NOT_ADMIN", d(true, false, "aal2", true) === "NOT_ADMIN");
  check("1c. admin, aal1, no factor → MFA_ENROLL", d(true, true, "aal1", false) === "MFA_ENROLL");
  check("1d. admin, aal1, factor → MFA_CHALLENGE", d(true, true, "aal1", true) === "MFA_CHALLENGE");
  check("1e. admin, unknown aal, factor → MFA_CHALLENGE", d(true, true, null, true) === "MFA_CHALLENGE");
  check("1f. admin, aal2, factor → GRANTED", d(true, true, "aal2", true) === "GRANTED");
  check("1g. admin, aal2, factor since removed → MFA_ENROLL", d(true, true, "aal2", false) === "MFA_ENROLL");

  console.log("\nSetting up fixtures...");
  const adminId = await createUser("admin");
  const partnerUserId = await createUser("partner");
  const limitedId = await createUser("limited");
  await pg`insert into admin_users (user_id) values (${adminId}), (${limitedId})`;
  await pg`insert into partners (id, slug, name, commission_rate_bps, status) values (${created.partnerId}, ${`verify-mfa-${RUN}`}, 'Verify MFA', 3000, 'ACTIVE')`;
  await pg`insert into partner_members (partner_id, user_id, role) values (${created.partnerId}, ${partnerUserId}, 'OWNER')`;
  await pg`insert into qr_batches (id, partner_id, label, quantity) values (${created.batchId}, ${created.partnerId}, 'verify-mfa', 1)`;
  await pg`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${created.qrId}, ${`VMFA${RUN.toUpperCase()}`}, ${created.batchId}, ${created.partnerId}, 'AVAILABLE')`;

  console.log("\n--- 2. No session ---");
  currentJar = new Jar();
  check("2a. requireAdmin refuses", (await caught(requireOk)).message === "Not signed in");
  check("2b. admin page redirects to login", redirectTarget(await caught(adminLib.requireAdminPage)).endsWith("/admin/login"));
  check("2c. QR asset 401", (await qr()).status === 401);
  check("2d. batch export 401", (await exportCsv()).status === 401);

  console.log("\n--- 3. Partner accounts cannot gain admin ---");
  const partnerJar = await signIn("partner");
  check("3a. partner owner is NOT_ADMIN", (await access(partnerJar)) === "NOT_ADMIN");
  check("3b. requireAdmin says not an admin (no MFA path offered)", (await caught(requireOk)).message === "Not an admin");
  check("3c. cannot start MFA enrollment", (await actions.startMfaEnrollmentAction()).ok === false);
  check("3d. admin page renders NotAdmin", (await adminLib.requireAdminPage()).isAdmin === false);
  check("3e. own QR asset still works (partner flow unchanged)", (await qr()).status === 200);
  const rlsInsert = await caught(() => withPartnerContext(partnerUserId, created.partnerId, (tx) => tx.execute(`insert into admin_users (user_id) values ('${partnerUserId}')`)));
  check("3f. database refuses a partner writing admin_users", /denied|violates row-level/i.test(`${rlsInsert.message} ${(rlsInsert as { cause?: Error }).cause?.message ?? ""}`), rlsInsert.message);
  const cliPartner = adminAccessCli(["onboard", "--email", email("partner"), "--apply"]);
  check("3g. operator tool refuses to promote a partner", !cliPartner.ok && /partner/.test(cliPartner.out), cliPartner.out);
  check("3h. …and no admin row appeared", (await pg`select 1 from admin_users where user_id = ${partnerUserId}`).length === 0);

  console.log("\n--- 4. Admin with a password only ---");
  const firstJar = await signIn("admin");
  check("4a. state is MFA_ENROLL", (await access(firstJar)) === "MFA_ENROLL");
  check("4b. requireAdmin refuses with MfaRequiredError", (await caught(requireOk)).name === "MfaRequiredError");
  check("4c. admin page redirects to setup", redirectTarget(await caught(adminLib.requireAdminPage)).endsWith("/admin/mfa/setup"));
  check("4d. QR asset refused (403), RLS not reached", (await qr()).status === 403);
  check("4e. batch export refused (403)", (await exportCsv()).status === 403);
  check("4f. print sheet redirects to MFA", redirectTarget(await caught(print)).endsWith("/admin/mfa"));

  console.log("\n--- 5. Enrollment ---");
  const enrollment = await actions.startMfaEnrollmentAction();
  if (!enrollment.ok) throw new Error(`enrollment failed: ${enrollment.error}`);
  check("5a. QR and secret come from Supabase", enrollment.qrCode.startsWith("data:image/svg") && enrollment.secret.length >= 16);
  const retry = await actions.startMfaEnrollmentAction();
  if (!retry.ok) throw new Error("second enrollment failed");
  const { data: mid } = await authAdmin.auth.admin.mfa.listFactors({ userId: adminId });
  check("5b. an abandoned attempt is replaced, not accumulated", mid?.factors.length === 1 && mid.factors[0]!.id === retry.factorId, mid?.factors.length);
  const bad = await actions.confirmMfaEnrollmentAction(retry.factorId, wrongCode(retry.secret));
  check("5c. wrong code refused", !bad.ok && bad.error === "INVALID_CODE", bad);
  check("5d. …still MFA_ENROLL", (await access(firstJar)) === "MFA_ENROLL");
  const good = await actions.confirmMfaEnrollmentAction(retry.factorId, totp(retry.secret));
  check("5e. correct code accepted", good.ok, good);
  await sleep(30);
  check("5f. session is now aal2 and GRANTED", (await access(firstJar)) === "GRANTED");
  check("5g. requireAdmin passes", (await requireOk()) === adminId);
  check("5h. admin page allowed", (await adminLib.requireAdminPage()).isAdmin === true);
  check("5i. QR asset 200", (await qr()).status === 200);
  check("5j. batch export 200", (await exportCsv()).status === 200);
  check("5k. print sheet renders", (await print()) != null);
  check("5l. enrollment audited", (await pg`select 1 from audit_logs where actor_id = ${adminId} and action = 'ADMIN_MFA_ENROLLED'`).length === 1);

  console.log("\n--- 6. Next sign-in: password alone is not enough ---");
  const secondJar = await signIn("admin");
  check("6a. new session is MFA_CHALLENGE", (await access(secondJar)) === "MFA_CHALLENGE");
  check("6b. requireAdmin refuses", (await caught(requireOk)).name === "MfaRequiredError");
  check("6c. admin page redirects to the challenge", redirectTarget(await caught(adminLib.requireAdminPage)).endsWith("/admin/mfa"));
  check("6d. QR asset refused", (await qr()).status === 403);
  const stolen = await actions.startMfaEnrollmentAction();
  check("6e. a stolen password cannot register another device", !stolen.ok && stolen.error === "FORBIDDEN", stolen);
  const direct = await (await createSupabaseServerClient()).auth.mfa.enroll({ factorType: "totp", friendlyName: "attacker" });
  check("6f. …not by calling Supabase directly either", direct.error !== null);
  const directDrop = await (await createSupabaseServerClient()).auth.mfa.unenroll({ factorId: retry.factorId });
  check("6g. aal1 cannot remove a factor directly", directDrop.error !== null);
  check("6h. aal1 cannot use the remove action", !(await actions.removeMfaFactorAction(retry.factorId)).ok);
  const wrongFactor = await actions.verifyMfaChallengeAction(randomUUID(), totp(retry.secret));
  check("6i. a factor that isn't yours is refused", !wrongFactor.ok && wrongFactor.error === "FORBIDDEN", wrongFactor);
  check("6j. malformed code refused", !(await actions.verifyMfaChallengeAction(retry.factorId, "12ab56")).ok);
  const badChallenge = await actions.verifyMfaChallengeAction(retry.factorId, wrongCode(retry.secret));
  check("6k. wrong code refused and audited", !badChallenge.ok && (await pg`select 1 from audit_logs where actor_id = ${adminId} and action = 'ADMIN_MFA_VERIFY_FAILED'`).length === 2);
  check("6l. still MFA_CHALLENGE", (await access(secondJar)) === "MFA_CHALLENGE");
  // A code from the previous step, so it isn't the one 5e just consumed.
  const passedChallenge = await actions.verifyMfaChallengeAction(retry.factorId, totp(retry.secret, 1));
  check("6m. correct code → GRANTED", passedChallenge.ok && (await sleep(30), await access(secondJar)) === "GRANTED", passedChallenge);

  console.log("\n--- 7. Tampered and downgraded sessions ---");
  const forgedJar = await signIn("admin");
  const [chunkName] = forgedJar.getAll().filter((c) => c.name.includes("auth-token")).map((c) => c.name);
  const raw = forgedJar.get(chunkName!)!.value;
  const session = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8"));
  const [h, p, s] = session.access_token.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  claims.aal = "aal2";
  session.access_token = `${h}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${s}`;
  forgedJar.set(chunkName!, `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`);
  check("7a. an edited cookie claiming aal2 does not get in", (await access(forgedJar)) !== "GRANTED", await access(forgedJar));
  currentJar = secondJar;
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  check("7b. the stack signs asymmetrically, as production does", header.alg === "ES256", header.alg);

  const { data: link } = await authAdmin.auth.admin.generateLink({ type: "recovery", email: email("admin") });
  const recoveryJar = new Jar();
  currentJar = recoveryJar;
  const recovered = await (await createSupabaseServerClient()).auth.verifyOtp({ type: "recovery", token_hash: link.properties!.hashed_token });
  await sleep(30);
  check("7c. a password-reset link is a valid sign-in", recovered.error === null, recovered.error?.message);
  check("7d. …but cannot skip MFA", (await access(recoveryJar)) === "MFA_CHALLENGE", await access(recoveryJar));

  console.log("\n--- 8. Backup authenticator ---");
  currentJar = secondJar;
  const backup = await actions.startMfaEnrollmentAction();
  if (!backup.ok) throw new Error(`backup enrollment failed: ${backup.error}`);
  check("8a. a backup can be added at aal2", (await actions.confirmMfaEnrollmentAction(backup.factorId, totp(backup.secret))).ok);
  await sleep(30);
  const factorsAfter = (await getSessionAssurance())!.factors;
  check("8b. two verified factors", factorsAfter.length === 2, factorsAfter.length);
  const removed = await actions.removeMfaFactorAction(retry.factorId);
  check("8c. a lost device can be removed", removed.ok, removed);
  await sleep(30);
  const afterRemoval = await signIn("admin");
  const remainingFactors = (await adminLib.getAdminAccess()).factors;
  const signInWithBackup = await actions.verifyMfaChallengeAction(backup.factorId, totp(backup.secret, -1));
  check("8d. the backup signs in", signInWithBackup.ok && remainingFactors.length === 1, signInWithBackup);
  await sleep(30);
  check("8e. …reaching GRANTED", (await access(afterRemoval)) === "GRANTED");
  const lastOne = await actions.removeMfaFactorAction(backup.factorId);
  check("8f. the last factor cannot be removed", !lastOne.ok && lastOne.error === "LAST_FACTOR", lastOne);

  console.log("\n--- 9. Rate limit ---");
  const limitedJar = await signIn("limited");
  currentJar = limitedJar;
  const lim = await actions.startMfaEnrollmentAction();
  if (!lim.ok) throw new Error("limited enrollment failed");
  let last: Awaited<ReturnType<typeof actions.confirmMfaEnrollmentAction>> = { ok: true };
  for (let i = 0; i < 11; i++) last = await actions.confirmMfaEnrollmentAction(lim.factorId, wrongCode(lim.secret));
  check("9a. the 11th attempt in the window is rate limited", !last.ok && last.error === "RATE_LIMITED", last);

  console.log("\n--- 10. Owner onboarding ---");
  const credFile = join(tempDir, "owner.txt");
  check("10a. wrong project host is refused", !adminAccessCli(["status"]).out.includes("Refused") && (() => {
    try {
      execFileSync("./node_modules/.bin/tsx", ["scripts/ops/admin-access.ts", "status", "--expect-host", "db.example.supabase.co"], { stdio: "pipe", env: process.env });
      return false;
    } catch {
      return true;
    }
  })());
  const ownerEmail = email("owner");
  const dry = adminAccessCli(["onboard", "--email", ownerEmail, "--credential-file", credFile]);
  check("10b. dry run changes nothing", dry.ok && /dry run/.test(dry.out) && (await pg`select 1 from auth.users where email = ${ownerEmail}`).length === 0, dry.out);
  const applied = adminAccessCli(["onboard", "--email", ownerEmail, "--credential-file", credFile, "--apply"]);
  const [ownerRow] = await pg<{ id: string }[]>`select id from auth.users where email = ${ownerEmail}`;
  if (ownerRow) createdUsers.push(ownerRow.id);
  check("10c. creates the account and the admin row", applied.ok && !!ownerRow && (await pg`select 1 from admin_users where user_id = ${ownerRow.id}`).length === 1, applied.out);
  const credential = readFileSync(credFile, "utf8").trim().split("\n");
  check("10d. temporary password is mode 0600 and never printed", (statSync(credFile).mode & 0o777) === 0o600 && !applied.out.includes(credential[1]!));
  currentJar = new Jar();
  const ownerClient = await createSupabaseServerClient();
  const ownerLogin = await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: credential[1]! });
  await sleep(30);
  check("10e. owner signs in and must enroll", ownerLogin.error === null && (await adminLib.getAdminAccess()).access === "MFA_ENROLL");
  const noClobber = adminAccessCli(["reset-mfa", "--email", ownerEmail, "--reason", "t", "--credential-file", credFile, "--apply"]);
  check("10f. an existing credential file is never overwritten", !noClobber.ok, noClobber.out);
  const repeat = adminAccessCli(["onboard", "--email", ownerEmail, "--apply"]);
  check("10g. onboarding again is a no-op", repeat.ok && /already an admin/.test(repeat.out), repeat.out);
  check("10h. audited", (await pg`select 1 from audit_logs where target_id = ${ownerRow!.id} and action = 'ADMIN_ONBOARDED'`).length === 1);

  console.log("\n--- 11. Owner recovery (lost authenticators) ---");
  const stuckJar = await signIn("admin");
  const dryReset = adminAccessCli(["reset-mfa", "--email", email("admin"), "--reason", "lost phone"]);
  const { data: before } = await authAdmin.auth.admin.mfa.listFactors({ userId: adminId });
  check("11a. dry run removes nothing", dryReset.ok && before?.factors.length === 1, dryReset.out);
  check("11b. a reason is mandatory", !adminAccessCli(["reset-mfa", "--email", email("admin"), "--apply"]).ok);
  check("11c. a non-admin cannot be reset", !adminAccessCli(["reset-mfa", "--email", email("partner"), "--reason", "x", "--apply"]).ok);
  const reset = adminAccessCli(["reset-mfa", "--email", email("admin"), "--reason", "lost phone", "--apply"]);
  const { data: afterReset } = await authAdmin.auth.admin.mfa.listFactors({ userId: adminId });
  check("11d. removes every factor", reset.ok && afterReset?.factors.length === 0, reset.out);
  check("11e. ends every existing session", (await access(stuckJar)) === "ANONYMOUS", await access(stuckJar));
  const recoveredJar = await signIn("admin");
  check("11f. sign-in requires enrolling again", (await access(recoveredJar)) === "MFA_ENROLL");
  currentJar = recoveredJar;
  const again = await actions.startMfaEnrollmentAction();
  if (!again.ok) throw new Error("re-enroll failed");
  check("11g. owner is back in after re-enrolling", (await actions.confirmMfaEnrollmentAction(again.factorId, totp(again.secret))).ok && (await sleep(30), await access(recoveredJar)) === "GRANTED");
  check("11h. reset is audited with its reason", (await pg`select 1 from audit_logs where target_id = ${adminId} and action = 'ADMIN_MFA_RESET' and metadata->>'reason' = 'lost phone'`).length === 1);

  console.log("\n--- 12. Revocation ---");
  const revokedJar = await signIn("limited");
  const others = await pg<{ user_id: string }[]>`select user_id from admin_users where user_id <> ${limitedId}`;
  await pg`delete from admin_users where user_id <> ${limitedId}`;
  let lastAdmin;
  try {
    lastAdmin = adminAccessCli(["revoke", "--email", email("limited"), "--reason", "t", "--apply"]);
  } finally {
    for (const o of others) await pg`insert into admin_users (user_id) values (${o.user_id})`;
  }
  check("12a. the last admin can never be removed", !lastAdmin.ok && /last admin/.test(lastAdmin.out), lastAdmin.out);
  const revoked = adminAccessCli(["revoke", "--email", email("limited"), "--reason", "demo account retired", "--apply"]);
  check("12b. revoke removes admin access", revoked.ok && (await pg`select 1 from admin_users where user_id = ${limitedId}`).length === 0, revoked.out);
  check("12c. and ends its sessions", (await access(revokedJar)) === "ANONYMOUS");

  console.log("\n--- 13. No privileged path skips the guard ---");
  const root = process.cwd();
  const pages = filesUnder(join(root, "src/app/(admin)/admin"), (p) => p.endsWith("page.tsx")).map((p) => relative(root, p));
  const exempt = /\/admin\/(login|forgot-password|mfa(\/setup)?)\/page\.tsx$/;
  const unguarded = pages.filter((p) => !exempt.test(p) && !readFileSync(p, "utf8").includes("requireAdminPage()"));
  check(`13a. all ${pages.length - pages.filter((p) => exempt.test(p)).length} protected admin pages use requireAdminPage`, unguarded.length === 0, unguarded);
  const source = filesUnder(join(root, "src"), (p) => /\.tsx?$/.test(p)).map((p) => relative(root, p));
  const checkers = source.filter((p) => p !== "src/db/client.ts" && p !== "src/lib/auth/admin.ts" && /\bcheckIsAdmin\(/.test(readFileSync(p, "utf8")));
  check("13b. only the guard calls checkIsAdmin", checkers.length === 0, checkers);
  const allowedAdminContext = new Set(["src/db/client.ts", "src/lib/auth/admin.ts", "src/lib/auth/mfa-actions.ts", "src/lib/payments/service.ts", "src/lib/payments/reconcile.ts", "src/lib/payments/dispute-evidence.ts", "src/lib/payments/refunds.ts"]);
  const contexts = source.filter((p) => !allowedAdminContext.has(p) && /\bwithAdmin(Payment)?Context\(/.test(readFileSync(p, "utf8")));
  check("13c. admin DB context only where reviewed", contexts.length === 0, contexts);
  const actionFiles = source.filter((p) => /actions\.ts$/.test(p));
  const grants = source.filter((p) => /insert\s+into\s+admin_users|insert\(adminUsers\)/i.test(readFileSync(p, "utf8")) && p !== "src/db/dev-bootstrap.ts");
  check(`13d. nothing in the app can grant admin (${actionFiles.length} action files scanned)`, grants.length === 0, grants);
}

async function cleanup() {
  await pg`delete from audit_logs where actor_id = any(${createdUsers}::uuid[]) or target_id = any(${createdUsers}::text[])`.catch(() => {});
  await pg`delete from audit_logs where target_id in (${created.qrId}, ${created.batchId})`.catch(() => {});
  await pg`delete from admin_users where user_id = any(${createdUsers}::uuid[])`.catch(() => {});
  await pg`delete from qr_codes where id = ${created.qrId}`.catch(() => {});
  await pg`delete from qr_batches where id = ${created.batchId}`.catch(() => {});
  await pg`delete from partner_members where partner_id = ${created.partnerId}`.catch(() => {});
  await pg`delete from partners where id = ${created.partnerId}`.catch(() => {});
  for (const id of createdUsers) await authAdmin.auth.admin.deleteUser(id).catch(() => {});
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

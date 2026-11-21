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

/**
 * Partner login access (migrations/0025, lib/partners/login-access.ts):
 * contact rules, invitation lifecycle, verified claiming, one-login rules,
 * recovery, revocation, rate limits, RLS isolation and per-QR results.
 *
 * The email path runs against the real local Supabase Auth server. The SMS
 * path uses a stand-in for Supabase's send/verify (no SMS provider exists
 * locally); everything around it — eligibility, limits, claiming — is real.
 */
const postgres = require("postgres") as typeof import("postgres");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const { resolvePublishableKey } = require("../src/lib/supabase/keys") as typeof import("../src/lib/supabase/keys");
const contact = require("../src/lib/partners/contact") as typeof import("../src/lib/partners/contact");
const access = require("../src/lib/partners/login-access") as typeof import("../src/lib/partners/login-access");
const { createSupabaseAuthDirectory } = require("../src/lib/auth/auth-directory") as typeof import("../src/lib/auth/auth-directory");
const { partnerAuthConfigProblems } = require("../src/lib/env-guards") as typeof import("../src/lib/env-guards");
const { withAdminContext, withPartnerContext, getPartnerRole, db } = require("../src/db/client") as typeof import("../src/db/client");
const { setPartnerStatus, createPartner } = require("../src/lib/partners/service") as typeof import("../src/lib/partners/service");
const { getQrResults } = require("../src/lib/dashboard/attribution") as typeof import("../src/lib/dashboard/attribution");
const { getPartnerMetrics } = require("../src/lib/dashboard/partner-metrics") as typeof import("../src/lib/dashboard/partner-metrics");
const { generateEditToken, hashEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startCheckout, confirmPaymentSuccess, activatePaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { partners: partnersTable } = require("../src/db/schema") as typeof import("../src/db/schema");
const { sql: dsql } = require("drizzle-orm") as typeof import("drizzle-orm");

type AuthDirectory = import("../src/lib/auth/auth-directory").AuthDirectory;
type AuthUserSummary = import("../src/lib/auth/auth-directory").AuthUserSummary;

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = resolvePublishableKey(process.env)?.key;
if (!migrationsUrl || !supabaseUrl || !publishable) throw new Error("MIGRATIONS_DATABASE_URL and Supabase env vars are required");
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
    console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}
async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (err) {
    if (err instanceof access.LoginAccessError) return err.code;
    if (err instanceof Error && err.name === "RateLimitedError") return "rate_limited";
    const cause = (err as { cause?: { message?: string } })?.cause?.message;
    return err instanceof Error ? `${err.name}:${err.message}${cause ? ` [${cause}]` : ""}` : String(err);
  }
}
async function throws(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

const directory = createSupabaseAuthDirectory();
const createdUsers: string[] = [];
const createdPartners: string[] = [];
const adminUserId = randomUUID();
let ipCounter = 0;
const freshIp = () => `10.${RUN.charCodeAt(0) % 200}.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
let phoneCounter = 0;
const phoneBase = 500000 + (parseInt(RUN.slice(0, 4), 16) % 400000);
const freshPhone = () => `+9955${String(phoneBase + ++phoneCounter * 7).padStart(8, "0").slice(-8)}`;

async function makePartner(label: string, contacts: { email?: string; phone?: string }) {
  const p = await withAdminContext(adminUserId, (tx) =>
    createPartner(tx, adminUserId, {
      slug: `pa-${label}-${RUN}`,
      name: `Partner Auth ${label} ${RUN}`,
      defaultLocale: "ka",
      country: "GE",
      currency: "GEL",
      commissionRateBps: 3000,
      contactEmail: contacts.email,
      contactPhone: contacts.phone,
    }),
  );
  createdPartners.push(p.id);
  return p;
}

function issueDeps(outbox: { to: string; link: string; purpose: string }[], over: Partial<import("../src/lib/partners/login-access").IssueDeps> = {}) {
  return {
    directory,
    sendLinkEmail: async (m: { to: string; link: string; purpose: "ACTIVATION" | "RECOVERY" }) => {
      outbox.push({ to: m.to, link: m.link, purpose: m.purpose });
    },
    emailConfigured: true,
    phoneEnabled: true,
    appUrl: "https://qrapp.test",
    ttlHours: 72,
    ...over,
  };
}
const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

async function signInWorks(email: string, password: string): Promise<boolean> {
  const client = createClient(supabaseUrl!, publishable!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return !error && Boolean(data.session);
}

function activateDeps(signIns: string[]) {
  return { directory, signIn: async (email: string) => void signIns.push(email) };
}

/** In-memory stand-in for Supabase's phone accounts + SMS send/verify. */
class FakePhoneAuth implements AuthDirectory {
  users = new Map<string, AuthUserSummary>();
  sent: string[] = [];
  signOuts = 0;
  othersEnded = 0;
  async findByEmail() {
    return null;
  }
  async findByPhone(phone: string) {
    return [...this.users.values()].find((u) => u.phone === phone) ?? null;
  }
  async getById(id: string) {
    return this.users.get(id) ?? null;
  }
  async createEmailUser(): Promise<AuthUserSummary> {
    throw new Error("not used");
  }
  async createPhoneUser(phone: string) {
    const u: AuthUserSummary = { id: randomUUID(), email: null, emailConfirmed: false, phone, phoneConfirmed: false, banned: false, lastSignInAt: null };
    this.users.set(u.id, u);
    return u;
  }
  async setPassword() {}
  async setBanned(id: string, banned: boolean) {
    const u = this.users.get(id);
    if (u) u.banned = banned;
  }
  async deleteUser(id: string) {
    this.users.delete(id);
  }
  deps(over: Partial<import("../src/lib/partners/login-access").PhoneDeps> = {}) {
    return {
      directory: this,
      phoneEnabled: true,
      sendOtp: async (phone: string) => void this.sent.push(phone),
      verifyOtp: async (phone: string, code: string) => {
        const u = await this.findByPhone(phone);
        if (!u || code !== "246810" || !this.sent.includes(phone)) return null;
        u.phoneConfirmed = true;
        return { userId: u.id };
      },
      signOut: async () => void this.signOuts++,
      endOtherSessions: async () => void this.othersEnded++,
      isAdmin: async (id: string) => this.admins.has(id),
      log: () => {},
      ...over,
    };
  }
  admins = new Set<string>();
}

async function main() {
  await admin`insert into admin_users (user_id) values (${adminUserId})`;

  console.log("--- 1. Contact rules (lib/partners/contact.ts) ---");
  const n = contact.normalizeGeorgianMobile;
  check("1a. local, spaced, +995, 995, 00995 forms normalize", ["555 12 34 56", "+995 555-123-456", "995555123456", "00995 555 123456", "(555) 12-34-56"].every((v) => n(v) === (v.includes("123456") ? "+995555123456" : "+995555123456")), ["555 12 34 56", "+995 555-123-456"].map(n));
  check("1b. landline, short, foreign, letters refused", [n("+995 32 212 34 56"), n("55512345"), n("+1 555 123 4567"), n("5551234ab"), n("")].every((v) => v === null));
  check("1c. email lowercased and validated", contact.normalizeEmail("  Shop@Example.GE ") === "shop@example.ge" && contact.normalizeEmail("not-an-email") === null);
  check("1d. masks hide most of the contact", contact.maskPhone("+995555123456") === "+995 5•• ••• •56" && contact.maskEmail("giorgi@example.ge") === "g•••@example.ge");
  check("1e. at least one contact required; email optional", (await errorCode(async () => access.parseContacts({}))) === "contact_required" && access.parseContacts({ phone: "555123456" }).email === null);
  check("1f. bad email / phone named precisely", (await errorCode(async () => access.parseContacts({ email: "x@" }))) === "invalid_email" && (await errorCode(async () => access.parseContacts({ phone: "032 2 12" }))) === "invalid_phone");
  const tk = access.newActivationToken();
  check("1g. token is 256-bit base64url, stored only as SHA-256", access.isWellFormedToken(tk.token) && tk.tokenHash === access.hashActivationToken(tk.token) && /^[0-9a-f]{64}$/.test(tk.tokenHash) && !access.isWellFormedToken(`${tk.token}x`));

  console.log("\n--- 2. Configuration guards (lib/env-guards.ts) ---");
  check("2a. log email transport refused when hosted", partnerAuthConfigProblems({ hosted: true, emailTransport: "log", phoneEnabled: false }).length === 1);
  check("2b. resend needs key and sender", partnerAuthConfigProblems({ hosted: true, emailTransport: "resend", phoneEnabled: false }).length === 2);
  check("2c. hosted phone sign-in needs a named real SMS provider", partnerAuthConfigProblems({ hosted: true, phoneEnabled: true }).length === 1 && partnerAuthConfigProblems({ hosted: true, phoneEnabled: true, smsProvider: "twilio" }).length === 0);
  check("2d. local dev may use log transport", partnerAuthConfigProblems({ hosted: false, emailTransport: "log", phoneEnabled: true }).length === 0);

  console.log("\n--- 3. Database constraints and RLS (migrations/0025) ---");
  const emailA = `pa-a-${RUN}@verify.test`;
  const A = await makePartner("a", { email: emailA });
  const phoneOnly = await makePartner("phone", { phone: freshPhone() });
  check("3a. partner created with email only / phone only", A.contactEmail === emailA && A.contactPhone === null && phoneOnly.contactEmail === null && phoneOnly.contactPhone !== null);
  check("3b. creating a partner without any contact is refused", (await errorCode(() => makePartner("none", {}))) === "contact_required");
  check("3c. a contact can't belong to two partners", (await errorCode(() => makePartner("dup", { email: emailA.toUpperCase() }))) === "contact_in_use");
  check("3d. DB refuses a non-Georgian phone / un-normalized email", (await throws(() => admin`update partners set contact_phone = '+15551234567' where id = ${A.id}`)) && (await throws(() => admin`update partners set contact_email = 'Up@Case.ge' where id = ${A.id}`)));
  const badInv = (cols: string) => admin.unsafe(`insert into partner_invitations (partner_id, channel, contact, token_hash, expires_at, created_by) values ('${A.id}', ${cols}, '${adminUserId}')`);
  check("3e. EMAIL invitation must carry a token hash; PHONE must not", (await throws(() => badInv(`'EMAIL', '${emailA}', null, now() + interval '1 day'`))) && (await throws(() => badInv(`'PHONE', '+995555000001', '${"a".repeat(64)}', now() + interval '1 day'`))));
  check("3f. an invitation can't live longer than 7 days", await throws(() => badInv(`'EMAIL', '${emailA}', '${"b".repeat(64)}', now() + interval '8 days'`)));
  const anonGrants = (await admin`select count(*)::int as n from information_schema.role_table_grants where table_name = 'partner_invitations' and grantee in ('anon','authenticated','service_role')`)[0]!.n as number;
  check("3g. invitations not exposed to the Data API roles", anonGrants === 0, anonGrants);
  const strangerId = randomUUID();
  const partnerSees = await withPartnerContext(strangerId, A.id, (tx) => tx.execute(dsql`select count(*)::int as n from partner_invitations`));
  check("3h. a non-admin context reads no invitations", Number(partnerSees[0]!.n) === 0);
  check(
    "3i. a non-admin context can't write an invitation",
    await throws(() => withPartnerContext(strangerId, A.id, (tx) => tx.execute(dsql`insert into partner_invitations (partner_id, channel, contact, token_hash, expires_at, created_by) values (${A.id}, 'EMAIL', ${emailA}, ${"c".repeat(64)}, now() + interval '1 day', ${strangerId})`))),
  );

  console.log("\n--- 4. Email activation (real local Supabase Auth) ---");
  const outbox: { to: string; link: string; purpose: string }[] = [];
  check("4a. no email transport -> refused before anything is stored", (await errorCode(() => withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, A.id, "EMAIL", issueDeps(outbox, { emailConfigured: false }))))) === "email_not_configured");
  check("4b. phone channel with no phone on the partner -> no_contact", (await errorCode(() => withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, A.id, "PHONE", issueDeps(outbox))))) === "no_contact");
  const first = await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, A.id, "EMAIL", issueDeps(outbox)));
  const firstToken = tokenOf(outbox.at(-1)!.link);
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, A.id, "EMAIL", issueDeps(outbox)));
  const token = tokenOf(outbox.at(-1)!.link);
  check("4c. link emailed to the partner's address", outbox.at(-1)!.to === emailA && outbox.at(-1)!.link.startsWith("https://qrapp.test/partner/activate?token="));
  const stored = await admin`select status, token_hash from partner_invitations where partner_id = ${A.id} order by created_at`;
  check("4d. only the hash is stored; reissuing revoked the first link", stored.length === 2 && stored[0]!.status === "REVOKED" && stored[1]!.status === "PENDING" && stored.every((r) => r.token_hash !== token && r.token_hash !== firstToken) && stored[1]!.token_hash === access.hashActivationToken(token));
  check("4e. expires ~72 h after issue", Math.abs(first.expiresAt.getTime() - Date.now() - 72 * 3600_000) < 60_000);
  check("4f. revoked link previews as invalid", (await access.previewLink(firstToken)).state === "invalid");
  const pv = await access.previewLink(token);
  check("4g. valid link shows partner name + masked email only", pv.state === "valid" && pv.partnerName === A.name && pv.maskedEmail === contact.maskEmail(emailA), pv);
  check("4h. garbage token previews as invalid", (await access.previewLink("x".repeat(43))).state === "invalid" && (await access.previewLink("../etc")).state === "invalid");
  const signIns: string[] = [];
  check("4i. short password refused", (await errorCode(() => access.activateWithEmailLink(token, "short", freshIp(), activateDeps(signIns)))) === "weak_password");
  const PW = `Pa-${RUN}-correct-horse-7`;
  check("4j. old (revoked) link can't activate", (await errorCode(() => access.activateWithEmailLink(firstToken, PW, freshIp(), activateDeps(signIns)))) === "invalid_link");
  const activated = await access.activateWithEmailLink(token, PW, freshIp(), activateDeps(signIns));
  const userA = await directory.findByEmail(emailA);
  if (userA) createdUsers.push(userA.id);
  check("4k. activation creates a confirmed login and links it as OWNER", activated.partnerId === A.id && userA?.emailConfirmed === true && (await getPartnerRole(userA!.id, A.id)) === "OWNER");
  check("4l. the chosen password signs in; session started", (await signInWorks(emailA, PW)) && signIns.at(-1) === emailA);
  check("4m. link is single-use", (await errorCode(() => access.activateWithEmailLink(token, PW, freshIp(), activateDeps(signIns)))) === "link_used" && (await access.previewLink(token)).state === "used");
  const audit = await admin`select action from audit_logs where target_id = ${A.id} order by created_at`;
  check("4n. audit trail: invited, revoked, activated", ["PARTNER_LOGIN_INVITED", "PARTNER_INVITATION_REVOKED", "PARTNER_LOGIN_ACTIVATED"].every((a) => audit.some((r) => r.action === a)), audit.map((r) => r.action));
  check("4o. a partner with a login can't be invited again", (await errorCode(() => withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, A.id, "EMAIL", issueDeps(outbox))))) === "partner_has_login");

  console.log("\n--- 5. Duplicate claims and account linking ---");
  const emailB = `pa-b-${RUN}@verify.test`;
  const B = await makePartner("b", { email: emailB });
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, B.id, "EMAIL", issueDeps(outbox)));
  const invB = (await admin`select id from partner_invitations where partner_id = ${B.id} and status = 'PENDING'`)[0]!.id as string;
  const racers = [randomUUID(), randomUUID()];
  const race = await Promise.allSettled(racers.map((uid) => db.transaction((tx) => tx.execute(dsql`select app_accept_partner_invitation(${invB}::uuid, ${uid}::uuid, ${emailB})`))));
  check("5a. two concurrent claims of one invitation: exactly one wins", race.filter((r) => r.status === "fulfilled").length === 1, race.map((r) => r.status));
  await admin`delete from partner_members where partner_id = ${B.id}`;
  await admin`update partner_invitations set status = 'REVOKED', revoked_at = now(), accepted_user_id = null, accepted_at = null where partner_id = ${B.id}`;
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, B.id, "EMAIL", issueDeps(outbox)));
  const invB2 = (await admin`select id from partner_invitations where partner_id = ${B.id} and status = 'PENDING'`)[0]!.id as string;
  check("5b. claim with a different contact than invited is refused", (await errorCode(() => db.transaction((tx) => tx.execute(dsql`select app_accept_partner_invitation(${invB2}::uuid, ${randomUUID()}::uuid, ${"other@verify.test"})`)))).includes("contact_mismatch"));
  check("5c. A's login can't also claim B (one login = one partner)", (await errorCode(() => db.transaction((tx) => tx.execute(dsql`select app_accept_partner_invitation(${invB2}::uuid, ${userA!.id}::uuid, ${emailB})`)))).includes("user_has_partner"));
  check("5d. a platform admin can't claim a partner", (await errorCode(() => db.transaction((tx) => tx.execute(dsql`select app_accept_partner_invitation(${invB2}::uuid, ${adminUserId}::uuid, ${emailB})`)))).includes("admin_account"));
  // A's linked email moved onto C: issuing for C must refuse up front.
  const C = await makePartner("c", { phone: freshPhone() });
  await withAdminContext(adminUserId, (tx) => access.setPartnerContacts(tx, adminUserId, A.id, { email: `pa-a2-${RUN}@verify.test` }));
  await withAdminContext(adminUserId, (tx) => access.setPartnerContacts(tx, adminUserId, C.id, { email: emailA, phone: C.contactPhone }));
  check("5e. inviting an email that is already another partner's login is refused", (await errorCode(() => withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, C.id, "EMAIL", issueDeps(outbox))))) === "user_has_partner");
  const adminAuth = await directory.createEmailUser(`pa-admin-${RUN}@verify.test`, `Adm-${RUN}-pw-123456`);
  createdUsers.push(adminAuth.id);
  await admin`insert into admin_users (user_id) values (${adminAuth.id})`;
  await withAdminContext(adminUserId, (tx) => access.setPartnerContacts(tx, adminUserId, C.id, { email: `pa-admin-${RUN}@verify.test` }));
  check("5f. inviting an admin's email is refused", (await errorCode(() => withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, C.id, "EMAIL", issueDeps(outbox))))) === "admin_account");
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, B.id, "EMAIL", issueDeps(outbox)));
  const tokB = tokenOf(outbox.at(-1)!.link);
  await withAdminContext(adminUserId, (tx) => access.setPartnerContacts(tx, adminUserId, B.id, { email: `pa-b2-${RUN}@verify.test` }));
  check("5g. changing the contact revokes the open link", (await access.previewLink(tokB)).state === "invalid");

  console.log("\n--- 6. Expiry, suspension, rate limits ---");
  const emailD = `pa-d-${RUN}@verify.test`;
  const D = await makePartner("d", { email: emailD });
  const expired = access.newActivationToken();
  await admin`insert into partner_invitations (partner_id, channel, contact, token_hash, expires_at, created_by, created_at) values (${D.id}, 'EMAIL', ${emailD}, ${expired.tokenHash}, now() - interval '1 minute', ${adminUserId}, now() - interval '3 days')`;
  check("6a. expired link previews and fails as expired", (await access.previewLink(expired.token)).state === "expired" && (await errorCode(() => access.activateWithEmailLink(expired.token, PW, freshIp(), activateDeps(signIns)))) === "link_expired");
  check("6b. no account was created by the expired attempt", (await directory.findByEmail(emailD)) === null);
  await admin`update partner_invitations set status = 'REVOKED', revoked_at = now() where partner_id = ${D.id}`;
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, D.id, "EMAIL", issueDeps(outbox)));
  const tokD = tokenOf(outbox.at(-1)!.link);
  await withAdminContext(adminUserId, (tx) => setPartnerStatus(tx, adminUserId, D.id, "SUSPENDED"));
  check("6c. suspended partner: link shows inactive and can't activate", (await access.previewLink(tokD)).state === "inactive" && (await errorCode(() => access.activateWithEmailLink(tokD, PW, freshIp(), activateDeps(signIns)))) === "partner_inactive");
  check("6d. suspended partner can't be invited", (await errorCode(() => withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, D.id, "EMAIL", issueDeps(outbox))))) === "partner_inactive");
  const ip = freshIp();
  const guesses: string[] = [];
  for (let i = 0; i < 11; i++) guesses.push(await errorCode(() => access.activateWithEmailLink(access.newActivationToken().token, PW, ip, activateDeps(signIns))));
  check("6e. token guessing from one IP is cut off after 10 tries", guesses.slice(0, 10).every((g) => g === "invalid_link") && guesses[10] === "rate_limited", guesses);
  const perToken: string[] = [];
  for (let i = 0; i < 6; i++) perToken.push(await errorCode(() => access.activateWithEmailLink(tokD, "short", freshIp(), activateDeps(signIns))));
  // 6c already spent one of this link's 5 attempts.
  check("6f. one link: at most 5 attempts per 15 min, across IPs", perToken.slice(0, 4).every((g) => g === "weak_password") && perToken.slice(4).every((g) => g === "rate_limited"), perToken);

  console.log("\n--- 7. Recovery and revocation ---");
  check("7a. reset for a partner without login is refused", (await errorCode(() => withAdminContext(adminUserId, (tx) => access.issueRecovery(tx, adminUserId, B.id, issueDeps(outbox))))) === "no_login");
  await withAdminContext(adminUserId, (tx) => access.setPartnerContacts(tx, adminUserId, A.id, { email: emailA }));
  await withAdminContext(adminUserId, (tx) => access.setPartnerContacts(tx, adminUserId, C.id, { phone: C.contactPhone }));
  await withAdminContext(adminUserId, (tx) => access.issueRecovery(tx, adminUserId, A.id, issueDeps(outbox)));
  const recLink = outbox.at(-1)!;
  const NEWPW = `New-${RUN}-battery-staple-8`;
  const rec = await access.previewLink(tokenOf(recLink.link));
  check("7b. reset link goes to the login's email", recLink.to === emailA && recLink.purpose === "RECOVERY" && rec.state === "valid" && rec.purpose === "RECOVERY");
  await access.activateWithEmailLink(tokenOf(recLink.link), NEWPW, freshIp(), activateDeps(signIns));
  check("7c. new password works, old one doesn't", (await signInWorks(emailA, NEWPW)) && !(await signInWorks(emailA, PW)));
  check("7d. reset link is single-use", (await errorCode(() => access.activateWithEmailLink(tokenOf(recLink.link), NEWPW, freshIp(), activateDeps(signIns)))) === "link_used");
  check("7e. membership unchanged by recovery", (await getPartnerRole(userA!.id, A.id)) === "OWNER");
  const removed = await withAdminContext(adminUserId, (tx) => access.revokeLogin(tx, adminUserId, A.id));
  const blocked = await access.blockRevokedLogins(removed, directory);
  check("7f. revoke removes the membership immediately", removed.includes(userA!.id) && (await getPartnerRole(userA!.id, A.id)) === null);
  check("7g. revoked account is blocked from signing in", blocked.includes(userA!.id) && !(await signInWorks(emailA, NEWPW)));
  check("7h. an admin account keeps working when its partner login is revoked", (await access.blockRevokedLogins([adminAuth.id], directory)).length === 0);
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, A.id, "EMAIL", issueDeps(outbox)));
  const PW3 = `Back-${RUN}-again-pw-9`;
  await access.activateWithEmailLink(tokenOf(outbox.at(-1)!.link), PW3, freshIp(), activateDeps(signIns));
  const userA2 = await directory.findByEmail(emailA);
  if (userA2) createdUsers.push(userA2.id);
  check("7i. re-invited person gets a fresh login (old account and its sessions gone)", userA2 !== null && userA2.id !== userA!.id && (await directory.getById(userA!.id)) === null && (await getPartnerRole(userA2.id, A.id)) === "OWNER" && (await signInWorks(emailA, PW3)));
  // Pre-account hijacking: someone registered the partner's email first.
  const emailE = `pa-e-${RUN}@verify.test`;
  const squatter = await directory.createEmailUser(emailE, `Squat-${RUN}-pw-0000`);
  createdUsers.push(squatter.id);
  const E = await makePartner("e", { email: emailE });
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, E.id, "EMAIL", issueDeps(outbox)));
  await access.activateWithEmailLink(tokenOf(outbox.at(-1)!.link), PW3, freshIp(), activateDeps(signIns));
  const owner = await directory.findByEmail(emailE);
  if (owner) createdUsers.push(owner.id);
  check("7j. a pre-registered account at the partner's email is replaced, not linked", owner !== null && owner.id !== squatter.id && (await getPartnerRole(squatter.id, E.id)) === null && !(await signInWorks(emailE, `Squat-${RUN}-pw-0000`)) && (await getPartnerRole(owner.id, E.id)) === "OWNER");

  console.log("\n--- 8. Phone sign-in (SMS send/verify stood in) ---");
  const fake = new FakePhoneAuth();
  const phoneP = freshPhone();
  const P = await makePartner("p", { phone: phoneP });
  check("8a. phone channel refused while phone sign-in is off", (await errorCode(() => withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, P.id, "PHONE", { ...issueDeps(outbox, { phoneEnabled: false }), directory: fake })))) === "phone_auth_disabled");
  const pInv = await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, P.id, "PHONE", { ...issueDeps(outbox), directory: fake }));
  check("8b. phone invitation stored without a token, nothing emailed", (await admin`select token_hash from partner_invitations where id = ${pInv.invitationId}`)[0]!.token_hash === null);
  const stranger = freshPhone();
  await access.requestPhoneSignInCode(stranger, freshIp(), fake.deps());
  check("8c. unknown number: no SMS, no account (same reply)", fake.sent.length === 0 && (await fake.findByPhone(stranger)) === null);
  check("8d. form disabled -> refused", (await errorCode(() => access.requestPhoneSignInCode(phoneP, freshIp(), fake.deps({ phoneEnabled: false })))) === "phone_auth_disabled");
  check("8e. non-Georgian number refused", (await errorCode(() => access.requestPhoneSignInCode("+44 7700 900123", freshIp(), fake.deps()))) === "invalid_phone");
  await access.requestPhoneSignInCode(phoneP.replace("+995", ""), freshIp(), fake.deps());
  const pUser = await fake.findByPhone(phoneP);
  check("8f. invited number: unconfirmed account created, one SMS sent", fake.sent.filter((p) => p === phoneP).length === 1 && pUser?.phoneConfirmed === false);
  check("8g. wrong code refused", (await errorCode(() => access.completePhoneSignIn(phoneP, "000000", freshIp(), fake.deps()))) === "invalid_code");
  check("8h. malformed code refused before Supabase is asked", (await errorCode(() => access.completePhoneSignIn(phoneP, "12ab", freshIp(), fake.deps()))) === "invalid_code");
  const okP = await access.completePhoneSignIn(phoneP, "246810", freshIp(), fake.deps());
  check("8i. right code claims the invitation; login is OWNER; other sessions ended", okP.partnerId === P.id && (await getPartnerRole(pUser!.id, P.id)) === "OWNER" && fake.othersEnded === 1);
  const again = await access.completePhoneSignIn(phoneP, "246810", freshIp(), fake.deps());
  check("8j. later sign-ins just sign in (no second claim)", again.partnerId === null && (await admin`select count(*)::int as n from partner_members where partner_id = ${P.id}`)[0]!.n === 1);
  const sentBefore = fake.sent.length;
  await access.requestPhoneSignInCode(phoneP, freshIp(), fake.deps());
  check("8k. a linked phone login can request codes", fake.sent.length === sentBefore + 1);
  const spam: string[] = [];
  for (let i = 0; i < 3; i++) spam.push(await errorCode(() => access.requestPhoneSignInCode(phoneP, freshIp(), fake.deps())));
  check("8l. SMS sends per number capped (3 per 15 min, across IPs)", spam.slice(0, 1).every((s) => s === "OK") && spam.slice(1).every((s) => s === "rate_limited"), spam);
  const verifySpam: string[] = [];
  for (let i = 0; i < 4; i++) verifySpam.push(await errorCode(() => access.completePhoneSignIn(phoneP, "111111", freshIp(), fake.deps())));
  check("8m. code guesses per number capped (5 per 15 min, across IPs)", verifySpam.slice(0, 2).every((s) => s === "invalid_code") && verifySpam.slice(2).every((s) => s === "rate_limited"), verifySpam);
  const ipBurst = freshIp();
  const burst: string[] = [];
  for (let i = 0; i < 11; i++) burst.push(await errorCode(() => access.requestPhoneSignInCode(freshPhone(), ipBurst, fake.deps())));
  check("8n. SMS requests per IP capped (10 per hour)", burst.slice(0, 10).every((s) => s === "OK") && burst[10] === "rate_limited", burst);

  // Session for a different phone than asked about (e.g. a swapped cookie): refused and signed out.
  const phoneQ = freshPhone();
  const Q = await makePartner("q", { phone: phoneQ });
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, Q.id, "PHONE", { ...issueDeps(outbox), directory: fake }));
  await access.requestPhoneSignInCode(phoneQ, freshIp(), fake.deps());
  const outs = fake.signOuts;
  const mismatch = await errorCode(() => access.completePhoneSignIn(phoneQ, "246810", freshIp(), fake.deps({ verifyOtp: async () => ({ userId: pUser!.id }) })));
  check("8o. verified session for another number: refused + signed out", mismatch === "contact_mismatch" && fake.signOuts === outs + 1 && (await getPartnerRole(pUser!.id, Q.id)) === null);
  const qUser = await fake.findByPhone(phoneQ);
  fake.admins.add(qUser!.id);
  const adminSent = fake.sent.length;
  await access.requestPhoneSignInCode(phoneQ, freshIp(), fake.deps());
  check("8p. an admin's number gets no partner SMS", fake.sent.length === adminSent);
  fake.admins.delete(qUser!.id);
  await withAdminContext(adminUserId, (tx) => access.revokeInvitation(tx, adminUserId, Q.id));
  check("8q. cancelled phone invitation: code no longer claims", (await errorCode(() => access.completePhoneSignIn(phoneQ, "246810", freshIp(), fake.deps()))) === "no_login");
  const removedP = await withAdminContext(adminUserId, (tx) => access.revokeLogin(tx, adminUserId, P.id));
  await access.blockRevokedLogins(removedP, fake, async () => false);
  const sentRevoked = fake.sent.length;
  await errorCode(() => access.requestPhoneSignInCode(phoneP, freshIp(), fake.deps()));
  check("8r. revoked phone login: blocked, no further SMS", (await fake.findByPhone(phoneP))!.banned && fake.sent.length === sentRevoked && (await getPartnerRole(pUser!.id, P.id)) === null);
  const phoneR = freshPhone();
  const R = await makePartner("r", { phone: phoneR });
  const oldR = await fake.createPhoneUser(phoneR);
  oldR.phoneConfirmed = true; // a recycled number's previous, verified account
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, R.id, "PHONE", { ...issueDeps(outbox), directory: fake }));
  await access.requestPhoneSignInCode(phoneR, freshIp(), fake.deps());
  const newR = await fake.findByPhone(phoneR);
  check("8s. a previously used number gets a fresh account before its first claim", newR !== null && newR.id !== oldR.id && !newR.phoneConfirmed && (await fake.getById(oldR.id)) === null);

  console.log("\n--- 9. Isolation and per-QR results ---");
  const loginA = (await directory.findByEmail(emailA))!.id; // A's current login (re-invited in 7i)
  const [product] = await admin`select id from products where key = 'PHOTO_GREETING' limit 1`;
  const [theme] = await admin`select id from themes where key = 'minimal' limit 1`;
  const batchA = randomUUID();
  const batchB = randomUUID();
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchA}, ${A.id}, ${`QA-${RUN}`}, 3), (${batchB}, ${B.id}, ${`QB-${RUN}`}, 1)`;
  const handedOver = randomUUID();
  await admin`insert into qr_codes (id, public_token, batch_id, partner_id, distribution_status) values (${handedOver}, ${generatePublicToken()}, ${batchA}, ${A.id}, 'DISTRIBUTED')`;
  await admin`insert into analytics_events (event_type, qr_code_id, partner_id) values ('QR_SCANNED', ${handedOver}, ${A.id})`;
  const soldQr = randomUUID();
  const greetingId = randomUUID();
  const editToken = generateEditToken();
  await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status, distribution_status) values (${soldQr}, ${generatePublicToken()}, ${batchA}, ${A.id}, 'DRAFT', 'DISTRIBUTED')`;
  await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values (${greetingId}, ${soldQr}, ${theme!.id}, ${product!.id}, 'DRAFT', ${hashEditToken(editToken)})`;
  await admin`insert into greeting_content (greeting_id, type, slot, text_value, status) values (${greetingId}, 'text', 0, 'hi', 'READY')`;
  const { order } = await startCheckout({ greetingId, editToken, productId: product!.id });
  const pendingRows = await withPartnerContext(loginA, A.id, (tx) => getQrResults(tx, A.id));
  check("9a. handed over + scanned card: listed, but 0 sales / 0 revenue", pendingRows.some((r) => r.qrCodeId === handedOver && r.scans === 1 && r.paidActivations === 0 && r.grossMinor === 0 && r.netCommissionMinor === 0), pendingRows);
  check("9b. an unpaid (pending) order is not revenue", !pendingRows.some((r) => r.qrCodeId === soldQr && r.grossMinor > 0));
  await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: `test_${order.grossAmountMinor}_${order.currency}_${randomUUID()}`, orderId: order.id, amountMinor: order.grossAmountMinor, currency: order.currency });
  await activatePaidOrder(order.id);
  const paidRows = await withPartnerContext(loginA, A.id, (tx) => getQrResults(tx, A.id));
  const sold = paidRows.find((r) => r.qrCodeId === soldQr);
  check("9c. confirmed payment: 1 paid activation, revenue + commission on that card", sold?.paidActivations === 1 && sold.grossMinor === order.grossAmountMinor && sold.netCommissionMinor === order.partnerCommissionMinor, sold);
  check("9d. a used card's token is masked for the partner", Boolean(sold?.label.startsWith("••••")) && sold?.status === "USED");
  const metrics = await withPartnerContext(loginA, A.id, (tx) => getPartnerMetrics(tx, A.id));
  check("9e. partner totals: handover counted as distributed, not as a sale", metrics.qrDistributed >= 2 && metrics.successfulSales === 1 && metrics.grossSalesMinor === order.grossAmountMinor);
  const cross = await withPartnerContext(loginA, B.id, (tx) => getQrResults(tx, B.id));
  const crossPartner = await withPartnerContext(loginA, B.id, (tx) => tx.select({ id: partnersTable.id }).from(partnersTable));
  check("9f. A's login sees nothing of partner B, even naming B", (await getPartnerRole(loginA, B.id)) === null && cross.length === 0 && crossPartner.every((p) => p.id !== B.id));
  const orderAttribution = await admin`select partner_id from orders where id = ${order.id}`;
  check("9g. attribution is partner + card only (no user/employee column on the order)", orderAttribution[0]!.partner_id === A.id && (await admin`select column_name from information_schema.columns where table_name = 'orders' and column_name ~ '(user|member|employee|staff)'`).length === 0);

  console.log("\n--- 10. Auth password policy and failure handling (P0 2026-11-21) ---");
  // Production Auth requires >= 12 characters; the form once allowed 10, so
  // Auth refused with weak_password and the partner saw a generic error.
  const { PASSWORD_MIN_LENGTH_PUBLIC } = await import("../src/lib/partners/login-rules");
  const probeEmail = `pa-probe-${RUN}@verify.test`;
  const probe = await errorCode(() => directory.createEmailUser(probeEmail, "x".repeat(PASSWORD_MIN_LENGTH_PUBLIC - 1)));
  // 10a/10a2 check the *stack*, not the app: they hold only on a stack set up like
  // production (GoTrue >= v2.198.0, minimum_password_length 12, letters_digits).
  // Such a stack sets VERIFY_AUTH_POLICY_PARITY=1; elsewhere (CI's default
  // stack) they are reported, not enforced. 10b-10i hold on every stack.
  const parity = process.env.VERIFY_AUTH_POLICY_PARITY === "1";
  const parityCheck = (name: string, ok: boolean, detail: unknown) =>
    parity ? check(name, ok, detail) : console.log(`  ${ok ? "PASS" : "SKIP"}  ${name}${ok ? "" : " — stack is not production-equivalent (VERIFY_AUTH_POLICY_PARITY unset)"}`);
  parityCheck("10a. the stack's Auth enforces a minimum like production (11 chars refused by Auth)", probe.includes("weak_password"), probe);
  // On a laxer stack the probe account was created: remove it before 10b reuses the address.
  if (probe === "OK") await directory.deleteUser((await directory.findByEmail(probeEmail))!.id);
  const probeOk = await directory.createEmailUser(probeEmail, `Ok1-${RUN}`.padEnd(PASSWORD_MIN_LENGTH_PUBLIC, "z"));
  createdUsers.push(probeOk.id);
  check("10b. the app's minimum is accepted by Auth (app rule >= Auth rule)", Boolean(probeOk.id));
  const lettersOnly = await errorCode(() => directory.createEmailUser(`pa-probe2-${RUN}@verify.test`, "only-letters-here"));
  parityCheck("10a2. the stack's Auth also requires a digit, like production (letters-only refused)", lettersOnly.includes("weak_password"), lettersOnly);
  if (lettersOnly === "OK") createdUsers.push((await directory.findByEmail(`pa-probe2-${RUN}@verify.test`))!.id);
  check("10c2. the app refuses letters-only and digits-only passwords too", (await errorCode(async () => access.checkPassword("only-letters-here"))) === "weak_password" && (await errorCode(async () => access.checkPassword("123456789012"))) === "weak_password" && (await errorCode(async () => access.checkPassword(`ok1-${RUN}-ok`))) === "OK");
  check("10c. the app refuses a password Auth would refuse, before calling Auth", (await errorCode(async () => access.checkPassword("y".repeat(PASSWORD_MIN_LENGTH_PUBLIC - 1)))) === "weak_password");

  const emailW = `pa-w-${RUN}@verify.test`;
  const W = await makePartner("w", { email: emailW });
  await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, W.id, "EMAIL", issueDeps(outbox)));
  const tokW = tokenOf(outbox.at(-1)!.link);
  const invStatus = async () => (await admin`select status from partner_invitations where partner_id = ${W.id} order by created_at desc limit 1`)[0]!.status as string;
  const authRefuses = { ...directory, createEmailUser: async () => { throw Object.assign(new Error("Could not create the account (weak_password)"), { code: "weak_password" }); } };
  check("10d. Auth's weak_password reaches the partner as weak_password, not a generic error", (await errorCode(() => access.activateWithEmailLink(tokW, PW, freshIp(), { directory: authRefuses, signIn: async () => {} }))) === "weak_password");
  check("10e. ...and leaves no account, no link, the invitation still PENDING", (await directory.findByEmail(emailW)) === null && (await invStatus()) === "PENDING" && (await admin`select count(*)::int n from partner_members where partner_id = ${W.id}`)[0]!.n === 0);
  const authDown = { ...directory, createEmailUser: async () => { throw new Error("Could not create the account (unexpected_failure)"); } };
  const downCode = await errorCode(() => access.activateWithEmailLink(tokW, PW, freshIp(), { directory: authDown, signIn: async () => {} }));
  check("10f. any other Auth failure stays generic, leaves nothing behind", downCode !== "weak_password" && (await directory.findByEmail(emailW)) === null && (await invStatus()) === "PENDING", downCode);
  let madeId: string | null = null;
  const dbFails = {
    ...directory,
    createEmailUser: async (email: string, password: string) => { const u = await directory.createEmailUser(email, password); madeId = u.id; return u; },
  };
  // Make the claim transaction itself fail after Auth created the user: a
  // temporary NOT VALID check blocks the membership insert for W only.
  const blocker = admin.unsafe(`verify_block_${RUN.replace(/[^a-z0-9]/gi, "").toLowerCase()}`);
  const wid = admin.unsafe(`'${W.id}'::uuid`);
  await admin`alter table partner_members add constraint ${blocker} check (partner_id <> ${wid}) not valid`;
  let dbCode: string;
  try {
    dbCode = await errorCode(() => access.activateWithEmailLink(tokW, PW, freshIp(), { directory: dbFails, signIn: async () => {} }));
  } finally {
    await admin`alter table partner_members drop constraint ${blocker}`;
  }
  check("10g. a failed DB claim after Auth created the user deletes that user; invitation stays PENDING", madeId !== null && (await directory.getById(madeId!)) === null && (await directory.findByEmail(emailW)) === null && (await invStatus()) === "PENDING", dbCode);
  const retried = await access.activateWithEmailLink(tokW, PW, freshIp(), activateDeps(signIns));
  const userW = await directory.findByEmail(emailW);
  if (userW) createdUsers.push(userW.id);
  check("10h. retry with the same link after the failures activates; exactly one login, linked as OWNER", retried.partnerId === W.id && userW !== null && (await getPartnerRole(userW.id, W.id)) === "OWNER" && (await admin`select count(*)::int n from partner_members where partner_id = ${W.id}`)[0]!.n === 1);
  check("10i. the partner signs in with the chosen password; the link is now used", (await signInWorks(emailW, PW)) && (await errorCode(() => access.activateWithEmailLink(tokW, PW, freshIp(), activateDeps(signIns)))) === "link_used");

  console.log(`\n${passed} passed, ${failed} failed`);
}

async function cleanup() {
  for (const id of createdUsers) await directory.deleteUser(id).catch(() => {});
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

import { randomBytes } from "node:crypto";
import { closeSync, constants, openSync, writeSync } from "node:fs";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { readAdminMfaPolicy } from "../../src/lib/auth/assurance";
import { resolveSecretKey } from "../../src/lib/supabase/keys";

/**
 * Operator tool for platform-admin accounts (docs/security/ADMIN_MFA.md). The
 * app has no way to grant admin; this is the only path, it runs with
 * operator credentials, and it never prints a password or factor secret.
 *
 *   status                                           list admins and their factor state
 *   onboard   --email E [--credential-file F] [--minutes M]  create or promote an owner admin, with an enrollment grant
 *   grant-enrollment --email E --reason R [--minutes M]      re-open first enrollment for an admin with no factor
 *   reset-mfa --email E --reason R --credential-file F [--minutes M]  break-glass: new password, no factors, no sessions, new grant
 *   revoke    --email E --reason R                   remove admin access (needs another admin with working MFA)
 *
 * Every command needs --expect-host <host of NEXT_PUBLIC_SUPABASE_URL>, so
 * loaded credentials can't quietly point it at the wrong project. Commands
 * that change something are dry runs unless --apply is given.
 */
class Refused extends Error {}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function required(args: string[], name: string): string {
  const v = option(args, name);
  if (!v) throw new Refused(`${name} is required`);
  return v;
}

/** Created exclusively with mode 0600, so it can neither overwrite a file nor be read by others. */
function writeTemporaryPassword(path: string, email: string, password: string) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeSync(fd, `${email}\n${password}\n`);
  } finally {
    closeSync(fd);
  }
}

const DEFAULT_GRANT_MINUTES = 30;
const MAX_GRANT_MINUTES = 120;

function grantUntil(args: string[]): string {
  const minutes = Number(option(args, "--minutes") ?? DEFAULT_GRANT_MINUTES);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_GRANT_MINUTES) throw new Refused(`--minutes must be 1-${MAX_GRANT_MINUTES}`);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !["status", "onboard", "grant-enrollment", "reset-mfa", "revoke"].includes(command)) throw new Refused("usage: status | onboard | grant-enrollment | reset-mfa | revoke");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = resolveSecretKey(process.env)?.key;
  const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
  if (!supabaseUrl || !secretKey || !migrationsUrl) throw new Refused("NEXT_PUBLIC_SUPABASE_URL, a secret key and MIGRATIONS_DATABASE_URL are required");

  const expectHost = required(args, "--expect-host");
  const actualHost = new URL(supabaseUrl).host;
  if (expectHost !== actualHost) throw new Refused(`--expect-host ${expectHost} does not match the configured project ${actualHost}`);

  const apply = args.includes("--apply");
  const supabase = createClient(supabaseUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const sql = postgres(migrationsUrl, { max: 1 });

  const say = (line: string) => console.log(`${apply || command === "status" ? "" : "[dry run] "}${line}`);

  try {
    const audit = (action: string, userId: string, metadata: Record<string, unknown>) =>
      sql`insert into audit_logs (actor_type, action, target_type, target_id, metadata)
          values ('SYSTEM', ${action}, 'admin_user', ${userId}, ${sql.json(metadata as never)})`;

    const findUser = async (email: string) => {
      const [row] = await sql<{ id: string; banned: boolean }[]>`
        select id, coalesce(banned_until > now(), false) as banned from auth.users where lower(email) = lower(${email}) and deleted_at is null`;
      return row;
    };
    const isAdmin = async (userId: string) => (await sql`select 1 from admin_users where user_id = ${userId}`).length > 0;
    const factorsOf = async (userId: string) => {
      const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId });
      if (error) throw error;
      return data.factors;
    };
    const policyOf = async (userId: string) => {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error) throw error;
      return readAdminMfaPolicy(data.user.app_metadata);
    };
    const setPolicy = async (userId: string, enrollmentUntil: string | null, factorIds: string[]) => {
      const { error } = await supabase.auth.admin.updateUserById(userId, { app_metadata: { admin_mfa: { enrollment_until: enrollmentUntil, factor_ids: factorIds } } });
      if (error) throw error;
    };
    const mfaState = async (userId: string) => {
      const [factors, policy] = await Promise.all([factorsOf(userId), policyOf(userId)]);
      const verified = factors.filter((f) => f.status === "verified");
      const authorized = verified.filter((f) => policy.factorIds.has(f.id)).length;
      return { factors, verified, authorized, unauthorized: verified.length - authorized, enrollmentAuthorized: policy.enrollmentAuthorized };
    };

    if (command === "status") {
      const admins = await sql<{ user_id: string; email: string | null }[]>`
        select a.user_id, u.email from admin_users a left join auth.users u on u.id = a.user_id order by a.created_at`;
      for (const a of admins) {
        const m = await mfaState(a.user_id);
        say(`${a.user_id}  ${a.email ?? "(no auth user)"}  authorized factors: ${m.authorized}  UNAUTHORIZED factors: ${m.unauthorized}  enrollment grant: ${m.enrollmentAuthorized ? "open" : "none"}`);
      }
      say(`${admins.length} admin(s)`);
      return;
    }

    const email = required(args, "--email");
    const user = await findUser(email);
    const credentialFile = option(args, "--credential-file");

    if (command === "onboard") {
      if (user?.banned) throw new Refused("that account is banned");
      if (user) {
        // Admin status must never be derivable from, or combined with, a partner role.
        const memberships = await sql`select 1 from partner_members where user_id = ${user.id}`;
        if (memberships.length > 0) throw new Refused("that account belongs to a partner; a partner account can never be promoted to admin");
        if (await isAdmin(user.id)) {
          say(`${user.id} is already an admin; nothing to do`);
          return;
        }
        if ((await factorsOf(user.id)).some((f) => f.status === "verified")) throw new Refused("that account already has a verified factor nobody authorized; it can't be promoted");
      } else if (!credentialFile) {
        throw new Refused("a new account needs --credential-file <path> for its temporary password");
      }

      const until = grantUntil(args);
      if (!apply) {
        say(user ? `would promote existing account ${user.id} to admin` : `would create ${email} and make it an admin`);
        return;
      }

      let userId = user?.id;
      if (!userId) {
        const password = randomBytes(24).toString("base64url");
        writeTemporaryPassword(credentialFile!, email, password);
        const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !data.user) throw error ?? new Error("user not created");
        userId = data.user.id;
      }
      await sql.begin(async (tx) => {
        await tx`insert into admin_users (user_id) values (${userId!})`;
        await tx`insert into audit_logs (actor_type, action, target_type, target_id, metadata)
                 values ('SYSTEM', 'ADMIN_ONBOARDED', 'admin_user', ${userId!}, ${tx.json({ created: !user })})`;
      });
      await setPolicy(userId, until, []);
      say(`${userId} is now an admin. MFA enrollment must be completed by ${until}.`);
      return;
    }

    if (!user) throw new Refused("no account with that email");
    if (!(await isAdmin(user.id))) throw new Refused("that account is not an admin");
    const reason = required(args, "--reason");

    if (command === "revoke") {
      const [row] = await sql<{ count: number }[]>`select count(*)::int as count from admin_users`;
      if ((row?.count ?? 0) <= 1) throw new Refused("refusing to remove the last admin; onboard a replacement first");
      const others = await sql<{ user_id: string }[]>`select user_id from admin_users where user_id <> ${user.id}`;
      const states = await Promise.all(others.map((o) => mfaState(o.user_id)));
      if (!states.some((m) => m.authorized > 0 && m.unauthorized === 0)) {
        throw new Refused("no other admin has working MFA; that admin must enroll and verify first");
      }
      if (!apply) {
        say(`would remove admin access from ${user.id}`);
        return;
      }
      await setPolicy(user.id, null, []);
      await sql`delete from admin_users where user_id = ${user.id}`;
      await sql`delete from auth.sessions where user_id = ${user.id}`;
      await audit("ADMIN_REVOKED", user.id, { reason });
      say(`${user.id} is no longer an admin and its sessions have ended`);
      return;
    }

    if (command === "grant-enrollment") {
      const m = await mfaState(user.id);
      if (m.verified.length > 0) throw new Refused("that account already has a verified factor; use reset-mfa");
      const until = grantUntil(args);
      if (!apply) {
        say(`would allow ${user.id} to enroll until ${until}`);
        return;
      }
      await setPolicy(user.id, until, []);
      await audit("ADMIN_MFA_ENROLLMENT_GRANTED", user.id, { reason, until });
      say(`${user.id} may enroll until ${until}`);
      return;
    }

    // reset-mfa. The password always rotates: otherwise whoever holds the old
    // password could use the new enrollment grant.
    const resetCredentialFile = required(args, "--credential-file");
    const until = grantUntil(args);
    const factors = await factorsOf(user.id);
    if (!apply) {
      say(`would set a new temporary password, remove ${factors.length} factor(s), end every session and allow enrollment until ${until} for ${user.id}`);
      return;
    }
    const password = randomBytes(24).toString("base64url");
    writeTemporaryPassword(resetCredentialFile, email, password);
    const { error: passwordError } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (passwordError) throw passwordError;
    for (const f of factors) {
      const { error } = await supabase.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
      if (error) throw error;
    }
    await setPolicy(user.id, until, []);
    await sql`delete from auth.sessions where user_id = ${user.id}`;
    await audit("ADMIN_MFA_RESET", user.id, { reason, factorsRemoved: factors.length, passwordRotated: true });
    say(`new temporary password written, ${factors.length} factor(s) removed, every session ended for ${user.id}. MFA enrollment must be completed by ${until}.`);
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Refused ? `Refused: ${err.message}` : `Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

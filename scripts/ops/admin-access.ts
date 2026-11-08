import { randomBytes } from "node:crypto";
import { closeSync, constants, openSync, writeSync } from "node:fs";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { resolveSecretKey } from "../../src/lib/supabase/keys";

/**
 * Operator tool for platform-admin accounts (docs/security/ADMIN_MFA.md). The
 * app has no way to grant admin; this is the only path, it runs with
 * operator credentials, and it never prints a password or factor secret.
 *
 *   status                                             list admins and their factor counts
 *   onboard   --email E [--credential-file F]          create or promote an owner admin
 *   reset-mfa --email E --reason R [--credential-file F]  break-glass: remove every factor, end every session
 *   revoke    --email E --reason R                     remove admin access (never the last admin)
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

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !["status", "onboard", "reset-mfa", "revoke"].includes(command)) throw new Refused("usage: status | onboard | reset-mfa | revoke");

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

    if (command === "status") {
      const admins = await sql<{ user_id: string; email: string | null }[]>`
        select a.user_id, u.email from admin_users a left join auth.users u on u.id = a.user_id order by a.created_at`;
      for (const a of admins) {
        const factors = await factorsOf(a.user_id);
        say(`${a.user_id}  ${a.email ?? "(no auth user)"}  verified factors: ${factors.filter((f) => f.status === "verified").length}`);
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
      } else if (!credentialFile) {
        throw new Refused("a new account needs --credential-file <path> for its temporary password");
      }

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
      say(`${userId} is now an admin. MFA enrollment is required at first sign-in.`);
      return;
    }

    if (!user) throw new Refused("no account with that email");
    if (!(await isAdmin(user.id))) throw new Refused("that account is not an admin");
    const reason = required(args, "--reason");

    if (command === "revoke") {
      const [row] = await sql<{ count: number }[]>`select count(*)::int as count from admin_users`;
      if ((row?.count ?? 0) <= 1) throw new Refused("refusing to remove the last admin; onboard a replacement first");
      if (!apply) {
        say(`would remove admin access from ${user.id}`);
        return;
      }
      await sql`delete from admin_users where user_id = ${user.id}`;
      await sql`delete from auth.sessions where user_id = ${user.id}`;
      await audit("ADMIN_REVOKED", user.id, { reason });
      say(`${user.id} is no longer an admin and its sessions have ended`);
      return;
    }

    // reset-mfa
    const factors = await factorsOf(user.id);
    if (!apply) {
      say(`would remove ${factors.length} factor(s) and end every session for ${user.id}${credentialFile ? ", and set a new temporary password" : ""}`);
      return;
    }
    if (credentialFile) {
      const password = randomBytes(24).toString("base64url");
      writeTemporaryPassword(credentialFile, email, password);
      const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
      if (error) throw error;
    }
    for (const f of factors) {
      const { error } = await supabase.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
      if (error) throw error;
    }
    await sql`delete from auth.sessions where user_id = ${user.id}`;
    await audit("ADMIN_MFA_RESET", user.id, { reason, factorsRemoved: factors.length, passwordRotated: Boolean(credentialFile) });
    say(`removed ${factors.length} factor(s) and ended every session for ${user.id}. MFA enrollment is required at next sign-in.`);
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

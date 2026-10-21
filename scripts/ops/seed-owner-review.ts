import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

/**
 * OWNER-REVIEW deployments only (docs/OWNER_REVIEW_DEPLOYMENT.md). Creates the
 * two demo logins (a Super Admin and the owner of a demo partner) on a
 * dedicated review Supabase project, with fresh random passwords written ONLY
 * to the --out file (mode 0600), never printed. Idempotent: existing users
 * keep their password unless --reset-passwords is passed.
 *
 *   MIGRATIONS_DATABASE_URL=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx tsx scripts/ops/seed-owner-review.ts --confirm-ref=<project-ref> --out=<file>
 *
 * Never run against a production project that holds real customers.
 */
const ADMIN_EMAIL = "demo-admin@qrapp.ge";
const PARTNER_EMAIL = "demo-partner@qrapp.ge";
const PARTNER_SLUG = "demo-flowers";
const PARTNER_NAME = "Demo Flower Shop";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

async function main() {
  const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = arg("out");
  const confirmRef = arg("confirm-ref");
  if (!migrationsUrl || !supabaseUrl || !serviceRoleKey) {
    throw new Error("MIGRATIONS_DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  if (!out || !confirmRef) throw new Error("--out=<file> and --confirm-ref=<project-ref> are required");
  if (new URL(supabaseUrl).hostname !== `${confirmRef}.supabase.co`) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL does not match --confirm-ref; refusing to run");
  }
  const resetPasswords = process.argv.includes("--reset-passwords");

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const sql = postgres(migrationsUrl, { max: 1 });
  const { data: list, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;

  const credentials: string[] = [];
  async function ensureUser(email: string) {
    const password = randomBytes(15).toString("base64url");
    const existing = list.users.find((u) => u.email === email);
    if (existing) {
      if (!resetPasswords) return existing.id;
      const { error } = await supabase.auth.admin.updateUserById(existing.id, { password });
      if (error) throw error;
      credentials.push(`${email}  ${password}`);
      return existing.id;
    }
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    credentials.push(`${email}  ${password}`);
    return data.user.id;
  }

  const adminId = await ensureUser(ADMIN_EMAIL);
  await sql`insert into admin_users (user_id) values (${adminId}) on conflict do nothing`;

  const partnerUserId = await ensureUser(PARTNER_EMAIL);
  await sql`insert into partners (slug, name, commission_rate_bps) values (${PARTNER_SLUG}, ${PARTNER_NAME}, 3000) on conflict (slug) do nothing`;
  const [partner] = await sql`select id from partners where slug = ${PARTNER_SLUG}`;
  await sql`insert into partner_members (partner_id, user_id, role) values (${partner!.id}, ${partnerUserId}, 'OWNER') on conflict do nothing`;
  await sql.end();

  if (credentials.length > 0) {
    writeFileSync(out, `# QR Starr owner-review demo logins (${confirmRef})\n${credentials.join("\n")}\n`, { mode: 0o600, flag: "a" });
  }
  console.log(`Admin ${ADMIN_EMAIL}, partner ${PARTNER_EMAIL} (OWNER of "${PARTNER_NAME}") ready.`);
  console.log(credentials.length > 0 ? `New passwords appended to ${out}.` : "No passwords changed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

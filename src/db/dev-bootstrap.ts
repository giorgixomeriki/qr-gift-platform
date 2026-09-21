import postgres from "postgres";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createClient } from "@supabase/supabase-js";
import { adminUsers, partners, partnerMembers } from "./schema";

/**
 * LOCAL DEV ONLY. Creates a throwaway admin user and a throwaway partner +
 * owner membership so the partner/admin auth flow can be exercised through an
 * actual browser instead of only via psql. Never run against anything but the
 * local Supabase instance — it uses the service-role key to mint auth users
 * directly, bypassing normal signup.
 */
const DEV_ADMIN_EMAIL = "admin@dev.local";
const DEV_PARTNER_EMAIL = "partner@dev.local";
const DEV_PASSWORD = "dev-password-only";

async function main() {
  // Hard guard, not just convention: this mints auth users with a known
  // password via the service-role key, so it must never be able to run
  // against a real deployment even if MIGRATIONS_DATABASE_URL were ever
  // accidentally present there.
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:dev-bootstrap must never run with NODE_ENV=production.");
  }

  const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!migrationsUrl || !supabaseUrl || !serviceRoleKey) {
    throw new Error("MIGRATIONS_DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const sql = postgres(migrationsUrl, { max: 1 });
  const db = drizzle(sql);

  const { data: list, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;

  async function ensureAuthUser(email: string) {
    const existing = list.users.find((u) => u.email === email);
    if (existing) return existing;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: DEV_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    return data.user;
  }

  const adminUser = await ensureAuthUser(DEV_ADMIN_EMAIL);
  await db.insert(adminUsers).values({ userId: adminUser.id }).onConflictDoNothing();

  const partnerUser = await ensureAuthUser(DEV_PARTNER_EMAIL);
  const [partner] = await db
    .insert(partners)
    .values({ slug: "dev-partner", name: "Dev Partner" })
    .onConflictDoNothing()
    .returning({ id: partners.id });

  let partnerId = partner?.id;
  if (!partnerId) {
    const [existingPartner] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.slug, "dev-partner"))
      .limit(1);
    partnerId = existingPartner?.id;
  }

  if (partnerId) {
    await db
      .insert(partnerMembers)
      .values({ partnerId, userId: partnerUser.id, role: "OWNER" })
      .onConflictDoNothing();
  }

  await sql.end();
  console.log(`Dev admin:   ${DEV_ADMIN_EMAIL} / ${DEV_PASSWORD}`);
  console.log(`Dev partner: ${DEV_PARTNER_EMAIL} / ${DEV_PASSWORD} (OWNER of "Dev Partner")`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { envFindings, migrationFindings, type Finding, type JournalEntry } from "../src/lib/ops/preflight-checks";

/**
 * READ-ONLY readiness check for one environment (local, staging or
 * production), run from a checkout of the code being deployed, with that
 * environment's variables exported:
 *
 *   npm run ops:preflight
 *
 * Checks: every migration in this checkout is applied (and none would be
 * skipped — the 0018/0019 trap); env combinations that env.ts accepts but
 * are wrong for an environment; the reconcile job's admin is a real admin;
 * at least one admin exists; the media bucket is private.
 *
 * The database session is opened with default_transaction_read_only=on, so
 * nothing here can write. Run ops:check-launch-pricing alongside it.
 * Exit code 1 on any FAIL.
 */
const findings: { area: string; f: Finding }[] = [];
const add = (area: string, fs: Finding[]) => fs.forEach((f) => findings.push({ area, f }));

async function main() {
  const url = process.env.MIGRATIONS_DATABASE_URL;
  if (!url) throw new Error("MIGRATIONS_DATABASE_URL is required (read-only use)");

  add("env", envFindings({
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    paymentsProvider: process.env.PAYMENTS_PROVIDER,
    allowTestPayments: process.env.ALLOW_TEST_PAYMENTS,
    checkoutEnabled: process.env.CHECKOUT_ENABLED,
    bogRefundsEnabled: process.env.BOG_REFUNDS_ENABLED,
    cronSecret: process.env.CRON_SECRET,
    reconcileAdminUserId: process.env.RECONCILE_ADMIN_USER_ID,
  }));

  const dir = join(__dirname, "../src/db/migrations");
  const journal: JournalEntry[] = (JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")).entries as { tag: string; when: number }[]).map((e) => ({
    tag: e.tag,
    when: e.when,
    hash: createHash("sha256").update(readFileSync(join(dir, `${e.tag}.sql`), "utf8")).digest("hex"),
  }));

  const sql = postgres(url, { max: 1, connection: { default_transaction_read_only: true } });
  try {
    const ledger = await sql<{ hash: string; created_at: string }[]>`select hash, created_at from drizzle.__drizzle_migrations`;
    add("migrations", migrationFindings(journal, ledger.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }))));

    const n = (await sql<{ n: number }[]>`select count(*)::int as n from admin_users`)[0]?.n ?? 0;
    add("admins", [n > 0 ? { level: "INFO", message: `${n} platform admin(s)` } : { level: "FAIL", message: "no platform admin exists (launch step 9)" }]);
    const reconcileAdmin = process.env.RECONCILE_ADMIN_USER_ID;
    if (reconcileAdmin) {
      const [row] = await sql`select 1 from admin_users where user_id = ${reconcileAdmin}`;
      add("admins", [row ? { level: "INFO", message: "RECONCILE_ADMIN_USER_ID is a platform admin" } : { level: "FAIL", message: "RECONCILE_ADMIN_USER_ID is not in admin_users" }]);
    }
  } finally {
    await sql.end();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "greeting-media";
  if (supabaseUrl && serviceKey) {
    const { data, error } = await createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }).storage.getBucket(bucket);
    add("storage", [
      error || !data
        ? { level: "FAIL", message: `bucket "${bucket}" could not be read (${error?.message ?? "missing"})` }
        : data.public
          ? { level: "FAIL", message: `bucket "${bucket}" is PUBLIC — greeting media must be private` }
          : { level: "INFO", message: `bucket "${bucket}" is private` },
    ]);
  } else {
    add("storage", [{ level: "WARN", message: "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — bucket privacy not checked" }]);
  }

  for (const { area, f } of findings) console.log(`${f.level.padEnd(4)}  [${area}] ${f.message}`);
  const fails = findings.filter((x) => x.f.level === "FAIL").length;
  console.log(fails ? `\n${fails} FAIL — not ready.` : "\nPreflight OK (review any WARN).");
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

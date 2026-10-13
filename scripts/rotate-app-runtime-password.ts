import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

/**
 * Audit finding F-01: migration 0001 creates the app_runtime role with a
 * fixed, publicly committed local-dev password. Run this ONCE against every
 * hosted database right after its first `npm run db:migrate`, before any
 * traffic reaches it (docs/PRODUCTION_DEPLOYMENT.md).
 *
 *   MIGRATIONS_DATABASE_URL=... npx tsx scripts/rotate-app-runtime-password.ts \
 *     --confirm-host=<host of MIGRATIONS_DATABASE_URL> --out=<new file path>
 *
 * The new password is never printed. The resulting runtime DATABASE_URL
 * (Supabase pooler, transaction mode, port 6543, user app_runtime.<ref>) is
 * written to --out with mode 0600, ready for
 *   vercel env add DATABASE_URL production < <out>
 * after which the file should be deleted. If MIGRATIONS_DATABASE_URL is not a
 * Supabase pooler URL ("postgres.<ref>@...pooler.supabase.com"), only the
 * bare password is written and the operator assembles the URL.
 */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
  if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
  const target = new URL(migrationsUrl);

  const confirmHost = arg("confirm-host");
  const out = arg("out");
  if (!out) throw new Error("--out=<path> is required (the new password is never printed)");
  if (confirmHost !== target.hostname) {
    throw new Error(`--confirm-host must exactly match the target database host (${target.hostname})`);
  }

  // base64url: [A-Za-z0-9_-] only, so it is safe both inside the SQL literal
  // below and unencoded inside a connection URL.
  const password = randomBytes(32).toString("base64url");

  const sql = postgres(migrationsUrl, { max: 1 });
  try {
    const [role] = await sql<{ rolname: string }[]>`select rolname from pg_roles where rolname = 'app_runtime'`;
    if (!role) throw new Error("Role app_runtime does not exist — run npm run db:migrate first");
    await sql.unsafe(`alter role app_runtime with password '${password}'`);
  } finally {
    await sql.end();
  }

  const [user, ref] = decodeURIComponent(target.username).split(".");
  const isPooler = user === "postgres" && ref && target.hostname.endsWith(".pooler.supabase.com");
  const content = isPooler
    ? `postgresql://app_runtime.${ref}:${password}@${target.hostname}:6543/postgres`
    : password;

  writeFileSync(out, content, { mode: 0o600, flag: "wx" });
  console.log(
    `app_runtime password rotated on ${target.hostname}. ` +
      (isPooler ? "Runtime DATABASE_URL" : "New password (assemble DATABASE_URL yourself)") +
      ` written to ${out} (mode 0600). Store it in the platform secret store, then delete the file.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

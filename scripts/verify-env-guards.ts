import { appUrlProblems, databaseUrlProblems, supabaseUrlProblems } from "../src/lib/env-guards";

/**
 * Deployment-safety env guards (src/lib/env-guards.ts). Pure — no database,
 * no app server. Every connection string below is a made-up example.
 */
let passed = 0;
let failed = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (ok) passed++;
  else failed++;
}

const devPassword = "HH1mUPcwnyz1NGyM8jbeLsQqbwc";
const local = { production: false, hosted: false };
const localProd = { production: true, hosted: false };
const vercel = { production: true, hosted: true };

console.log("NEXT_PUBLIC_APP_URL");
check("dev: unset is fine (localhost default)", appUrlProblems(undefined, local).length === 0);
check("production: unset is refused", appUrlProblems(undefined, localProd).length === 1);
check("production: local http origin is fine off-platform", appUrlProblems("http://localhost:3000", localProd).length === 0);
check("production: trailing slash is refused", appUrlProblems("https://qrapp.ge/", vercel).length === 1);
check("production: a path is refused", appUrlProblems("https://qrapp.ge/g", vercel).length === 1);
check("hosted: http is refused", appUrlProblems("http://qrapp.ge", vercel).length === 1);
check("hosted: localhost is refused", appUrlProblems("https://localhost", vercel).length === 1);
check("hosted: https://qrapp.ge is accepted", appUrlProblems("https://qrapp.ge", vercel).length === 0);
check("hosted: an https preview origin is accepted", appUrlProblems("https://qr-starr-git-x.vercel.app", vercel).length === 0);
check("garbage is refused", appUrlProblems("not a url", vercel).length === 1);

console.log("DATABASE_URL");
check(
  "local stack with the public dev password is fine",
  databaseUrlProblems(`postgresql://app_runtime:${devPassword}@127.0.0.1:54322/postgres`, localProd).length === 0,
);
check(
  "remote database with the public dev password is refused, even outside production",
  databaseUrlProblems(`postgresql://app_runtime.abcd:${devPassword}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`, local).length === 1,
);
check(
  "production superuser (direct) is refused",
  databaseUrlProblems("postgresql://postgres:x@db.abcd.supabase.co:5432/postgres", vercel).length === 1,
);
check(
  "production superuser (pooler spelling) is refused",
  databaseUrlProblems("postgresql://postgres.abcd:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres", vercel).length === 1,
);
check(
  "hosted deployment pointing at a local database is refused",
  databaseUrlProblems("postgresql://app_runtime:rotated@127.0.0.1:54322/postgres", vercel).length === 1,
);
check(
  "hosted app_runtime with a rotated password via the pooler is accepted",
  databaseUrlProblems("postgresql://app_runtime.abcd:rotated-secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres", vercel).length === 0,
);
check(
  "the CI build placeholder is accepted",
  databaseUrlProblems("postgresql://ci-build-placeholder:unused@127.0.0.1:1/ci_build_placeholder", localProd).length === 0,
);
check(
  "messages never echo the password",
  databaseUrlProblems(`postgresql://postgres:${devPassword}@db.abcd.supabase.co/postgres`, vercel).every((m) => !m.includes(devPassword)),
);

console.log("NEXT_PUBLIC_SUPABASE_URL");
check("dev: local Supabase is fine", supabaseUrlProblems("http://127.0.0.1:54321", { hosted: false }).length === 0);
check("hosted: local Supabase is refused", supabaseUrlProblems("http://127.0.0.1:54321", { hosted: true }).length === 2);
check("hosted: a Supabase project URL is accepted", supabaseUrlProblems("https://abcd.supabase.co", { hosted: true }).length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

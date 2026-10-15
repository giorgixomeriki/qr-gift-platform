import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { envFindings, migrationFindings, type EnvSnapshot } from "../src/lib/ops/preflight-checks";

/**
 * ops:preflight's checks (src/lib/ops/preflight-checks.ts) and the
 * reconciliation schedule:
 *  1. Migrations: all applied; the "merged behind" trap (0018 after 0019) is
 *     a FAIL that says db:migrate will skip it; an unapplied newest one says
 *     run db:migrate; an edited applied file is a WARN.
 *  2. Env: test payments on the live domain, half-configured cron, a short
 *     cron secret are FAILs; open checkout is a loud WARN.
 *  3. The preflight's DB session really is read-only.
 *  4. vercel.json schedules /api/cron/payments-reconcile (Hobby allows daily).
 */
let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const levels = (fs: { level: string; message: string }[]) => fs.map((f) => `${f.level}:${f.message}`).join(" | ");

async function main() {
  console.log("--- 1. Migrations ---");
  const journal = [
    { tag: "0017_a", when: 100, hash: "h17" },
    { tag: "0018_b", when: 200, hash: "h18" },
    { tag: "0019_c", when: 300, hash: "h19" },
  ];
  const all = migrationFindings(journal, [{ hash: "h17", createdAt: 100 }, { hash: "h18", createdAt: 200 }, { hash: "h19", createdAt: 300 }]);
  check("1a. All applied → no FAIL/WARN", all.every((f) => f.level === "INFO"), levels(all));
  const trap = migrationFindings(journal, [{ hash: "h17", createdAt: 100 }, { hash: "h19", createdAt: 300 }]);
  check("1b. 0018 missing behind an applied 0019 → FAIL that says db:migrate will skip it", trap.some((f) => f.level === "FAIL" && f.message.includes("0018_b") && f.message.includes("SKIP")), levels(trap));
  const pending = migrationFindings(journal, [{ hash: "h17", createdAt: 100 }, { hash: "h18", createdAt: 200 }]);
  check("1c. Newest not applied yet → FAIL that says run db:migrate", pending.some((f) => f.level === "FAIL" && f.message.includes("0019_c") && f.message.includes("run db:migrate")), levels(pending));
  const edited = migrationFindings(journal, [{ hash: "OLD", createdAt: 100 }, { hash: "h18", createdAt: 200 }, { hash: "h19", createdAt: 300 }]);
  check("1d. Edited after applying → WARN, not FAIL", edited.some((f) => f.level === "WARN" && f.message.includes("0017_a")) && !edited.some((f) => f.level === "FAIL"), levels(edited));

  console.log("\n--- 2. Env combinations ---");
  const base: EnvSnapshot = { appUrl: "https://qrapp.ge", paymentsProvider: "BOG", allowTestPayments: undefined, checkoutEnabled: undefined, bogRefundsEnabled: undefined, cronSecret: "x".repeat(40), reconcileAdminUserId: "11111111-1111-4111-8111-111111111111" };
  const ok = envFindings(base);
  check("2a. Live domain, BOG, checkout closed, cron configured → no FAIL", !ok.some((f) => f.level === "FAIL"), levels(ok));
  check("2b. ALLOW_TEST_PAYMENTS=true on qrapp.ge → FAIL", envFindings({ ...base, allowTestPayments: "true" }).some((f) => f.level === "FAIL"));
  check("2c. …but allowed on a non-live origin", !envFindings({ ...base, appUrl: "https://preview.example", allowTestPayments: "true" }).some((f) => f.level === "FAIL"));
  const open = envFindings({ ...base, checkoutEnabled: "true" });
  check("2d. Checkout open → WARN, plus a WARN when BOG refunds are off", open.filter((f) => f.level === "WARN").length === 2, levels(open));
  check("2e. Only one of CRON_SECRET / RECONCILE_ADMIN_USER_ID → FAIL", envFindings({ ...base, reconcileAdminUserId: undefined }).some((f) => f.level === "FAIL") && envFindings({ ...base, cronSecret: undefined }).some((f) => f.level === "FAIL"));
  check("2f. A short CRON_SECRET → FAIL", envFindings({ ...base, cronSecret: "short" }).some((f) => f.level === "FAIL"));

  console.log("\n--- 3. Read-only session ---");
  const url = process.env.MIGRATIONS_DATABASE_URL;
  if (!url) throw new Error("MIGRATIONS_DATABASE_URL is required");
  const ro = postgres(url, { max: 1, connection: { default_transaction_read_only: true } });
  let refused = false;
  try {
    await ro`create temporary table preflight_write_probe (x int)`;
  } catch (e) {
    refused = String(e).includes("read-only");
  } finally {
    await ro.end();
  }
  check("3a. The preflight's connection settings refuse writes", refused);

  console.log("\n--- 4. Reconciliation schedule ---");
  const vercel = JSON.parse(readFileSync(join(__dirname, "../vercel.json"), "utf8")) as { crons?: { path: string; schedule: string }[] };
  const cron = vercel.crons?.find((c) => c.path === "/api/cron/payments-reconcile");
  check("4a. vercel.json schedules /api/cron/payments-reconcile", !!cron);
  check("4b. At most once a day (valid on Vercel Hobby): fixed minute and hour", !!cron && /^\d{1,2} \d{1,2} \* \* \*$/.test(cron.schedule), cron?.schedule);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

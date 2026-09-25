import Module from "node:module";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { recordManualPayout, getPartnerUnpaidBalance } = require("../src/lib/payments/payouts") as typeof import("../src/lib/payments/payouts");
const { withAdminContext, withPartnerContext, withPublicContext } = require("../src/db/client") as typeof import("../src/db/client");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const admin = postgres(migrationsUrl, { max: 1 });

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
async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
/** Runs both promises to settlement (never lets one rejection abort Promise.all early) and reports which succeeded. */
async function raceTwo<T>(a: () => Promise<T>, b: () => Promise<T>): Promise<{ succeeded: number; results: PromiseSettledResult<T>[] }> {
  const results = await Promise.allSettled([a(), b()]);
  return { succeeded: results.filter((r) => r.status === "fulfilled").length, results };
}

async function main() {
  console.log("Setting up fixtures (superuser)...");

  const partnerA = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const adminUserId = crypto.randomUUID();
  const commissionRateBps = 3000;
  const currency = "GEL";

  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerA}, ${"payout-race-" + partnerA.slice(0, 8)}, 'Payout Concurrency Test Partner', ${commissionRateBps}, 'ACTIVE')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerA}, ${userA}, 'OWNER')`;
  await admin`insert into admin_users (user_id) values (${adminUserId})`;

  // A large COMMISSION_EARNED credit, unrelated to any real order, purely so
  // this script can exercise payout recording in isolation from checkout.
  await admin`insert into partner_ledger_entries (partner_id, type, amount_minor, currency) values (${partnerA}, 'COMMISSION_EARNED', 100000, ${currency})`;

  function payout(periodFrom: string, periodTo: string, amountMinor = 100) {
    return withAdminContext(adminUserId, (tx) =>
      recordManualPayout(tx, adminUserId, {
        partnerId: partnerA,
        currency,
        amountMinor,
        periodFrom: new Date(periodFrom),
        periodTo: new Date(periodTo),
        reference: "concurrency-test",
      }),
    );
  }

  console.log("\n--- Two concurrent requests for the IDENTICAL period ---");
  {
    const { succeeded } = await raceTwo(
      () => payout("2026-01-01", "2026-01-31"),
      () => payout("2026-01-01", "2026-01-31"),
    );
    check("1. Exactly one of two concurrent identical-period payouts succeeds", succeeded === 1);
  }

  console.log("\n--- Two concurrent requests for OVERLAPPING (not identical) periods ---");
  {
    const { succeeded } = await raceTwo(
      () => payout("2026-02-01", "2026-02-20"),
      () => payout("2026-02-10", "2026-02-28"),
    );
    check("2. Exactly one of two concurrent overlapping-period payouts succeeds — the DB constraint catches the race the app-layer pre-check alone cannot", succeeded === 1);
  }

  console.log("\n--- Two concurrent requests for NON-overlapping periods ---");
  {
    const { succeeded } = await raceTwo(
      () => payout("2026-03-01", "2026-03-15"),
      () => payout("2026-03-16", "2026-03-31"),
    );
    check("3. Both of two concurrent non-overlapping-period payouts succeed", succeeded === 2);
  }

  console.log("\n--- Sequential duplicate / overlap still rejected with a friendly error (unchanged behavior) ---");
  {
    await payout("2026-04-01", "2026-04-30");
    let messageOk = false;
    try {
      await payout("2026-04-15", "2026-05-05");
    } catch (err) {
      messageOk = err instanceof Error && err.message.includes("overlapping period");
    }
    check("4. A sequential overlapping payout is rejected with the existing friendly PayoutError message", messageOk);
  }

  console.log("\n--- Insufficient balance ---");
  {
    const unpaidBalance = await withAdminContext(adminUserId, (tx) => getPartnerUnpaidBalance(tx, partnerA, currency));
    check(
      "5. A payout exceeding the unpaid balance is rejected",
      await expectThrows(() => payout("2026-06-01", "2026-06-30", unpaidBalance + 1_000_000)),
    );
  }

  console.log("\n--- Unauthorized payout attempts ---");
  {
    check(
      "6. A partner member cannot create a payout — admin-only by RLS",
      await expectThrows(() =>
        withPartnerContext(userA, partnerA, (tx) =>
          recordManualPayout(tx, userA, { partnerId: partnerA, currency, amountMinor: 1, periodFrom: new Date("2026-07-01"), periodTo: new Date("2026-07-31") }),
        ),
      ),
    );
    check(
      "7. An anonymous/unauthenticated context cannot create a payout",
      await expectThrows(() =>
        withPublicContext((tx) =>
          recordManualPayout(tx, crypto.randomUUID(), { partnerId: partnerA, currency, amountMinor: 1, periodFrom: new Date("2026-07-01"), periodTo: new Date("2026-07-31") }),
        ),
      ),
    );
  }

  console.log("\nCleaning up fixtures...");
  await admin`delete from partner_payouts where partner_id = ${partnerA}`;
  await admin`delete from partner_ledger_entries where partner_id = ${partnerA}`;
  await admin`delete from partner_members where partner_id = ${partnerA}`;
  await admin`delete from admin_users where user_id = ${adminUserId}`;
  await admin`delete from partners where id = ${partnerA}`;
  await admin.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end();
  process.exit(1);
});

import Module from "node:module";

// Same server-only shim as the verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const { runPaymentReconciliation } = require("../src/lib/payments/reconcile") as typeof import("../src/lib/payments/reconcile");

/**
 * Payment reconciliation (docs/PAYMENTS.md "Reconciliation").
 *
 *   npm run payments:reconcile -- --admin <admin user id>           report only
 *   npm run payments:reconcile -- --admin <admin user id> --apply   also repair what is safe
 *
 * What --apply repairs, and how, is defined once in lib/payments/reconcile.ts
 * (shared with the scheduled /api/cron/payments-reconcile).
 */
async function main() {
  const args = process.argv.slice(2);
  const adminUserId = args[args.indexOf("--admin") + 1];
  if (!args.includes("--admin") || !adminUserId) throw new Error("--admin <admin user id> is required (an admin_users.user_id)");
  const apply = args.includes("--apply");

  const { anomalies, actions } = await runPaymentReconciliation(adminUserId, { apply });
  if (!anomalies.length) {
    console.log("No payment anomalies.");
    return;
  }
  for (const a of anomalies) console.log(`${a.kind.padEnd(24)} ${a.orderId}  ${a.detail}`);
  if (!apply) {
    console.log(`\n${anomalies.length} anomalies. Re-run with --apply to repair the safe kinds.`);
    return;
  }

  console.log("\nApplied safe repairs:");
  for (const a of actions) console.log(`  ${a.orderId} ${a.kind}: ${a.outcome}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

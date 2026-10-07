import Module from "node:module";

// Same server-only shim as the verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const { findPaymentAnomalies, verifyAndReconcileOrder, activatePaidOrder, refundCapturedPayment } =
  require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
const { payments, orders } = require("../src/db/schema") as typeof import("../src/db/schema");
const { and, asc, eq } = require("drizzle-orm") as typeof import("drizzle-orm");

/**
 * Payment reconciliation (docs/PAYMENTS.md "Reconciliation").
 *
 *   npm run payments:reconcile -- --admin <admin user id>           report only
 *   npm run payments:reconcile -- --admin <admin user id> --apply   also repair what is safe
 *
 * --apply only ever goes through the same service functions a webhook or an
 * admin action uses, and only for kinds that have a provider-confirmed or
 * internal-only fix:
 *   STALE_PENDING       → verifyAndReconcileOrder (asks the PROVIDER; never assumes)
 *   PAID_NOT_ACTIVATED  → activatePaidOrder (idempotent)
 *   DUPLICATE_CAPTURE   → refundCapturedPayment for each extra charge (provider-confirmed)
 * Everything else is reported for a person to decide. Run it on a schedule
 * (e.g. every 15 minutes) once the real provider is live.
 */
async function main() {
  const args = process.argv.slice(2);
  const adminUserId = args[args.indexOf("--admin") + 1];
  if (!args.includes("--admin") || !adminUserId) throw new Error("--admin <admin user id> is required (an admin_users.user_id)");
  const apply = args.includes("--apply");

  const anomalies = await findPaymentAnomalies(adminUserId);
  if (!anomalies.length) {
    console.log("No payment anomalies.");
    return;
  }
  for (const a of anomalies) console.log(`${a.kind.padEnd(24)} ${a.orderId}  ${a.detail}`);
  if (!apply) {
    console.log(`\n${anomalies.length} anomalies. Re-run with --apply to repair the safe kinds.`);
    return;
  }

  console.log("\nApplying safe repairs…");
  for (const a of anomalies) {
    try {
      if (a.kind === "STALE_PENDING") {
        const r = await verifyAndReconcileOrder(a.orderId);
        console.log(`  ${a.orderId} re-verified with the provider → ${r.status}${r.activated ? ", activated" : ""}`);
      } else if (a.kind === "PAID_NOT_ACTIVATED") {
        const r = await activatePaidOrder(a.orderId);
        console.log(`  ${a.orderId} activation → ${r.activated ? "activated" : "already active"}`);
      } else if (a.kind === "DUPLICATE_CAPTURE") {
        const charges = await withAdminContext(adminUserId, (tx) =>
          tx
            .select({ id: payments.id, orderStatus: orders.status })
            .from(payments)
            .innerJoin(orders, eq(orders.id, payments.orderId))
            .where(and(eq(payments.orderId, a.orderId), eq(payments.status, "SUCCEEDED")))
            .orderBy(asc(payments.confirmedAt)),
        );
        // On a PAID order the first confirmed charge paid it; every other one is returned.
        const extras = charges[0]?.orderStatus === "PAID" ? charges.slice(1) : charges;
        for (const c of extras) {
          const r = await refundCapturedPayment(a.orderId, c.id);
          console.log(`  ${a.orderId} charge ${c.id} → ${r.status}`);
        }
      }
    } catch (err) {
      console.log(`  ${a.orderId} ${a.kind}: not repaired — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

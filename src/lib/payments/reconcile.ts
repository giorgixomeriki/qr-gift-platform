import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { withAdminContext } from "@/db/client";
import { orders, payments } from "@/db/schema";
import { activatePaidOrder, findPaymentAnomalies, refundCapturedPayment, verifyAndReconcileOrder, type PaymentAnomalyKind } from "./service";
import { reconcileOrderRefunds } from "./refunds";

export type ReconcileAction = { orderId: string; kind: PaymentAnomalyKind; outcome: string };
export type ReconcileReport = {
  anomalies: { kind: PaymentAnomalyKind; orderId: string; detail: string }[];
  actions: ReconcileAction[];
};

/**
 * Payment reconciliation (docs/PAYMENTS.md "Reconciliation"), shared by
 * `npm run payments:reconcile` and the scheduled /api/cron/payments-reconcile.
 *
 * With `apply`, it only repairs kinds that have a provider-confirmed or
 * internal-only fix, always through the same service functions a webhook or
 * an admin action uses:
 *   STALE_PENDING            → verifyAndReconcileOrder (asks the PROVIDER; never assumes)
 *   PAID_NOT_ACTIVATED       → activatePaidOrder (idempotent)
 *   DUPLICATE_CAPTURE        → refundCapturedPayment for each extra charge (provider-confirmed)
 *   REFUND_AWAITING_PROVIDER → reconcileOrderRefunds (completes only what the provider confirms)
 * Everything else is reported for a person to decide. One order failing never
 * stops the others.
 */
export async function runPaymentReconciliation(adminUserId: string, opts: { apply: boolean }): Promise<ReconcileReport> {
  const anomalies = await findPaymentAnomalies(adminUserId);
  const actions: ReconcileAction[] = [];
  if (!opts.apply) return { anomalies, actions };

  for (const a of anomalies) {
    const record = (outcome: string) => actions.push({ orderId: a.orderId, kind: a.kind, outcome });
    try {
      if (a.kind === "STALE_PENDING") {
        const r = await verifyAndReconcileOrder(a.orderId);
        record(`re-verified with the provider → ${r.status}${r.activated ? ", activated" : ""}`);
      } else if (a.kind === "REFUND_AWAITING_PROVIDER") {
        const r = await reconcileOrderRefunds(a.orderId);
        record(`refunds → ${r.completed} completed, ${r.rejected} rejected, ${r.pending} still pending`);
      } else if (a.kind === "PAID_NOT_ACTIVATED") {
        const r = await activatePaidOrder(a.orderId);
        record(`activation → ${r.activated ? "activated" : "already active"}`);
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
          record(`charge ${c.id} → ${r.status}`);
        }
      }
    } catch (err) {
      record(`not repaired — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { anomalies, actions };
}

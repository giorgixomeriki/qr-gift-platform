import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { checkIsAdmin, withAdminContext } from "@/db/client";
import { orders, payments } from "@/db/schema";
import { activatePaidOrder, findPaymentAnomalies, refundCapturedPayment, verifyAndReconcileOrder, type PaymentAnomalyKind } from "./service";
import { reconcileOrderRefunds } from "./refunds";

export type PaymentAnomaly = { kind: PaymentAnomalyKind; orderId: string; detail: string };
export type ReconcileAction = { orderId: string; kind: PaymentAnomalyKind; outcome: string; ok: boolean };
export type ReconcileReport = {
  anomalies: PaymentAnomaly[];
  actions: ReconcileAction[];
  /** What still needs attention after this run's repairs (equal to anomalies when nothing was applied). */
  remaining: PaymentAnomaly[];
};

/** The configured reconcile identity isn't an admin, so RLS would hide every row and the run would falsely report "no anomalies". */
export class ReconcileIdentityError extends Error {
  constructor() {
    super("The reconciliation identity is not an admin_users row");
    this.name = "ReconcileIdentityError";
  }
}

/**
 * Payment reconciliation (docs/PAYMENTS.md "Reconciliation"), shared by
 * `npm run payments:reconcile` and the scheduled /api/cron/payments-reconcile.
 *
 * With `apply`, it only repairs kinds that have a provider-confirmed or
 * internal-only fix, always through the same service functions a webhook or
 * an admin action uses:
 *   STALE_PENDING            → verifyAndReconcileOrder (asks the PROVIDER; never assumes)
 *   PAID_NOT_ACTIVATED       → activatePaidOrder (idempotent)
 *   PAID_QR_NOT_ACTIVATED    → activatePaidOrder (idempotent; a DRAFT QR only)
 *   DUPLICATE_CAPTURE        → refundCapturedPayment for each extra charge (provider-confirmed)
 *   REFUND_AWAITING_PROVIDER → reconcileOrderRefunds (completes only what the provider confirms)
 * Everything else is reported for a person to decide. One order failing never
 * stops the others.
 */
export async function runPaymentReconciliation(adminUserId: string, opts: { apply: boolean }): Promise<ReconcileReport> {
  if (!(await checkIsAdmin(adminUserId))) throw new ReconcileIdentityError();

  const anomalies = await findPaymentAnomalies(adminUserId);
  const actions: ReconcileAction[] = [];
  if (!opts.apply) return { anomalies, actions, remaining: anomalies };

  for (const a of anomalies) {
    const record = (outcome: string, ok = true) => actions.push({ orderId: a.orderId, kind: a.kind, outcome, ok });
    try {
      if (a.kind === "STALE_PENDING") {
        const r = await verifyAndReconcileOrder(a.orderId);
        record(`re-verified with the provider → ${r.status}${r.activated ? ", activated" : ""}`);
      } else if (a.kind === "REFUND_AWAITING_PROVIDER") {
        const r = await reconcileOrderRefunds(a.orderId);
        record(`refunds → ${r.completed} completed, ${r.rejected} rejected, ${r.pending} still pending`);
      } else if (a.kind === "PAID_NOT_ACTIVATED" || a.kind === "PAID_QR_NOT_ACTIVATED") {
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
      record(`not repaired — ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }
  const remaining = actions.length > 0 ? await findPaymentAnomalies(adminUserId) : anomalies;
  return { anomalies, actions, remaining };
}

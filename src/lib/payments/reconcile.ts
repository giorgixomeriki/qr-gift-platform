import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { checkIsAdmin, withAdminContext } from "@/db/client";
import { orders, payments } from "@/db/schema";
import { activatePaidOrder, findPaymentAnomalies, refundCapturedPayment, verifyAndReconcileOrder, type PaymentAnomalyKind } from "./service";
import { reconcileOrderRefunds } from "./refunds";
import { paymentScopePartnerId } from "./scope";

export type PaymentAnomaly = { kind: PaymentAnomalyKind; orderId: string; detail: string };
export type ReconcileAction = { orderId: string; kind: PaymentAnomalyKind; outcome: string; ok: boolean };
export type ReconcileReport = {
  anomalies: PaymentAnomaly[];
  actions: ReconcileAction[];
  /** What still needs attention after this run's repairs (equal to anomalies when nothing was applied). */
  remaining: PaymentAnomaly[];
  /** Set when the run was fenced to one partner: anomalies outside it were neither reported nor acted on. */
  scope?: { partnerId: string; excluded: number };
};

/** The requested reconciliation scope contradicts the deployment's PAYMENTS_SCOPE_PARTNER_ID. */
export class ReconcileScopeError extends Error {
  constructor() {
    super("Reconciliation scope does not match PAYMENTS_SCOPE_PARTNER_ID");
    this.name = "ReconcileScopeError";
  }
}

/**
 * Keeps only anomalies whose order (or, for ACTIVE_WITHOUT_PAYMENT, greeting)
 * is owned by `partnerId`. Fail-closed: an id whose owner cannot be resolved
 * is dropped, never assumed in scope.
 */
async function filterToPartner(adminUserId: string, anomalies: PaymentAnomaly[], partnerId: string): Promise<{ kept: PaymentAnomaly[]; excluded: number }> {
  if (anomalies.length === 0) return { kept: [], excluded: 0 };
  const ids = [...new Set(anomalies.map((a) => a.orderId))].filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  const owners = new Map<string, { order?: string; greeting?: string }>();
  if (ids.length > 0) {
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    const rows = await withAdminContext(adminUserId, (tx) =>
      tx.execute<{ id: string; kind: "order" | "greeting"; partner_id: string }>(sql`
        select o.id::text as id, 'order' as kind, o.partner_id::text as partner_id from orders o where o.id in (${idList})
        union all
        select g.id::text, 'greeting', q.partner_id::text from greetings g join qr_codes q on q.id = g.qr_code_id where g.id in (${idList})
      `),
    );
    for (const r of rows) {
      const entry = owners.get(r.id) ?? {};
      entry[r.kind] = r.partner_id;
      owners.set(r.id, entry);
    }
  }
  const kept = anomalies.filter((a) => {
    const owner = owners.get(a.orderId);
    const partner = a.kind === "ACTIVE_WITHOUT_PAYMENT" ? owner?.greeting : owner?.order;
    return partner === partnerId;
  });
  return { kept, excluded: anomalies.length - kept.length };
}

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
export async function runPaymentReconciliation(adminUserId: string, opts: { apply: boolean; partnerId?: string }): Promise<ReconcileReport> {
  if (!(await checkIsAdmin(adminUserId))) throw new ReconcileIdentityError();

  // Scope: the deployment fence (PAYMENTS_SCOPE_PARTNER_ID) always applies;
  // a caller may ask for the same partner explicitly, never a different one.
  const fence = paymentScopePartnerId();
  if (fence && opts.partnerId && opts.partnerId !== fence) throw new ReconcileScopeError();
  const partnerId = fence ?? opts.partnerId;

  const scoped = async () => {
    const all = await findPaymentAnomalies(adminUserId);
    return partnerId ? filterToPartner(adminUserId, all, partnerId) : { kept: all, excluded: 0 };
  };
  const first = await scoped();
  const anomalies = first.kept;
  const scope = partnerId ? { partnerId, excluded: first.excluded } : undefined;
  const actions: ReconcileAction[] = [];
  if (!opts.apply) return { anomalies, actions, remaining: anomalies, ...(scope ? { scope } : {}) };

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
  const remaining = actions.length > 0 ? (await scoped()).kept : anomalies;
  return { anomalies, actions, remaining, ...(scope ? { scope } : {}) };
}

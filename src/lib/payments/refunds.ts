import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { withAdminPaymentContext, withPaymentActivation, type Tx } from "@/db/client";
import { orders, payments, paymentRefunds, partnerLedgerEntries } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import { logServerError } from "@/lib/log";
import { getPaymentProvider } from "./provider-factory";
import { idempotencyKeyFor } from "./idempotency";
import { ProviderNotImplementedError } from "./types";

/**
 * Two-phase provider refunds (migrations/0019, plan §3.6).
 *
 * A refund is REQUESTED first (a payment_refunds row), then the provider is
 * asked, with an Idempotency-Key derived from that row, so a retry can never
 * return the money twice. Money-side effects (charge/order REFUNDED, the
 * COMMISSION_REVERSAL) happen only in `completeRefund`, inside one
 * transaction with the row turning COMPLETED, and only once the provider has
 * confirmed: immediately for a synchronous provider (TEST), or later from its
 * callback / status for an asynchronous one (BOG).
 *
 * A refund the provider never received (refunds disabled, adapter missing) is
 * REJECTED as NOT_SENT and the order stays in the existing manual queue
 * (REFUND_REQUIRED / anomalies). A refund whose fate is unknown (network
 * error) stays REQUESTED and is re-sent with the same key on reconciliation.
 */

type Payment = typeof payments.$inferSelect;
type Refund = typeof paymentRefunds.$inferSelect;
export type RefundReason = "ADMIN" | "INELIGIBLE" | "DUPLICATE_CAPTURE";

/** COMPLETED: money returned and books updated. REQUESTED: awaiting the provider. REJECTED / NOT_SENT: nothing returned. */
export type RefundOutcome = "COMPLETED" | "REQUESTED" | "REJECTED" | "NOT_SENT";

const NOT_SENT = "NOT_SENT";

export class RefundWorkflowError extends Error {}

/** Opens the refund row for this charge, or returns the one already open (never a second). */
async function openRefund(orderId: string, payment: Payment, reason: RefundReason, requestedBy?: string): Promise<Refund> {
  return withPaymentActivation(orderId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.paymentId, payment.id), ne(paymentRefunds.status, "REJECTED")))
      .limit(1);
    if (existing) return existing;
    const [inserted] = await tx
      .insert(paymentRefunds)
      .values({ paymentId: payment.id, orderId, amountMinor: payment.amountMinor, currency: payment.currency, reason, requestedBy })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      await recordAuditLog(tx, {
        actorType: requestedBy ? "ADMIN" : "SYSTEM",
        actorId: requestedBy,
        action: "PAYMENT_REFUND_REQUESTED",
        targetType: "order",
        targetId: orderId,
        metadata: { refundId: inserted.id, paymentId: payment.id, reason, amountMinor: payment.amountMinor, currency: payment.currency },
      });
      return inserted;
    }
    // A concurrent request opened it first — use theirs.
    const [winner] = await tx
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.paymentId, payment.id), ne(paymentRefunds.status, "REJECTED")))
      .limit(1);
    if (!winner) throw new RefundWorkflowError(`Could not open a refund for payment ${payment.id}`);
    return winner;
  });
}

async function rejectRefund(refund: Refund, code: string, detail?: string): Promise<void> {
  await withPaymentActivation(refund.orderId, async (tx) => {
    const updated = await tx
      .update(paymentRefunds)
      .set({ status: "REJECTED", providerCode: code, resolvedAt: new Date() })
      .where(and(eq(paymentRefunds.id, refund.id), eq(paymentRefunds.status, "REQUESTED")))
      .returning({ id: paymentRefunds.id });
    if (updated.length > 0 && code !== NOT_SENT) {
      await recordAuditLog(tx, {
        actorType: "SYSTEM",
        action: "PAYMENT_REFUND_REJECTED",
        targetType: "order",
        targetId: refund.orderId,
        metadata: { refundId: refund.id, paymentId: refund.paymentId, code, ...(detail ? { detail } : {}) },
      });
    }
  });
}

/**
 * Asks the provider to return one charge in full, then completes the refund
 * at once if the provider confirms synchronously. Idempotent per charge.
 */
export async function requestChargeRefund(input: {
  orderId: string;
  payment: Payment;
  reason: RefundReason;
  requestedBy?: string;
}): Promise<RefundOutcome> {
  const { orderId, payment, reason, requestedBy } = input;
  if (!payment.providerPaymentId) throw new RefundWorkflowError(`Payment ${payment.id} has no provider reference`);
  const refund = await openRefund(orderId, payment, reason, requestedBy);
  if (refund.status === "COMPLETED") return "COMPLETED";
  // Already acknowledged by the provider: nothing to send again — completion
  // arrives by callback or reconcileOrderRefunds.
  if (refund.providerActionId) return "REQUESTED";

  const provider = getPaymentProvider();
  if (payment.provider !== provider.key) {
    await rejectRefund(refund, NOT_SENT);
    logServerError("requestChargeRefund", new Error("Charge was taken by a provider that is not configured"), { orderId, paymentId: payment.id });
    return "NOT_SENT";
  }

  let result;
  try {
    result = await provider.refundPayment(payment.providerPaymentId, payment.amountMinor, idempotencyKeyFor(`refund:${refund.id}`));
  } catch (err) {
    if (err instanceof ProviderNotImplementedError) {
      // Definitely not sent (refunds disabled / not integrated): close this
      // request so a later attempt can open a fresh one.
      await rejectRefund(refund, NOT_SENT);
      logServerError("requestChargeRefund", err, { orderId, paymentId: payment.id, notSent: true });
      return "NOT_SENT";
    }
    // Unknown whether the provider received it: stays REQUESTED, and
    // reconciliation re-sends it with the same Idempotency-Key.
    logServerError("requestChargeRefund", err, { orderId, paymentId: payment.id });
    return "REQUESTED";
  }

  if (result.status === "REFUNDED" && result.refundedAmountMinor === payment.amountMinor) {
    await completeRefund(refund.id, orderId);
    return "COMPLETED";
  }
  if (result.status === "PENDING") {
    if (result.providerActionId) {
      await withPaymentActivation(orderId, (tx) =>
        tx
          .update(paymentRefunds)
          .set({ providerActionId: result.providerActionId })
          .where(and(eq(paymentRefunds.id, refund.id), eq(paymentRefunds.status, "REQUESTED"))),
      );
    }
    return "REQUESTED";
  }
  await rejectRefund(refund, "PROVIDER_REFUSED", `${result.status} ${result.refundedAmountMinor}`);
  return "REJECTED";
}

/**
 * The money is back with the customer: the refund row turns COMPLETED and the
 * reason's bookkeeping is applied, inside the caller's transaction (which must
 * carry the order's payment context, and an admin context for ADMIN and
 * CHARGEBACK). A row that is no longer REQUESTED is left alone, so a
 * concurrent completion can never book twice.
 */
async function applyRefundCompletion(tx: Tx, refund: Refund): Promise<void> {
  const marked = await tx
    .update(paymentRefunds)
    .set({ status: "COMPLETED", resolvedAt: new Date() })
    .where(and(eq(paymentRefunds.id, refund.id), eq(paymentRefunds.status, "REQUESTED")))
    .returning({ id: paymentRefunds.id });
  if (marked.length === 0) return; // a concurrent completion won
  await tx
    .update(payments)
    .set({ status: "REFUNDED" })
    .where(and(eq(payments.id, refund.paymentId), eq(payments.status, "SUCCEEDED")));

  if (refund.reason === "DUPLICATE_CAPTURE") {
    await recordAuditLog(tx, {
      actorType: "SYSTEM",
      action: "PAYMENT_DUPLICATE_REFUNDED",
      targetType: "order",
      targetId: refund.orderId,
      metadata: { paymentId: refund.paymentId, refundId: refund.id, amountMinor: refund.amountMinor, currency: refund.currency },
    });
    return;
  }
  if (refund.reason === "INELIGIBLE") {
    await tx
      .update(orders)
      .set({ status: "REFUNDED" })
      .where(and(eq(orders.id, refund.orderId), eq(orders.status, "REFUND_REQUIRED")));
    await recordAuditLog(tx, {
      actorType: "SYSTEM",
      action: "PAYMENT_REFUND_COMPLETED",
      targetType: "order",
      targetId: refund.orderId,
      metadata: { refundId: refund.id, paymentId: refund.paymentId, reason: refund.reason },
    });
    return;
  }
  // ADMIN / CHARGEBACK: a PAID order is refunded and its commission
  // reversed (the ledger trigger requires the order to be REFUNDED first).
  const [locked] = await tx.select().from(orders).where(eq(orders.id, refund.orderId)).for("update").limit(1);
  if (!locked) throw new RefundWorkflowError(`Order ${refund.orderId} not found`);
  if (locked.status === "PAID") {
    await tx.update(orders).set({ status: "REFUNDED" }).where(eq(orders.id, locked.id));
  }
  await tx
    .insert(partnerLedgerEntries)
    .values({
      partnerId: locked.partnerId,
      orderId: locked.id,
      type: "COMMISSION_REVERSAL",
      amountMinor: -locked.partnerCommissionMinor,
      currency: locked.currency,
    })
    .onConflictDoNothing();
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: refund.requestedBy ?? undefined,
    action: refund.reason === "CHARGEBACK" ? "ORDER_CHARGED_BACK" : "ORDER_REFUNDED",
    targetType: "order",
    targetId: locked.id,
    metadata: {
      refundId: refund.id,
      partnerId: locked.partnerId,
      grossAmountMinor: locked.grossAmountMinor,
      commissionReversedMinor: locked.partnerCommissionMinor,
      currency: locked.currency,
    },
  });
}

/**
 * The money is back with the customer: mark the row COMPLETED and apply the
 * reason's bookkeeping in the same transaction. Idempotent: a COMPLETED row
 * returns without touching anything.
 */
export async function completeRefund(refundId: string, orderId: string): Promise<void> {
  const [refund] = await withPaymentActivation(orderId, (tx) =>
    tx.select().from(paymentRefunds).where(eq(paymentRefunds.id, refundId)).limit(1),
  );
  if (!refund) throw new RefundWorkflowError(`Refund ${refundId} not found`);
  if (refund.status === "COMPLETED") return;
  if (refund.status === "REJECTED") throw new RefundWorkflowError(`Refund ${refundId} was rejected`);

  if (refund.reason === "ADMIN" || refund.reason === "CHARGEBACK") {
    // The commission reversal needs an admin context (ledger RLS): it is booked
    // on behalf of the admin who asked for this refund.
    if (!refund.requestedBy) throw new RefundWorkflowError(`Refund ${refund.id} has no requesting admin`);
    await withAdminPaymentContext(refund.requestedBy, refund.orderId, (tx) => applyRefundCompletion(tx, refund));
  } else {
    await withPaymentActivation(refund.orderId, (tx) => applyRefundCompletion(tx, refund));
  }
}

/**
 * Settles every REQUESTED refund of an order against the provider's own
 * current state: completed → completeRefund; refused → REJECTED; unknown to
 * the provider and never acknowledged → re-sent with the same key. Called
 * from the provider callback, the return page and reconciliation.
 */
export async function reconcileOrderRefunds(orderId: string): Promise<{ completed: number; rejected: number; pending: number }> {
  const open = await withPaymentActivation(orderId, (tx) =>
    tx
      .select({ refund: paymentRefunds, payment: payments })
      .from(paymentRefunds)
      .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
      .where(and(eq(paymentRefunds.orderId, orderId), eq(paymentRefunds.status, "REQUESTED"))),
  );
  const counts = { completed: 0, rejected: 0, pending: 0 };
  if (open.length === 0) return counts;
  const provider = getPaymentProvider();

  for (const { refund, payment } of open) {
    if (payment.provider !== provider.key || !payment.providerPaymentId) {
      counts.pending++;
      continue;
    }
    const state = await provider.verifyPayment(payment.providerPaymentId);
    const r = state.refund;
    if (r && (r.status === "COMPLETED" || r.status === "PARTIAL") && r.refundedAmountMinor >= refund.amountMinor) {
      await completeRefund(refund.id, orderId);
      counts.completed++;
    } else if (r && refund.providerActionId && r.rejectedActionIds.includes(refund.providerActionId)) {
      await rejectRefund(refund, "PROVIDER_REJECTED");
      counts.rejected++;
    } else if (r && r.status === "NONE" && !refund.providerActionId) {
      // The provider has no record of it and never acknowledged it: re-send (same key).
      const outcome = await requestChargeRefund({ orderId, payment, reason: refund.reason as RefundReason, requestedBy: refund.requestedBy ?? undefined });
      if (outcome === "COMPLETED") counts.completed++;
      else if (outcome === "REQUESTED") counts.pending++;
      else counts.rejected++;
    } else {
      counts.pending++;
    }
  }
  return counts;
}

/**
 * The provider reports a refund on a charge for which QR Starr never
 * requested one (e.g. made by bank staff in the merchant portal). Nothing is
 * changed automatically; it is recorded for a person to reconcile.
 */
export async function recordExternalRefund(orderId: string, providerPaymentId: string, refundedAmountMinor: number): Promise<void> {
  await withPaymentActivation(orderId, async (tx) => {
    const [payment] = await tx.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.providerPaymentId, providerPaymentId))).limit(1);
    if (payment) {
      const [ours] = await tx.select({ id: paymentRefunds.id }).from(paymentRefunds).where(eq(paymentRefunds.paymentId, payment.id)).limit(1);
      if (ours) return;
    }
    await recordAuditLog(tx, {
      actorType: "SYSTEM",
      action: "PAYMENT_EXTERNAL_REFUND",
      targetType: "order",
      targetId: orderId,
      metadata: { providerPaymentId, refundedAmountMinor },
    });
  });
}

export class ChargebackError extends Error {
  constructor(
    readonly code: "ORDER_NOT_FOUND" | "ORDER_NOT_PAID" | "NO_CHARGE" | "REFUND_OPEN" | "ALREADY_RETURNED",
    message: string,
  ) {
    super(message);
    this.name = "ChargebackError";
  }
}

/**
 * Records a chargeback the bank has already executed (BOG plan §3.7,
 * recommended decision B5): the money has left through the card scheme, so
 * nothing is sent to the provider. In ONE admin transaction the order's
 * paying charge gets a CHARGEBACK refund row, which completes at once with the
 * same bookkeeping as an admin refund: charge + order REFUNDED, the order's
 * own snapshot commission reversed exactly once. A reversal of commission
 * already paid out is netted into the partner's next payout (CLAWBACK,
 * payouts.ts) — recommended decision B6. The greeting stays live.
 *
 * Refused when the order is not PAID, or the charge already has a refund open
 * or completed (returning the money twice is a dispute to contest with the
 * bank, not to book). Full amount only (payment_refunds_integrity).
 */
export async function recordChargeback(
  adminUserId: string,
  orderId: string,
  input: { reference: string; disputedOn: string; note?: string },
): Promise<{ refundId: string; commissionReversedMinor: number }> {
  return withAdminPaymentContext(adminUserId, orderId, async (tx) => {
    // The payment context alone would let this transaction open a refund row;
    // only a platform admin may book a chargeback (the ledger RLS backs this up).
    const [{ is_admin }] = (await tx.execute(sql`select app_is_admin() as is_admin`)) as unknown as [{ is_admin: boolean }];
    if (!is_admin) throw new RefundWorkflowError("Only a platform admin can record a chargeback");
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update").limit(1);
    if (!order) throw new ChargebackError("ORDER_NOT_FOUND", `Order ${orderId} not found`);
    if (order.status !== "PAID") throw new ChargebackError("ORDER_NOT_PAID", `Order ${orderId} is ${order.status}; only a PAID order can be charged back`);

    // The charge that paid the order: the first confirmed SUCCEEDED one.
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, orderId), eq(payments.status, "SUCCEEDED")))
      .orderBy(sql`confirmed_at asc nulls last`)
      .limit(1);
    if (!payment) throw new ChargebackError("NO_CHARGE", `Order ${orderId} has no succeeded charge`);

    const [existing] = await tx
      .select({ status: paymentRefunds.status })
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.paymentId, payment.id), ne(paymentRefunds.status, "REJECTED")))
      .limit(1);
    if (existing?.status === "REQUESTED") {
      throw new ChargebackError("REFUND_OPEN", "A refund for this charge is already with the provider: resolve it with the bank before recording a chargeback");
    }
    if (existing) throw new ChargebackError("ALREADY_RETURNED", "This charge has already been refunded");

    const [refund] = await tx
      .insert(paymentRefunds)
      .values({
        paymentId: payment.id,
        orderId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        reason: "CHARGEBACK",
        requestedBy: adminUserId,
        providerActionId: input.reference,
        providerCode: "CHARGEBACK",
      })
      .returning();
    await recordAuditLog(tx, {
      actorType: "ADMIN",
      actorId: adminUserId,
      action: "PAYMENT_CHARGEBACK_RECORDED",
      targetType: "order",
      targetId: orderId,
      metadata: {
        refundId: refund!.id,
        paymentId: payment.id,
        reference: input.reference,
        disputedOn: input.disputedOn,
        ...(input.note ? { note: input.note } : {}),
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      },
    });
    await applyRefundCompletion(tx, refund!);
    return { refundId: refund!.id, commissionReversedMinor: order.partnerCommissionMinor };
  });
}

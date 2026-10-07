import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withEditableGreeting, withPaymentActivation, withAdminContext, withAdminPaymentContext } from "@/db/client";
import { recordAuditLog } from "@/lib/audit";
import { orders, payments, partnerLedgerEntries, greetings, qrCodes } from "@/db/schema";
import { verifyGreetingEditAccess } from "@/lib/greetings/access";
import { publicEnv } from "@/lib/env.public";
import { resolveActivePrice, splitCommission, getPartnerCommissionRateBps } from "./pricing";
import { getPaymentProvider } from "./provider-factory";
import { sanitizeProviderMetadata, ProviderNotImplementedError, type PaymentProviderKey } from "./types";
import { getPurchaseBlocker, type PurchaseBlocker } from "./eligibility";
import { logServerError } from "@/lib/log";
import { recordAnalyticsEvent } from "@/lib/analytics";

type Order = typeof orders.$inferSelect;

/** Where a redirect-based provider sends the browser back — see CreatePaymentInput.returnUrls doc comment: never treated as proof of payment on its own. */
function buildReturnUrls(qrPublicToken: string): { success: string; cancel: string } {
  const base = `${publicEnv.NEXT_PUBLIC_APP_URL}/g/${qrPublicToken}`;
  return { success: `${base}?step=checkout&payment=return`, cancel: `${base}?step=checkout&payment=cancelled` };
}

export class CheckoutError extends Error {}
export class PaymentConfirmationError extends Error {}

/** A provider reported success for a different amount/currency than the order's snapshot. Never applied; audited. */
export class AmountMismatchError extends PaymentConfirmationError {
  constructor(
    orderId: string,
    readonly detail: Record<string, string | number>,
  ) {
    super(
      `Payment amount/currency (${detail.reportedAmountMinor} ${detail.reportedCurrency}) does not match order ${orderId} (${detail.expectedAmountMinor} ${detail.expectedCurrency})`,
    );
  }
}

/** Postgres unique violation (23505) on a named constraint/index — through drizzle's error wrapper or directly. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e = err as { code?: string; constraint_name?: string; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    if (e.code === "23505" && e.constraint_name === constraint) return true;
  }
  return false;
}

/**
 * Records a payment anomaly in the audit log, in its own transaction (the
 * caller's has been, or will be, rolled back). Ids and amounts only — never
 * provider payloads, tokens or greeting content. Read back by
 * findPaymentAnomalies (reconciliation).
 */
async function recordPaymentAnomaly(orderId: string, action: string, metadata: Record<string, unknown>) {
  await withPaymentActivation(orderId, (tx) =>
    recordAuditLog(tx, { actorType: "SYSTEM", action, targetType: "order", targetId: orderId, metadata }),
  ).catch((err) => logServerError("recordPaymentAnomaly", err, { orderId, action }));
}

/**
 * Sender-facing checkout entry point (Phase 0.5 §2/§6). Pricing and partner
 * attribution are resolved and snapshotted here, server-side only — never
 * accepted from the request body. Requires a valid edit token for the
 * greeting being checked out (verifyGreetingEditAccess), which is what
 * authorizes writing the order — see RLS policy orders_insert_by_token.
 */
export async function startCheckout(input: {
  greetingId: string;
  editToken: string;
  productId: string;
}): Promise<{ order: Order; redirectUrl?: string }> {
  const greeting = await verifyGreetingEditAccess(input.greetingId, input.editToken);

  const { order, qrPublicToken } = await withEditableGreeting(input.greetingId, async (tx) => {
    const [qr] = await tx
      .select({ id: qrCodes.id, partnerId: qrCodes.partnerId, publicToken: qrCodes.publicToken })
      .from(qrCodes)
      .where(eq(qrCodes.id, greeting.qrCodeId))
      .limit(1);
    if (!qr) throw new CheckoutError("QR code not found for greeting");

    const price = await resolveActivePrice(tx, input.productId, qr.partnerId);
    const commissionRateBps = await getPartnerCommissionRateBps(tx, qr.partnerId);
    const { partnerCommissionMinor, platformShareMinor } = splitCommission(
      price.amountMinor,
      commissionRateBps,
    );

    const [created] = await tx
      .insert(orders)
      .values({
        greetingId: input.greetingId,
        qrCodeId: qr.id,
        partnerId: qr.partnerId,
        productId: input.productId,
        priceId: price.id,
        currency: price.currency,
        grossAmountMinor: price.amountMinor,
        partnerCommissionMinor,
        platformShareMinor,
        commissionRateBps,
        status: "PENDING_PAYMENT",
      })
      .returning();

    if (!created) throw new CheckoutError("Failed to create order");
    return { order: created, qrPublicToken: qr.publicToken };
  });

  const redirectUrl = await createPaymentAttempt(order, qrPublicToken);
  return { order, redirectUrl };
}

/**
 * Creates one provider-side payment attempt (a new `payments` row) for an
 * order that already exists — shared by startCheckout (the first attempt)
 * and by getOrCreateCheckoutOrder's re-entry path (Phase 5 §5): a customer
 * who leaves Checkout before completing and comes back gets a fresh
 * provider session rather than a possibly-expired old redirect URL. Always
 * outside any DB transaction — an external network call has no business
 * holding a Postgres transaction open.
 */
export async function createPaymentAttempt(order: Order, qrPublicToken: string): Promise<string | undefined> {
  const provider = getPaymentProvider();
  const paymentAttempt = await provider.createPayment({
    orderId: order.id,
    amountMinor: order.grossAmountMinor,
    currency: order.currency,
    returnUrls: buildReturnUrls(qrPublicToken),
  });

  await withPaymentActivation(order.id, (tx) =>
    tx.insert(payments).values({
      orderId: order.id,
      provider: provider.key,
      providerPaymentId: paymentAttempt.providerPaymentId,
      amountMinor: order.grossAmountMinor,
      currency: order.currency,
      status: "PENDING",
      providerMetadata: sanitizeProviderMetadata(paymentAttempt.metadata),
    }),
  );

  return paymentAttempt.redirectUrl;
}

/**
 * Authoritative payment-success handler (Phase 0.5 §2/§3/§4/§5). Called only
 * from a verified webhook/provider callback — NEVER from a client-supplied
 * "paymentSuccessful=true" flag. Idempotent at three layers:
 *   1. row-locks the order and short-circuits if already PAID
 *   2. upserts the payment row keyed by (provider, providerPaymentId)
 *   3. the DB partial unique index on (order_id) WHERE type='COMMISSION_EARNED'
 *      makes a second ledger insert a no-op even under a genuine race
 *
 * Deliberately COMMITS as its own transaction, separate from activation
 * (activatePaidOrder below) — money-captured must be durable even if
 * activation fails afterward, so the customer is never asked to pay twice.
 *
 * Eligibility is re-checked here, under a lock on the greeting row
 * (migrations/0011): a payment can arrive after the greeting was blocked by
 * moderation, after its partner was suspended, or for a greeting with no
 * message. The captured payment is still recorded truthfully (SUCCEEDED),
 * but the order becomes REFUND_REQUIRED instead of PAID — no commission is
 * booked and nothing is activated. Callers must then call
 * refundIneligiblePayment (outcome "REFUND_REQUIRED").
 *
 * Every charge the provider confirms is recorded truthfully and ends in
 * exactly one place — it is never dropped:
 *   - the charge that pays this order (PAID, one commission);
 *   - a replay of a charge already recorded (alreadyProcessed, no change);
 *   - a DIFFERENT charge for an order that is already settled (paid, or
 *     routed to refund) — e.g. a customer who paid in two tabs. It is
 *     recorded SUCCEEDED and returned as outcome "DUPLICATE_CAPTURE"; callers
 *     must call refundCapturedPayment(orderId, paymentId);
 *   - a success for an order whose greeting is already PAID through another
 *     order (orders_one_paid_per_greeting refuses PAID): the order becomes
 *     REFUND_REQUIRED, exactly like an ineligible greeting;
 *   - a success that arrives after the order was closed as FAILED or CANCELED
 *     (a late provider confirmation): recorded and returned — REFUND_REQUIRED.
 *     A failed payment never earns commission or activates anything, and the
 *     customer was already told the payment did not go through.
 * A success for the wrong amount/currency is refused (AmountMismatchError)
 * and recorded in the audit log for reconciliation.
 */
export async function confirmPaymentSuccess(input: {
  provider: PaymentProviderKey;
  providerPaymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  alreadyProcessed: boolean;
  order: Order;
  outcome: "PAID" | "REFUND_REQUIRED" | "DUPLICATE_CAPTURE";
  blocker?: PurchaseBlocker | "ALREADY_PAID" | "ORDER_CLOSED";
  /** The recorded charge, for a DUPLICATE_CAPTURE (to refund). */
  paymentId?: string;
}> {
  try {
    return await confirmPaymentSuccessTx(input);
  } catch (err) {
    if (err instanceof AmountMismatchError) await recordPaymentAnomaly(input.orderId, "PAYMENT_AMOUNT_MISMATCH", err.detail);
    throw err;
  }
}

async function confirmPaymentSuccessTx(input: Parameters<typeof confirmPaymentSuccess>[0]): ReturnType<typeof confirmPaymentSuccess> {
  return withPaymentActivation(input.orderId, async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update")
      .limit(1);
    if (!order) throw new PaymentConfirmationError(`Order ${input.orderId} not found`);

    if (order.status === "PARTIALLY_REFUNDED") {
      throw new PaymentConfirmationError(`Order ${input.orderId} is ${order.status}, not eligible for payment confirmation`);
    }

    // A real provider's claimed amount/currency must match this order's own
    // authoritative snapshot exactly — never trust a webhook/verification
    // payload's numbers on their own (Phase 5 §10 "wrong amount/currency
    // rejected"). Checked for every status: a mismatching "success" is never
    // recorded as money received for this order.
    if (input.amountMinor !== order.grossAmountMinor || input.currency !== order.currency) {
      throw new AmountMismatchError(input.orderId, {
        provider: input.provider,
        providerPaymentId: input.providerPaymentId,
        reportedAmountMinor: input.amountMinor,
        reportedCurrency: input.currency,
        expectedAmountMinor: order.grossAmountMinor,
        expectedCurrency: order.currency,
      });
    }

    const [existingPayment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, input.provider), eq(payments.providerPaymentId, input.providerPaymentId)))
      .limit(1);

    // A payment row already exists for this (provider, providerPaymentId)
    // but belongs to a DIFFERENT order — never let a webhook's claimed
    // orderId hijack someone else's payment attempt (Phase 5 §10 "provider
    // payment/order mismatch rejected").
    if (existingPayment && existingPayment.orderId !== input.orderId) {
      throw new PaymentConfirmationError(
        `Payment ${input.providerPaymentId} belongs to order ${existingPayment.orderId}, not ${input.orderId}`,
      );
    }

    const sanitizedMetadata = sanitizeProviderMetadata(input.metadata ?? {});

    // Records this charge as SUCCEEDED (the PENDING attempt row, or a new row
    // if the provider confirms a charge we never saw start) and returns its id.
    const recordCharge = async (): Promise<string> => {
      if (existingPayment) {
        if (existingPayment.status === "PENDING" || existingPayment.status === "FAILED") {
          await tx
            .update(payments)
            .set({ status: "SUCCEEDED", confirmedAt: sql`now()`, providerMetadata: sanitizedMetadata })
            .where(eq(payments.id, existingPayment.id));
        }
        return existingPayment.id;
      }
      const [inserted] = await tx
        .insert(payments)
        .values({
          orderId: input.orderId,
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: "SUCCEEDED",
          confirmedAt: sql`now()`,
          providerMetadata: sanitizedMetadata,
        })
        .returning({ id: payments.id });
      return inserted!.id;
    };

    // Already settled (paid, or routed to refund): a replay of a charge we
    // have recorded changes nothing; any OTHER charge is a duplicate capture.
    if (order.status === "PAID" || order.status === "REFUND_REQUIRED" || order.status === "REFUNDED") {
      const settledOutcome = order.status === "PAID" ? ("PAID" as const) : ("REFUND_REQUIRED" as const);
      if (existingPayment && (existingPayment.status === "SUCCEEDED" || existingPayment.status === "REFUNDED")) {
        return { alreadyProcessed: true, order, outcome: settledOutcome };
      }
      const paymentId = await recordCharge();
      await recordAuditLog(tx, {
        actorType: "SYSTEM",
        action: "PAYMENT_DUPLICATE_CAPTURE",
        targetType: "order",
        targetId: order.id,
        metadata: { provider: input.provider, providerPaymentId: input.providerPaymentId, paymentId, orderStatus: order.status, amountMinor: input.amountMinor, currency: input.currency },
      });
      return { alreadyProcessed: false, order, outcome: "DUPLICATE_CAPTURE" as const, paymentId };
    }

    // Locked until this transaction commits — a concurrent moderation block
    // waits for the payment decision rather than slipping in underneath it.
    const blocker = await getPurchaseBlocker(tx, order.greetingId, { lock: true });

    await recordCharge();

    const routeToRefund = async (reason: PurchaseBlocker | "ALREADY_PAID" | "ORDER_CLOSED") => {
      const [refundOrder] = await tx
        .update(orders)
        .set({ status: "REFUND_REQUIRED" })
        .where(eq(orders.id, order.id))
        .returning();
      if (!refundOrder) throw new PaymentConfirmationError("Failed to mark order REFUND_REQUIRED");
      return { alreadyProcessed: false, order: refundOrder, outcome: "REFUND_REQUIRED" as const, blocker: reason };
    };

    if (order.status === "FAILED" || order.status === "CANCELED") return routeToRefund("ORDER_CLOSED");
    if (blocker) return routeToRefund(blocker);

    // PAID inside a savepoint: if the greeting is already PAID through another
    // order, orders_one_paid_per_greeting refuses — the database is the
    // authority here (this context cannot see the greeting's other orders),
    // and the unique check waits for a concurrent competitor to commit.
    let paidOrder: Order | undefined;
    try {
      paidOrder = await tx.transaction(async (sp) => {
        const [row] = await sp
          .update(orders)
          .set({ status: "PAID", paidAt: sql`now()` })
          .where(eq(orders.id, order.id))
          .returning();
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err, "orders_one_paid_per_greeting")) return routeToRefund("ALREADY_PAID");
      throw err;
    }
    if (!paidOrder) throw new PaymentConfirmationError("Failed to mark order PAID");

    await tx
      .insert(partnerLedgerEntries)
      .values({
        partnerId: order.partnerId,
        orderId: order.id,
        type: "COMMISSION_EARNED",
        amountMinor: order.partnerCommissionMinor,
        currency: order.currency,
      })
      .onConflictDoNothing();

    return { alreadyProcessed: false, order: paidOrder, outcome: "PAID" as const };
  });
}

/**
 * Returns a payment captured for an ineligible greeting (an order in
 * REFUND_REQUIRED, see confirmPaymentSuccess) through the provider that took
 * it. Idempotent: a REFUNDED order is left alone, and the order only moves to
 * REFUNDED once the provider itself reports the full amount refunded.
 *
 * TEST refunds deterministically. A real provider whose refundPayment is not
 * implemented yet (BOG today — see providers/bog-provider.ts) leaves the
 * order in REFUND_REQUIRED — orders in that status are the manual-refund
 * queue until that adapter's refund call exists. The payment is never
 * marked REFUNDED without the provider confirming it.
 */
export async function refundIneligiblePayment(orderId: string): Promise<{ status: "REFUNDED" | "REFUND_REQUIRED" }> {
  const [order] = await withPaymentActivation(orderId, (tx) => tx.select().from(orders).where(eq(orders.id, orderId)).limit(1));
  if (!order) throw new PaymentConfirmationError(`Order ${orderId} not found`);
  if (order.status === "REFUNDED") return { status: "REFUNDED" };
  if (order.status !== "REFUND_REQUIRED") {
    throw new PaymentConfirmationError(`Order ${orderId} is ${order.status}, not awaiting a refund`);
  }

  const [payment] = await withPaymentActivation(orderId, (tx) =>
    tx.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "SUCCEEDED"))).limit(1),
  );
  const provider = getPaymentProvider();
  if (!payment?.providerPaymentId || payment.provider !== provider.key) {
    logServerError("refundIneligiblePayment", new Error("No refundable payment through the configured provider"), { orderId });
    return { status: "REFUND_REQUIRED" };
  }

  try {
    const result = await provider.refundPayment(payment.providerPaymentId, payment.amountMinor, refundIdempotencyKey(payment.id));
    if (result.status !== "REFUNDED" || result.refundedAmountMinor !== payment.amountMinor) {
      logServerError("refundIneligiblePayment", new Error(`Provider refund ${result.status} for ${result.refundedAmountMinor}`), { orderId });
      return { status: "REFUND_REQUIRED" };
    }
  } catch (err) {
    // ProviderNotImplementedError: the real provider's refund API isn't
    // integrated yet — the order stays queued for a manual refund.
    logServerError("refundIneligiblePayment", err, { orderId, notImplemented: err instanceof ProviderNotImplementedError });
    return { status: "REFUND_REQUIRED" };
  }

  await withPaymentActivation(orderId, async (tx) => {
    await tx.update(payments).set({ status: "REFUNDED" }).where(and(eq(payments.id, payment.id), eq(payments.status, "SUCCEEDED")));
    await tx.update(orders).set({ status: "REFUNDED" }).where(and(eq(orders.id, orderId), eq(orders.status, "REFUND_REQUIRED")));
  });
  return { status: "REFUNDED" };
}

export class RefundError extends Error {}

/**
 * Full refund of a PAID order (admin-initiated). The ledger is append-only,
 * so the original COMMISSION_EARNED row stays and a COMMISSION_REVERSAL for
 * the exact negated snapshot amount is booked next to it. A reversal after
 * the commission was already paid out simply leaves the partner's balance
 * negative, which later earnings net off (lib/payments/payouts.ts).
 *
 * Order of operations: the provider refund happens first, outside any
 * transaction; only after the provider confirms the full amount does one
 * transaction mark payment + order REFUNDED and book the reversal. If the
 * provider refuses, nothing changes and the order stays PAID. Idempotent: a
 * REFUNDED order returns alreadyRefunded, and the partial unique index
 * partner_ledger_one_reversal_per_order makes a second reversal impossible.
 *
 * Partial refunds are not supported (no business rule for proportional
 * commission exists); the DB rejects a reversal for any order not REFUNDED.
 * The greeting/QR lifecycle is deliberately untouched — refunding money and
 * taking a greeting offline are separate decisions (moderation does the latter).
 */
export async function refundPaidOrder(adminUserId: string, orderId: string): Promise<{ alreadyRefunded: boolean }> {
  const { order, payment } = await withAdminPaymentContext(adminUserId, orderId, async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const [p] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, orderId), eq(payments.status, "SUCCEEDED")))
      // The charge that paid the order is the first confirmed; a later one is
      // a duplicate capture, refunded on its own (refundCapturedPayment).
      .orderBy(sql`confirmed_at asc nulls last`)
      .limit(1);
    return { order: o, payment: p };
  });
  if (!order) throw new RefundError(`Order ${orderId} not found`);
  if (order.status === "REFUNDED") return { alreadyRefunded: true };
  if (order.status !== "PAID") throw new RefundError(`Order ${orderId} is ${order.status}, only a PAID order can be refunded`);

  const provider = getPaymentProvider();
  if (!payment?.providerPaymentId || payment.provider !== provider.key) {
    throw new RefundError(`Order ${orderId} has no succeeded payment through the configured provider`);
  }
  const result = await provider.refundPayment(payment.providerPaymentId, payment.amountMinor, refundIdempotencyKey(payment.id));
  if (result.status !== "REFUNDED" || result.refundedAmountMinor !== payment.amountMinor) {
    throw new RefundError(`Provider refund ${result.status} for ${result.refundedAmountMinor} of ${payment.amountMinor}`);
  }

  return withAdminPaymentContext(adminUserId, orderId, async (tx) => {
    const [locked] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update").limit(1);
    if (!locked) throw new RefundError(`Order ${orderId} not found`);
    if (locked.status === "REFUNDED") return { alreadyRefunded: true };
    if (locked.status !== "PAID") throw new RefundError(`Order ${orderId} is ${locked.status}, only a PAID order can be refunded`);

    await tx.update(payments).set({ status: "REFUNDED" }).where(and(eq(payments.id, payment.id), eq(payments.status, "SUCCEEDED")));
    await tx.update(orders).set({ status: "REFUNDED" }).where(eq(orders.id, orderId));
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
      actorId: adminUserId,
      action: "ORDER_REFUNDED",
      targetType: "order",
      targetId: locked.id,
      metadata: { partnerId: locked.partnerId, grossAmountMinor: locked.grossAmountMinor, commissionReversedMinor: locked.partnerCommissionMinor, currency: locked.currency },
    });
    return { alreadyRefunded: false };
  });
}

/**
 * One refund per charge: the key a provider adapter forwards as its refund
 * idempotency key, so two concurrent or retried refund requests for the same
 * charge can never return the money twice at the provider.
 */
function refundIdempotencyKey(paymentId: string): string {
  return `refund-${paymentId}`;
}

/**
 * Returns a duplicate capture (confirmPaymentSuccess outcome
 * "DUPLICATE_CAPTURE": a second charge for an already-settled order) to the
 * customer. The order, its commission and the greeting are untouched — this
 * charge was never applied to anything. Idempotent: a charge already REFUNDED
 * is left alone; it is marked REFUNDED only once the provider confirms the
 * full amount. If the provider cannot refund (or its refund API is not
 * integrated yet), the charge stays SUCCEEDED and is listed by
 * findPaymentAnomalies as DUPLICATE_CAPTURE until it is resolved.
 */
export async function refundCapturedPayment(orderId: string, paymentId: string): Promise<{ status: "REFUNDED" | "REFUND_PENDING" }> {
  const [payment] = await withPaymentActivation(orderId, (tx) => tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.orderId, orderId))).limit(1));
  if (!payment) throw new PaymentConfirmationError(`Payment ${paymentId} not found for order ${orderId}`);
  if (payment.status === "REFUNDED") return { status: "REFUNDED" };
  if (payment.status !== "SUCCEEDED" || !payment.providerPaymentId) {
    throw new PaymentConfirmationError(`Payment ${paymentId} is ${payment.status}, nothing to refund`);
  }
  const provider = getPaymentProvider();
  if (payment.provider !== provider.key) {
    logServerError("refundCapturedPayment", new Error("Charge was taken by a provider that is not configured"), { orderId, paymentId });
    return { status: "REFUND_PENDING" };
  }
  try {
    const result = await provider.refundPayment(payment.providerPaymentId, payment.amountMinor, refundIdempotencyKey(payment.id));
    if (result.status !== "REFUNDED" || result.refundedAmountMinor !== payment.amountMinor) {
      logServerError("refundCapturedPayment", new Error(`Provider refund ${result.status} for ${result.refundedAmountMinor}`), { orderId, paymentId });
      return { status: "REFUND_PENDING" };
    }
  } catch (err) {
    logServerError("refundCapturedPayment", err, { orderId, paymentId, notImplemented: err instanceof ProviderNotImplementedError });
    return { status: "REFUND_PENDING" };
  }
  await withPaymentActivation(orderId, async (tx) => {
    await tx.update(payments).set({ status: "REFUNDED" }).where(and(eq(payments.id, payment.id), eq(payments.status, "SUCCEEDED")));
    await recordAuditLog(tx, { actorType: "SYSTEM", action: "PAYMENT_DUPLICATE_REFUNDED", targetType: "order", targetId: orderId, metadata: { paymentId, amountMinor: payment.amountMinor, currency: payment.currency } });
  });
  return { status: "REFUNDED" };
}

/**
 * Applies whatever confirmPaymentSuccess decided — the one place that turns
 * its outcome into refunds or activation, shared by the webhook route,
 * provider reconciliation and the TEST simulation, so every path to "paid"
 * behaves the same. Records PAYMENT_SUCCEEDED (once: not for a replay) and
 * QR_ACTIVATED.
 */
export async function settleConfirmedPayment(
  confirmation: Awaited<ReturnType<typeof confirmPaymentSuccess>>,
): Promise<{ status: Order["status"]; activated: boolean; duplicateRefund?: "REFUNDED" | "REFUND_PENDING" }> {
  const { order, outcome } = confirmation;
  if (outcome === "DUPLICATE_CAPTURE") {
    const { status } = await refundCapturedPayment(order.id, confirmation.paymentId!);
    return { status: order.status, activated: false, duplicateRefund: status };
  }
  if (outcome === "REFUND_REQUIRED") {
    if (confirmation.alreadyProcessed && order.status === "REFUNDED") return { status: "REFUNDED", activated: false };
    const { status } = await refundIneligiblePayment(order.id);
    return { status, activated: false };
  }
  if (!confirmation.alreadyProcessed) {
    await recordAnalyticsEvent({ eventType: "PAYMENT_SUCCEEDED", orderId: order.id, greetingId: order.greetingId }, { partnerId: order.partnerId });
  }
  const { activated } = await activatePaidOrder(order.id);
  if (activated) {
    await recordAnalyticsEvent({ eventType: "QR_ACTIVATED", qrCodeId: order.qrCodeId, greetingId: order.greetingId }, { partnerId: order.partnerId });
  }
  return { status: "PAID", activated };
}

/**
 * A provider reported a payment attempt FAILED. The attempt is marked FAILED
 * (never a charge that already SUCCEEDED — an out-of-order failure after a
 * success changes nothing), and the order becomes FAILED only if it has no
 * other attempt still pending. No commission, no activation. A success that
 * arrives later is still honoured (confirmPaymentSuccess).
 */
export async function recordProviderFailure(input: { provider: PaymentProviderKey; providerPaymentId: string; orderId: string }): Promise<{ orderStatus: Order["status"] }> {
  return withPaymentActivation(input.orderId, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update").limit(1);
    if (!order) throw new PaymentConfirmationError(`Order ${input.orderId} not found`);
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, input.provider), eq(payments.providerPaymentId, input.providerPaymentId)))
      .limit(1);
    if (!payment || payment.orderId !== input.orderId) {
      throw new PaymentConfirmationError(`Payment ${input.providerPaymentId} does not belong to order ${input.orderId}`);
    }
    if (payment.status === "PENDING") {
      await tx.update(payments).set({ status: "FAILED" }).where(eq(payments.id, payment.id));
    }
    if (order.status !== "PENDING_PAYMENT") return { orderStatus: order.status };
    const [stillPending] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, "PENDING")))
      .limit(1);
    if (stillPending) return { orderStatus: order.status };
    await tx.update(orders).set({ status: "FAILED" }).where(and(eq(orders.id, order.id), eq(orders.status, "PENDING_PAYMENT")));
    return { orderStatus: "FAILED" as const };
  });
}

/**
 * Flips greeting + QR to ACTIVE for an already-PAID order. Safe to call
 * repeatedly (idempotent — matches 0 rows if already ACTIVE, per
 * greetings_activate_by_payment's USING clause) and safe to retry after a
 * transient failure, per Phase 0.5 §4's "payment succeeds, activation fails"
 * requirement: this is intentionally a SEPARATE call from
 * confirmPaymentSuccess, not folded into the same transaction.
 */
export async function activatePaidOrder(orderId: string): Promise<{ activated: boolean }> {
  return withPaymentActivation(orderId, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw new PaymentConfirmationError(`Order ${orderId} not found`);
    if (order.status !== "PAID") {
      throw new PaymentConfirmationError(`Order ${orderId} is not PAID (status=${order.status})`);
    }

    // Greeting first — the qr_codes activation-invariant trigger requires an
    // already-ACTIVE greeting to exist before qr_codes can become ACTIVE.
    const activatedGreetings = await tx
      .update(greetings)
      .set({ status: "ACTIVE", activatedAt: sql`now()` })
      .where(and(eq(greetings.id, order.greetingId), eq(greetings.status, "DRAFT")))
      .returning({ id: greetings.id });

    const activatedQr = await tx
      .update(qrCodes)
      .set({ status: "ACTIVE", activatedAt: sql`now()` })
      .where(and(eq(qrCodes.id, order.qrCodeId), eq(qrCodes.status, "DRAFT")))
      .returning({ id: qrCodes.id });

    return { activated: activatedGreetings.length > 0 || activatedQr.length > 0 };
  });
}

export async function markPaymentFailed(orderId: string): Promise<void> {
  await withPaymentActivation(orderId, (tx) =>
    tx
      .update(orders)
      .set({ status: "FAILED" })
      .where(and(eq(orders.id, orderId), eq(orders.status, "PENDING_PAYMENT"))),
  );
}

export class ReconciliationError extends Error {}

/**
 * Provider-truth reconciliation (Phase 5 §5/§8) — asks the PROVIDER what a
 * payment's real status is, rather than trusting a browser return or an
 * admin's say-so. This is the one and only path by which a PENDING_PAYMENT
 * order can become PAID outside a webhook: it re-derives amount/currency
 * from the order itself (never from the provider's claim alone — see the
 * mismatch check below) and always goes through the same
 * confirmPaymentSuccess/activatePaidOrder functions a webhook would use, so
 * there is exactly one path to "PAID", not a second parallel one.
 *
 * Used by both the customer-facing return page (polling after a redirect)
 * and by an admin's manual "check payment status" action — deliberately the
 * same function, so there is no separate "admin can just mark this paid"
 * capability anywhere in the codebase.
 */
export async function verifyAndReconcileOrder(
  orderId: string,
): Promise<{ status: Order["status"]; activated: boolean }> {
  // orders has no public-read RLS policy — orders_select_by_payment_service
  // (migrations/0004) is what grants this read, scoped to exactly this order id.
  const [order] = await withPaymentActivation(orderId, (tx) => tx.select().from(orders).where(eq(orders.id, orderId)).limit(1));
  if (!order) throw new ReconciliationError(`Order ${orderId} not found`);

  if (order.status !== "PENDING_PAYMENT") {
    // Already resolved (PAID/FAILED/CANCELED/etc) — nothing to reconcile,
    // and re-deriving activation state is activatePaidOrder's job, not this
    // function's, so it's deliberately not called from here for a non-PENDING order.
    return { status: order.status, activated: false };
  }

  const [pendingPayment] = await withPaymentActivation(orderId, (tx) =>
    tx.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "PENDING"))).orderBy(sql`created_at desc`).limit(1),
  );
  if (!pendingPayment?.providerPaymentId) {
    // The order looked PENDING_PAYMENT a moment ago (the read above), but
    // there's no unlocked PENDING payment row anymore — a concurrent caller
    // (e.g. a webhook arriving mid-poll) may have already confirmed it in
    // the gap between these two reads. Re-check the order directly: if it
    // has since resolved, that's a race this call simply lost, not an error.
    const [recheck] = await withPaymentActivation(orderId, (tx) => tx.select().from(orders).where(eq(orders.id, orderId)).limit(1));
    if (recheck && recheck.status !== "PENDING_PAYMENT") {
      return { status: recheck.status, activated: false };
    }
    throw new ReconciliationError(`Order ${orderId} has no pending payment attempt to verify`);
  }

  const provider = getPaymentProvider();
  const verification = await provider.verifyPayment(pendingPayment.providerPaymentId);

  if (verification.status === "PENDING") {
    return { status: "PENDING_PAYMENT", activated: false };
  }

  if (verification.status === "FAILED") {
    const { orderStatus } = await recordProviderFailure({ provider: provider.key, providerPaymentId: pendingPayment.providerPaymentId, orderId });
    return { status: orderStatus, activated: false };
  }

  // SUCCEEDED — cross-check the provider's own numbers against the order's
  // authoritative snapshot before ever calling confirmPaymentSuccess. A
  // provider (or a compromised/misbehaving one) claiming success for the
  // wrong amount/currency must never activate anything.
  if (verification.amountMinor !== order.grossAmountMinor || verification.currency !== order.currency) {
    await recordPaymentAnomaly(orderId, "PAYMENT_AMOUNT_MISMATCH", {
      provider: provider.key,
      providerPaymentId: verification.providerPaymentId,
      reportedAmountMinor: verification.amountMinor,
      reportedCurrency: verification.currency,
      expectedAmountMinor: order.grossAmountMinor,
      expectedCurrency: order.currency,
    });
    throw new ReconciliationError(
      `Provider-reported amount/currency (${verification.amountMinor} ${verification.currency}) does not match order ${orderId} (${order.grossAmountMinor} ${order.currency})`,
    );
  }

  const confirmation = await confirmPaymentSuccess({
    provider: provider.key,
    providerPaymentId: verification.providerPaymentId,
    orderId,
    amountMinor: verification.amountMinor,
    currency: verification.currency,
    metadata: verification.metadata,
  });
  const { status, activated } = await settleConfirmedPayment(confirmation);
  return { status, activated };
}

export type PaymentAnomalyKind =
  | "CAPTURED_NOT_APPLIED"
  | "DUPLICATE_CAPTURE"
  | "REFUND_PENDING"
  | "PAID_WITHOUT_CHARGE"
  | "PAID_NOT_ACTIVATED"
  | "COMMISSION_MISSING"
  | "COMMISSION_NOT_REVERSED"
  | "STALE_PENDING"
  | "AMOUNT_MISMATCH";

/**
 * Reconciliation report (provider-independent): every place where money and
 * QR Starr's records disagree, or could. Read-only; admin-only (RLS admin
 * context). Each kind names what to do:
 *
 * - CAPTURED_NOT_APPLIED  a SUCCEEDED charge on an order that is not paid
 *                         (pending/failed/canceled) — re-run confirmation
 * - DUPLICATE_CAPTURE     a settled order holding a second unrefunded charge
 *                         — refundCapturedPayment
 * - REFUND_PENDING        REFUND_REQUIRED orders: money to return (manual
 *                         queue while the provider refund API is missing)
 * - PAID_WITHOUT_CHARGE   a PAID order with no SUCCEEDED/REFUNDED charge — investigate
 * - PAID_NOT_ACTIVATED    PAID, greeting still DRAFT — activatePaidOrder
 * - COMMISSION_MISSING    PAID without its COMMISSION_EARNED — investigate
 * - COMMISSION_NOT_REVERSED  REFUNDED with an earned, unreversed commission
 * - STALE_PENDING         an attempt pending > 30 min (missed webhook?) —
 *                         verifyAndReconcileOrder asks the provider
 * - AMOUNT_MISMATCH       a provider success refused for amount/currency (30 days)
 *
 * What the provider itself recorded (a charge QR Starr never heard of) needs
 * the provider's transaction listing — see docs/PAYMENTS.md.
 */
export async function findPaymentAnomalies(adminUserId: string): Promise<{ kind: PaymentAnomalyKind; orderId: string; detail: string }[]> {
  return withAdminContext(adminUserId, async (tx) => {
    const rows = await tx.execute<{ kind: PaymentAnomalyKind; order_id: string; detail: string }>(sql`
      select 'CAPTURED_NOT_APPLIED' as kind, o.id::text as order_id, 'order ' || o.status || ', charge ' || p.provider || ':' || p.provider_payment_id as detail
        from payments p join orders o on o.id = p.order_id
       where p.status = 'SUCCEEDED' and o.status in ('PENDING_PAYMENT', 'FAILED', 'CANCELED')
      union all
      select 'DUPLICATE_CAPTURE', o.id::text, count(*) || ' unrefunded charges on a ' || o.status || ' order'
        from orders o join payments p on p.order_id = o.id and p.status = 'SUCCEEDED'
       where o.status in ('PAID', 'REFUNDED')
       group by o.id, o.status
      having (o.status = 'PAID' and count(*) > 1) or o.status = 'REFUNDED'
      union all
      select 'REFUND_PENDING', o.id::text, o.gross_amount_minor || ' ' || o.currency || ' to return'
        from orders o where o.status = 'REFUND_REQUIRED'
      union all
      select 'PAID_WITHOUT_CHARGE', o.id::text, 'no SUCCEEDED/REFUNDED charge recorded'
        from orders o
       where o.status = 'PAID' and not exists (select 1 from payments p where p.order_id = o.id and p.status in ('SUCCEEDED', 'REFUNDED'))
      union all
      select 'PAID_NOT_ACTIVATED', o.id::text, 'greeting ' || g.status
        from orders o join greetings g on g.id = o.greeting_id
       where o.status = 'PAID' and g.status = 'DRAFT'
      union all
      select 'COMMISSION_MISSING', o.id::text, 'no COMMISSION_EARNED entry'
        from orders o
       where o.status = 'PAID' and not exists (select 1 from partner_ledger_entries l where l.order_id = o.id and l.type = 'COMMISSION_EARNED')
      union all
      select 'COMMISSION_NOT_REVERSED', o.id::text, 'earned, not reversed'
        from orders o
       where o.status = 'REFUNDED'
         and exists (select 1 from partner_ledger_entries l where l.order_id = o.id and l.type = 'COMMISSION_EARNED')
         and not exists (select 1 from partner_ledger_entries l where l.order_id = o.id and l.type = 'COMMISSION_REVERSAL')
      union all
      select 'STALE_PENDING', o.id::text, 'pending since ' || to_char(min(p.created_at) at time zone 'Asia/Tbilisi', 'YYYY-MM-DD HH24:MI')
        from orders o join payments p on p.order_id = o.id and p.status = 'PENDING'
       where o.status = 'PENDING_PAYMENT'
       group by o.id
      having min(p.created_at) < now() - interval '30 minutes'
      union all
      select 'AMOUNT_MISMATCH', a.target_id, coalesce(a.metadata->>'reportedAmountMinor', '?') || ' ' || coalesce(a.metadata->>'reportedCurrency', '?') || ' reported, ' || coalesce(a.metadata->>'expectedAmountMinor', '?') || ' ' || coalesce(a.metadata->>'expectedCurrency', '?') || ' expected'
        from audit_logs a
       where a.action = 'PAYMENT_AMOUNT_MISMATCH' and a.target_type = 'order' and a.created_at > now() - interval '30 days'
    `);
    return [...rows].map((r) => ({ kind: r.kind, orderId: r.order_id, detail: r.detail }));
  });
}

/**
 * Reconciliation query (Phase 0.5 §4): orders that were paid but whose
 * greeting never made it to ACTIVE — e.g. activatePaidOrder was never called,
 * or a prior attempt threw. Safe to re-run activatePaidOrder for each result.
 * Admin-only (there is no automated retry/cron in Phase 0.5 — the capability
 * exists, scheduling it is a later phase).
 */
export async function findOrdersNeedingActivation(adminUserId: string) {
  return withAdminContext(adminUserId, (tx) =>
    tx
      .select({ orderId: orders.id, greetingId: orders.greetingId, qrCodeId: orders.qrCodeId, paidAt: orders.paidAt })
      .from(orders)
      .innerJoin(greetings, eq(greetings.id, orders.greetingId))
      .where(and(eq(orders.status, "PAID"), eq(greetings.status, "DRAFT"))),
  );
}

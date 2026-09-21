import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withEditableGreeting, withPaymentActivation, withAdminContext } from "@/db/client";
import { orders, payments, partnerLedgerEntries, greetings, qrCodes } from "@/db/schema";
import { verifyGreetingEditAccess } from "@/lib/greetings/access";
import { publicEnv } from "@/lib/env.public";
import { resolveActivePrice, splitCommission, getPartnerCommissionRateBps } from "./pricing";
import { getPaymentProvider } from "./provider-factory";
import { sanitizeProviderMetadata, type PaymentProviderKey } from "./types";

type Order = typeof orders.$inferSelect;

/** Where a redirect-based provider sends the browser back — see CreatePaymentInput.returnUrls doc comment: never treated as proof of payment on its own. */
function buildReturnUrls(qrPublicToken: string): { success: string; cancel: string } {
  const base = `${publicEnv.NEXT_PUBLIC_APP_URL}/g/${qrPublicToken}`;
  return { success: `${base}?step=checkout&payment=return`, cancel: `${base}?step=checkout&payment=cancelled` };
}

export class CheckoutError extends Error {}
export class PaymentConfirmationError extends Error {}

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
 */
export async function confirmPaymentSuccess(input: {
  provider: PaymentProviderKey;
  providerPaymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  metadata?: Record<string, unknown>;
}): Promise<{ alreadyProcessed: boolean; order: Order }> {
  return withPaymentActivation(input.orderId, async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update")
      .limit(1);
    if (!order) throw new PaymentConfirmationError(`Order ${input.orderId} not found`);

    if (order.status === "PAID") {
      return { alreadyProcessed: true, order };
    }
    if (order.status !== "PENDING_PAYMENT") {
      throw new PaymentConfirmationError(
        `Order ${input.orderId} is ${order.status}, not eligible for payment confirmation`,
      );
    }

    // A real provider's claimed amount/currency must match this order's own
    // authoritative snapshot exactly — never trust a webhook/verification
    // payload's numbers on their own (Phase 5 §10 "wrong amount/currency
    // rejected"). TEST's callers always pass order.grossAmountMinor/currency
    // back, so this is a no-op for them.
    if (input.amountMinor !== order.grossAmountMinor || input.currency !== order.currency) {
      throw new PaymentConfirmationError(
        `Payment amount/currency (${input.amountMinor} ${input.currency}) does not match order ${input.orderId} (${order.grossAmountMinor} ${order.currency})`,
      );
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

    if (existingPayment) {
      if (existingPayment.status !== "SUCCEEDED") {
        await tx
          .update(payments)
          .set({ status: "SUCCEEDED", confirmedAt: sql`now()`, providerMetadata: sanitizedMetadata })
          .where(eq(payments.id, existingPayment.id));
      }
    } else {
      await tx.insert(payments).values({
        orderId: input.orderId,
        provider: input.provider,
        providerPaymentId: input.providerPaymentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        status: "SUCCEEDED",
        confirmedAt: sql`now()`,
        providerMetadata: sanitizedMetadata,
      });
    }

    const [paidOrder] = await tx
      .update(orders)
      .set({ status: "PAID", paidAt: sql`now()` })
      .where(eq(orders.id, order.id))
      .returning();
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

    return { alreadyProcessed: false, order: paidOrder };
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
    await markPaymentFailed(orderId);
    return { status: "FAILED", activated: false };
  }

  // SUCCEEDED — cross-check the provider's own numbers against the order's
  // authoritative snapshot before ever calling confirmPaymentSuccess. A
  // provider (or a compromised/misbehaving one) claiming success for the
  // wrong amount/currency must never activate anything.
  if (verification.amountMinor !== order.grossAmountMinor || verification.currency !== order.currency) {
    throw new ReconciliationError(
      `Provider-reported amount/currency (${verification.amountMinor} ${verification.currency}) does not match order ${orderId} (${order.grossAmountMinor} ${order.currency})`,
    );
  }

  await confirmPaymentSuccess({
    provider: provider.key,
    providerPaymentId: verification.providerPaymentId,
    orderId,
    amountMinor: verification.amountMinor,
    currency: verification.currency,
    metadata: verification.metadata,
  });
  const { activated } = await activatePaidOrder(orderId);
  return { status: "PAID", activated };
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

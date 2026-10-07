import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { withEditableGreeting, withPaymentActivation } from "@/db/client";
import { orders, payments, qrCodes } from "@/db/schema";
import { verifyGreetingEditAccess } from "@/lib/greetings/access";
import { startCheckout, activatePaidOrder, confirmPaymentSuccess, markPaymentFailed, createPaymentAttempt, verifyAndReconcileOrder, settleConfirmedPayment, isUniqueViolation } from "./service";
import { assertGreetingPurchasable } from "./eligibility";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { env } from "@/lib/env";

export class CheckoutEntryError extends Error {}

export type CheckoutOrderSummary = {
  orderId: string;
  grossAmountMinor: number;
  currency: string;
  status: string;
  /** Present only for a redirect-based (non-TEST) provider with a live PENDING attempt — where "Pay securely" sends the browser. Safe to expose: it's exactly where the customer is about to be sent anyway. */
  redirectUrl?: string;
};

function toSummary(order: { id: string; grossAmountMinor: number; currency: string; status: string }, redirectUrl?: string): CheckoutOrderSummary {
  // Deliberately excludes partnerCommissionMinor/platformShareMinor/priceId/
  // partnerId — the customer never sees internal accounting (Phase 3 §2).
  return { orderId: order.id, grossAmountMinor: order.grossAmountMinor, currency: order.currency, status: order.status, redirectUrl };
}

/**
 * The single entry point Checkout uses (Phase 3 §1/§7/§15) — never calls
 * lib/payments/service.ts's startCheckout blindly on every click. Reuses an
 * existing PENDING_PAYMENT order instead of creating a new abandoned one each
 * time the sender re-enters Checkout, and recovers automatically if it finds
 * an order that's already PAID but the Greeting never made it to ACTIVE
 * (the "payment succeeded, activation failed" case) — exactly
 * findOrdersNeedingActivation's scenario, just triggered by the sender
 * revisiting rather than an operator running the batch job.
 */
export async function getOrCreateCheckoutOrder(
  greetingId: string,
  editToken: string,
): Promise<{ summary: CheckoutOrderSummary; recovered: boolean }> {
  const greeting = await verifyGreetingEditAccess(greetingId, editToken);

  const existing = await withEditableGreeting(greetingId, (tx) =>
    tx
      .select({ order: orders, qrPublicToken: qrCodes.publicToken })
      .from(orders)
      .innerJoin(qrCodes, eq(qrCodes.id, orders.qrCodeId))
      .where(eq(orders.greetingId, greetingId))
      .orderBy(desc(orders.createdAt))
      .limit(1),
  );
  const latest = existing[0]?.order;
  const qrPublicToken = existing[0]?.qrPublicToken;

  if (latest?.status === "PAID") {
    const { activated } = await activatePaidOrder(latest.id);
    if (activated) {
      await recordAnalyticsEvent({ eventType: "QR_ACTIVATED", qrCodeId: greeting.qrCodeId, greetingId }, { partnerId: latest.partnerId });
    }
    return { summary: toSummary(latest), recovered: true };
  }

  // Everything below either opens a payment attempt or creates an order, so
  // the greeting must be purchasable right now (message present, not
  // blocked, partner not suspended) — checked server-side, never trusting
  // that the wizard's own steps were followed (e.g. a direct ?step=checkout).
  await assertGreetingPurchasable(greetingId);

  if (latest?.status === "PENDING_PAYMENT" && qrPublicToken) {
    // Re-entry: for a real (non-TEST) provider, the previous redirect URL may
    // already be expired/consumed, so a fresh attempt is created rather than
    // reusing it — see createPaymentAttempt's doc comment. TEST never has a
    // meaningful redirectUrl, so this is a no-op cost there.
    const redirectUrl = env.PAYMENTS_PROVIDER === "TEST" ? undefined : await createPaymentAttempt(latest, qrPublicToken);
    return { summary: toSummary(latest, redirectUrl), recovered: false };
  }

  // No order yet, or the latest one is terminal (FAILED/CANCELED/REFUNDED) —
  // a genuinely new checkout attempt. productId comes from the Greeting's own
  // row (set at creation, Phase 2) — never accepted as client input here.
  try {
    const { order, redirectUrl } = await startCheckout({ greetingId, editToken, productId: greeting.productId });
    await recordAnalyticsEvent({ eventType: "CHECKOUT_STARTED", greetingId, orderId: order.id }, { partnerId: order.partnerId });
    return { summary: toSummary(order, redirectUrl), recovered: false };
  } catch (err) {
    // A simultaneous request (double tap, second tab) opened the order first —
    // orders_one_open_per_greeting refused a second one. Continue with theirs.
    if (!isUniqueViolation(err, "orders_one_open_per_greeting")) throw err;
    const [open] = await withEditableGreeting(greetingId, (tx) =>
      tx.select().from(orders).where(and(eq(orders.greetingId, greetingId), eq(orders.status, "PENDING_PAYMENT"))).limit(1),
    );
    if (!open) throw err;
    return { summary: toSummary(open), recovered: false };
  }
}

/**
 * Return-flow verification (Phase 5 §5) — called when the browser lands back
 * from a real provider's redirect, or when polling while "verification
 * pending" is shown. Deliberately takes no query-string input from the
 * caller: the only thing driving what happens is the Greeting's own current
 * order state, re-derived server-side via verifyAndReconcileOrder, which
 * itself only ever trusts the PROVIDER's own verifyPayment response — never
 * the fact that the browser simply arrived at this URL.
 */
export async function checkPaymentReturn(
  greetingId: string,
  editToken: string,
): Promise<{ status: string; activated: boolean }> {
  const greeting = await verifyGreetingEditAccess(greetingId, editToken).catch(() => null);

  // A DRAFT-only lookup (verifyGreetingEditAccess) fails once the greeting is
  // already ACTIVE — that's not an error here, it just means payment already
  // succeeded and activated (e.g. a duplicate return-page load after success).
  if (!greeting) return { status: "PAID", activated: false };

  const [latest] = await withEditableGreeting(greetingId, (tx) =>
    tx.select().from(orders).where(eq(orders.greetingId, greetingId)).orderBy(desc(orders.createdAt)).limit(1),
  );
  if (!latest) throw new CheckoutEntryError("No order found for this greeting");
  if (latest.status !== "PENDING_PAYMENT") {
    return { status: latest.status, activated: false };
  }

  // verifyAndReconcileOrder settles through settleConfirmedPayment, which
  // records PAYMENT_SUCCEEDED / QR_ACTIVATED itself.
  return verifyAndReconcileOrder(latest.id);
}

/**
 * Simulates the TEST provider's asynchronous callback (Phase 3 §3). This is
 * intentionally NOT "the browser says paymentSuccessful=true": the browser
 * only ever names which Greeting (via its own edit-token-authorized session)
 * and which outcome to simulate — every dollar amount, currency, order id and
 * provider-payment id used below is re-derived server-side from the
 * Greeting's own already-authorized PENDING order and its own PENDING
 * payment row, through the exact same confirmPaymentSuccess/markPaymentFailed
 * functions a real webhook handler would call. A malicious client can at
 * worst flip its OWN order to FAILED early or trigger its OWN legitimate
 * success — it can never touch another order, never supply an amount, and
 * this whole path is hard-disabled outside TEST+non-production (checked
 * again here, independently of provider-factory.ts's own guard).
 */
export async function simulateTestPayment(
  greetingId: string,
  editToken: string,
  outcome: "success" | "failure",
): Promise<{ status: "PAID" | "FAILED"; activated: boolean }> {
  if (env.PAYMENTS_PROVIDER !== "TEST" || env.NODE_ENV === "production" || !env.ALLOW_TEST_PAYMENTS) {
    throw new CheckoutEntryError("TEST payment simulation is not available in this environment");
  }

  // Authorizes the caller for this greeting (edit token) — the result itself is not needed.
  await verifyGreetingEditAccess(greetingId, editToken);

  const [order] = await withEditableGreeting(greetingId, (tx) =>
    tx.select().from(orders).where(and(eq(orders.greetingId, greetingId), eq(orders.status, "PENDING_PAYMENT"))).orderBy(desc(orders.createdAt)).limit(1),
  );
  if (!order) throw new CheckoutEntryError("No pending order to confirm — start checkout again");

  if (outcome === "failure") {
    await markPaymentFailed(order.id);
    return { status: "FAILED", activated: false };
  }

  const [pendingPayment] = await withPaymentActivation(order.id, (tx) =>
    tx.select().from(payments).where(and(eq(payments.orderId, order.id), eq(payments.status, "PENDING"))).limit(1),
  );
  if (!pendingPayment?.providerPaymentId) throw new CheckoutEntryError("No pending payment found for this order");

  // Refuse before "charging" rather than charge-then-refund whenever the
  // ineligibility is already known; confirmPaymentSuccess re-checks under a
  // lock for anything that changes in between.
  await assertGreetingPurchasable(greetingId);

  // Through the same path a webhook takes (settleConfirmedPayment: refunds,
  // activation, PAYMENT_SUCCEEDED / QR_ACTIVATED analytics).
  const confirmation = await confirmPaymentSuccess({
    provider: "TEST",
    providerPaymentId: pendingPayment.providerPaymentId,
    orderId: order.id,
    amountMinor: order.grossAmountMinor,
    currency: order.currency,
  });
  const settled = await settleConfirmedPayment(confirmation);
  if (settled.status !== "PAID") {
    throw new CheckoutEntryError("This greeting can no longer be activated — the payment was returned");
  }
  return { status: "PAID", activated: settled.activated };
}

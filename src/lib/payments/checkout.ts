import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { withEditableGreeting, withPaymentActivation } from "@/db/client";
import { checkoutConsents, orders, payments, qrCodes } from "@/db/schema";
import { isFullCheckoutConsent, type CheckoutConsents } from "./checkout-codes";
import { verifyGreetingEditAccess } from "@/lib/greetings/access";
import { startCheckout, activatePaidOrder, confirmPaymentSuccess, markPaymentFailed, createPaymentAttempt, verifyAndReconcileOrder, settleConfirmedPayment, isUniqueViolation } from "./service";
import { assertGreetingPurchasable } from "./eligibility";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { env } from "@/lib/env";
import { assertCheckoutOpen } from "./checkout-gate";
import { assertOrderInPaymentScope } from "./scope";
import { createHash } from "node:crypto";
import { loadMerchantInfo } from "@/lib/merchant/info";
import kaMessages from "@/messages/ka.json";
import enMessages from "@/messages/en.json";

type Order = typeof orders.$inferSelect;

export class CheckoutEntryError extends Error {}

export type CheckoutOrderSummary = {
  orderId: string;
  grossAmountMinor: number;
  currency: string;
  status: string;
};

function toSummary(order: { id: string; grossAmountMinor: number; currency: string; status: string }): CheckoutOrderSummary {
  // Deliberately excludes partnerCommissionMinor/platformShareMinor/priceId/
  // partnerId — the customer never sees internal accounting (Phase 3 §2).
  // No provider redirect URL either: that exists only after consent
  // (acceptCheckoutTerms).
  return { orderId: order.id, grossAmountMinor: order.grossAmountMinor, currency: order.currency, status: order.status };
}

/** A payment for this card is still open at the bank; a second attempt could charge twice. */
export class PaymentInProgressError extends Error {
  constructor() {
    super("A payment for this card is still being processed");
    this.name = "PaymentInProgressError";
  }
}

/**
 * Real provider only. If the order has an open bank attempt, asks the bank
 * (verifyAndReconcileOrder: the same idempotent path as the return check and
 * reconciliation) and reports:
 *   NONE   no open attempt: a new one is safe;
 *   PAID   the bank charged it: the order is now PAID (activation is the caller's);
 *   OPEN   still open at the bank, or the bank could not be asked: never offer Pay;
 *   CLOSED the attempt ended without payment (orderStatus: the order's status now).
 */
async function settleOpenBankAttempt(
  orderId: string,
): Promise<{ kind: "NONE" } | { kind: "PAID" } | { kind: "OPEN" } | { kind: "CLOSED"; orderStatus: Order["status"] }> {
  if (env.PAYMENTS_PROVIDER === "TEST") return { kind: "NONE" };
  const openAttempt = async () =>
    (
      await withPaymentActivation(orderId, (tx) =>
        tx
          .select({ providerPaymentId: payments.providerPaymentId })
          .from(payments)
          .where(and(eq(payments.orderId, orderId), eq(payments.status, "PENDING")))
          .limit(1),
      )
    )[0];
  const attempt = await openAttempt();
  if (!attempt?.providerPaymentId) return { kind: "NONE" };
  try {
    await verifyAndReconcileOrder(orderId);
  } catch {
    return { kind: "OPEN" }; // bank unreachable: unknown, so no second attempt
  }
  const [order] = await withPaymentActivation(orderId, (tx) => tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1));
  if (order?.status === "PAID") return { kind: "PAID" };
  if (await openAttempt()) return { kind: "OPEN" };
  return { kind: "CLOSED", orderStatus: order?.status ?? "FAILED" };
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
): Promise<{ summary: CheckoutOrderSummary; recovered: boolean; awaitingProvider?: boolean }> {
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
  let latest = existing[0]?.order;
  const qrPublicToken = existing[0]?.qrPublicToken;

  // A sender who comes back WITHOUT the bank's return URL (closed the tab,
  // opened the card again later) while a real bank payment attempt is still
  // open: ask the bank before ever showing a Pay button again. The callback
  // may have been lost on a cold start, and a second Pay would be a second
  // charge (refunds are manual). Deliberately before the checkout gate, so a
  // paid card is recovered even if checkout has closed since.
  if (latest?.status === "PENDING_PAYMENT") {
    const verdict = await settleOpenBankAttempt(latest.id);
    if (verdict.kind === "PAID") {
      const { activated } = await activatePaidOrder(latest.id);
      if (activated) {
        await recordAnalyticsEvent({ eventType: "QR_ACTIVATED", qrCodeId: greeting.qrCodeId, greetingId }, { partnerId: latest.partnerId });
      }
      return { summary: toSummary({ ...latest, status: "PAID" }), recovered: true };
    }
    if (verdict.kind === "OPEN") {
      return { summary: toSummary(latest), recovered: false, awaitingProvider: true };
    }
    if (verdict.kind === "CLOSED") latest = { ...latest, status: verdict.orderStatus };
  }

  if (latest?.status === "PAID") {
    const { activated } = await activatePaidOrder(latest.id);
    if (activated) {
      await recordAnalyticsEvent({ eventType: "QR_ACTIVATED", qrCodeId: greeting.qrCodeId, greetingId }, { partnerId: latest.partnerId });
    }
    return { summary: toSummary(latest), recovered: true };
  }

  // Real-money checkout may be switched off (CHECKOUT_ENABLED; owner pilot
  // cards excepted) — nothing below runs then: no order, no provider call.
  assertCheckoutOpen(greeting.qrCodeId);

  // Everything below either opens a payment attempt or creates an order, so
  // the greeting must be purchasable right now (message present, not
  // blocked, partner not suspended) — checked server-side, never trusting
  // that the wizard's own steps were followed (e.g. a direct ?step=checkout).
  await assertGreetingPurchasable(greetingId);

  if (latest?.status === "PENDING_PAYMENT" && qrPublicToken) {
    // Re-entry. A real provider's payment is opened only by
    // acceptCheckoutTerms (fresh each time, so never an expired redirect).
    return { summary: toSummary(latest), recovered: false };
  }

  // No order yet, or the latest one is terminal (FAILED/CANCELED/REFUNDED) —
  // a genuinely new checkout attempt. productId comes from the Greeting's own
  // row (set at creation, Phase 2) — never accepted as client input here.
  try {
    // TEST keeps its simulated attempt at entry; a real provider's payment
    // waits for consent (acceptCheckoutTerms).
    const { order } = await startCheckout({ greetingId, editToken, productId: greeting.productId, createAttempt: env.PAYMENTS_PROVIDER === "TEST" });
    await recordAnalyticsEvent({ eventType: "CHECKOUT_STARTED", greetingId, orderId: order.id }, { partnerId: order.partnerId });
    return { summary: toSummary(order), recovered: false };
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

/** Both checkout consents, exactly as shown (terms + immediate activation / withdrawal acknowledgement). */
const CONSENT_TEXT = {
  ka: `${kaMessages.wizard.checkout.legal.consent}\n${kaMessages.wizard.checkout.legal.activationConsent}`,
  en: `${enMessages.wizard.checkout.legal.consent}\n${enMessages.wizard.checkout.legal.activationConsent}`,
} as const;

export { ALL_CHECKOUT_CONSENTS, isFullCheckoutConsent, type CheckoutConsents } from "./checkout-codes";

export class ConsentRequiredError extends Error {
  constructor() {
    super("Both checkout consents are required before payment");
    this.name = "ConsentRequiredError";
  }
}

/** SHA-256 of the exact consent sentences the buyer saw (both, newline-joined), per language. */
export function consentTextSha256(locale: "ka" | "en"): string {
  return createHash("sha256").update(CONSENT_TEXT[locale], "utf8").digest("hex");
}

/**
 * The buyer ticked both consents and pressed Pay. Records the consent against
 * the greeting's own open order (checkout_consents, append-only), then — for
 * a real provider — opens a fresh bank payment and returns where to send the
 * browser. The bank payment never exists before the consent row, so every
 * real payment has consent evidence behind it. TEST returns no redirect; the
 * simulated payment follows separately.
 */
export async function acceptCheckoutTerms(
  greetingId: string,
  editToken: string,
  locale: "ka" | "en",
  consents: CheckoutConsents,
): Promise<{ orderId: string; redirectUrl?: string }> {
  // Refused before anything else: no consent row and no bank payment without both consents.
  if (!isFullCheckoutConsent(consents)) throw new ConsentRequiredError();
  const greeting = await verifyGreetingEditAccess(greetingId, editToken);
  assertCheckoutOpen(greeting.qrCodeId);
  await assertGreetingPurchasable(greetingId);

  const [open] = await withEditableGreeting(greetingId, (tx) =>
    tx
      .select({ order: orders, qrPublicToken: qrCodes.publicToken })
      .from(orders)
      .innerJoin(qrCodes, eq(qrCodes.id, orders.qrCodeId))
      .where(and(eq(orders.greetingId, greetingId), eq(orders.status, "PENDING_PAYMENT")))
      .limit(1),
  );
  if (!open) throw new CheckoutEntryError("No open order for this greeting");
  // Staging fence: refused before the consent row and the bank payment.
  await assertOrderInPaymentScope(open.order.id);
  // One Pay at a time per order: two simultaneous presses (double tap, two
  // tabs) would otherwise both pass the open-attempt check below and open two
  // bank payments, both payable. The loser is told a payment is in progress.
  return withOrderPaymentLock(open.order.id, () => acceptCheckoutTermsLocked(greetingId, locale, open));
}

/**
 * Runs fn while holding a transaction-scoped advisory lock for this order's
 * bank attempt (try-lock: never waits). The lock transaction writes nothing;
 * it is held only for the bank's create call (a few seconds at most).
 */
async function withOrderPaymentLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  return withPaymentActivation(orderId, async (tx) => {
    const [row] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${"payment-attempt:" + orderId}, 0)) as locked`);
    if (!row?.locked) throw new PaymentInProgressError();
    return fn();
  });
}

async function acceptCheckoutTermsLocked(
  greetingId: string,
  locale: "ka" | "en",
  open: { order: Order; qrPublicToken: string },
): Promise<{ orderId: string; redirectUrl?: string }> {
  // Never a second bank payment while an earlier one for this order may still
  // be charged (second tab, back button, lost callback): the bank decides first.
  const verdict = await settleOpenBankAttempt(open.order.id);
  if (verdict.kind === "PAID") throw new CheckoutEntryError("This card is already paid");
  if (verdict.kind === "OPEN") throw new PaymentInProgressError();
  if (verdict.kind === "CLOSED" && verdict.orderStatus !== "PENDING_PAYMENT") throw new CheckoutEntryError("The previous payment attempt ended; start again");

  await withEditableGreeting(greetingId, (tx) =>
    tx.insert(checkoutConsents).values({
      orderId: open.order.id,
      greetingId,
      locale,
      consentTextSha256: consentTextSha256(locale),
      policiesEffectiveDate: loadMerchantInfo(process.env).values.legalEffectiveDate,
    }),
  );

  if (env.PAYMENTS_PROVIDER === "TEST") return { orderId: open.order.id };
  const redirectUrl = await createPaymentAttempt(open.order, open.qrPublicToken, locale);
  if (!redirectUrl) throw new CheckoutEntryError("The payment provider returned no payment page");
  return { orderId: open.order.id, redirectUrl };
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

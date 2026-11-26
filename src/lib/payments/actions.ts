"use server";

import { getEditToken } from "@/lib/greetings/edit-token-cookie";
import { getOrCreateCheckoutOrder, simulateTestPayment, checkPaymentReturn, acceptCheckoutTerms, PaymentInProgressError, type CheckoutOrderSummary } from "./checkout";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/log";
import { CheckoutUnavailableError } from "./checkout-gate";
import { CHECKOUT_CLOSED, CONSENT_REQUIRED, PAYMENT_IN_PROGRESS, isFullCheckoutConsent } from "./checkout-codes";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorResult(scope: string, err: unknown, context: Record<string, string | number | undefined> = {}): ActionResult<never> {
  logServerError(scope, err, context);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

/** PUBLIC EXPENSIVE: creates/re-enters a checkout order. Keyed by greetingId — a genuine checkout/retry flow calls this a handful of times, never dozens per minute. */
export async function startCheckoutAction(greetingId: string): Promise<ActionResult<{ summary: CheckoutOrderSummary; recovered: boolean; awaitingProvider?: boolean }>> {
  try {
    await enforceRateLimit({ key: `checkout-start:${greetingId}`, limit: 20, windowSeconds: 60 });
    const token = await getEditToken(greetingId);
    const result = await getOrCreateCheckoutOrder(greetingId, token);
    return { ok: true, data: result };
  } catch (err) {
    // Real-money checkout switched off (CHECKOUT_ENABLED): an expected state,
    // not a failure — the UI shows "payments open soon", nothing is logged.
    if (err instanceof CheckoutUnavailableError) return { ok: false, error: CHECKOUT_CLOSED };
    return errorResult("startCheckoutAction", err, { greetingId });
  }
}

/**
 * PUBLIC EXPENSIVE: the buyer agreed to the terms and pressed Pay. Records the
 * consent (server-side evidence, linked to the order) and, for a real
 * provider, opens the bank payment and returns its page. Keyed by greetingId.
 */
export async function acceptCheckoutTermsAction(
  greetingId: string,
  locale: string,
  consents: unknown,
): Promise<ActionResult<{ redirectUrl?: string }>> {
  try {
    // Client input: both consents must be explicitly true, or nothing happens.
    if (!isFullCheckoutConsent(consents)) return { ok: false, error: CONSENT_REQUIRED };
    await enforceRateLimit({ key: `checkout-consent:${greetingId}`, limit: 10, windowSeconds: 60 });
    const token = await getEditToken(greetingId);
    const { redirectUrl } = await acceptCheckoutTerms(greetingId, token, locale === "en" ? "en" : "ka", consents);
    return { ok: true, data: { redirectUrl } };
  } catch (err) {
    if (err instanceof PaymentInProgressError) return { ok: false, error: PAYMENT_IN_PROGRESS };
    if (err instanceof CheckoutUnavailableError) return { ok: false, error: CHECKOUT_CLOSED };
    return errorResult("acceptCheckoutTermsAction", err, { greetingId });
  }
}

/** PUBLIC EXPENSIVE (TEST-provider only — see provider-factory.ts's own production guard). Keyed by greetingId. */
export async function simulateTestPaymentAction(
  greetingId: string,
  outcome: "success" | "failure",
): Promise<ActionResult<{ status: "PAID" | "FAILED"; activated: boolean }>> {
  try {
    await enforceRateLimit({ key: `checkout-simulate:${greetingId}`, limit: 20, windowSeconds: 60 });
    const token = await getEditToken(greetingId);
    const result = await simulateTestPayment(greetingId, token, outcome);
    return { ok: true, data: result };
  } catch (err) {
    return errorResult("simulateTestPaymentAction", err, { greetingId });
  }
}

/**
 * Polled by the Checkout UI after a real-provider redirect returns the
 * browser (Phase 5 §5) — asks checkPaymentReturn to re-verify against the
 * provider, never trusts the fact that the browser simply arrived here.
 * Deliberately NOT rate-limited: this is the legitimate poll loop itself
 * (RETURN_POLL_ATTEMPTS in creation-wizard.tsx), and verifyAndReconcileOrder
 * is a cheap, idempotent single-order lookup.
 */
export async function checkPaymentReturnAction(greetingId: string): Promise<ActionResult<{ status: string; activated: boolean }>> {
  try {
    const token = await getEditToken(greetingId);
    const result = await checkPaymentReturn(greetingId, token);
    return { ok: true, data: result };
  } catch (err) {
    return errorResult("checkPaymentReturnAction", err, { greetingId });
  }
}

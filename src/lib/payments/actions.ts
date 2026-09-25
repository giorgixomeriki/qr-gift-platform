"use server";

import { getEditToken } from "@/lib/greetings/edit-token-cookie";
import { getOrCreateCheckoutOrder, simulateTestPayment, checkPaymentReturn, type CheckoutOrderSummary } from "./checkout";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/log";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorResult(scope: string, err: unknown, context: Record<string, string | number | undefined> = {}): ActionResult<never> {
  logServerError(scope, err, context);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

/** PUBLIC EXPENSIVE: creates/re-enters a checkout order. Keyed by greetingId — a genuine checkout/retry flow calls this a handful of times, never dozens per minute. */
export async function startCheckoutAction(greetingId: string): Promise<ActionResult<{ summary: CheckoutOrderSummary; recovered: boolean }>> {
  try {
    await enforceRateLimit({ key: `checkout-start:${greetingId}`, limit: 20, windowSeconds: 60 });
    const token = await getEditToken(greetingId);
    const result = await getOrCreateCheckoutOrder(greetingId, token);
    return { ok: true, data: result };
  } catch (err) {
    return errorResult("startCheckoutAction", err, { greetingId });
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

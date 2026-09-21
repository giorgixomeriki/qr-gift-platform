"use server";

import { getEditToken } from "@/lib/greetings/edit-token-cookie";
import { getOrCreateCheckoutOrder, simulateTestPayment, checkPaymentReturn, type CheckoutOrderSummary } from "./checkout";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorResult(err: unknown): ActionResult<never> {
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

export async function startCheckoutAction(greetingId: string): Promise<ActionResult<{ summary: CheckoutOrderSummary; recovered: boolean }>> {
  try {
    const token = await getEditToken(greetingId);
    const result = await getOrCreateCheckoutOrder(greetingId, token);
    return { ok: true, data: result };
  } catch (err) {
    return errorResult(err);
  }
}

export async function simulateTestPaymentAction(
  greetingId: string,
  outcome: "success" | "failure",
): Promise<ActionResult<{ status: "PAID" | "FAILED"; activated: boolean }>> {
  try {
    const token = await getEditToken(greetingId);
    const result = await simulateTestPayment(greetingId, token, outcome);
    return { ok: true, data: result };
  } catch (err) {
    return errorResult(err);
  }
}

/**
 * Polled by the Checkout UI after a real-provider redirect returns the
 * browser (Phase 5 §5) — asks checkPaymentReturn to re-verify against the
 * provider, never trusts the fact that the browser simply arrived here.
 */
export async function checkPaymentReturnAction(greetingId: string): Promise<ActionResult<{ status: string; activated: boolean }>> {
  try {
    const token = await getEditToken(greetingId);
    const result = await checkPaymentReturn(greetingId, token);
    return { ok: true, data: result };
  } catch (err) {
    return errorResult(err);
  }
}

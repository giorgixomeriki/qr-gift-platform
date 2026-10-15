import "server-only";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { getPaymentProvider } from "./provider-factory";
import { confirmPaymentSuccess, recordProviderFailure, settleConfirmedPayment, PaymentConfirmationError } from "./service";
import { reconcileOrderRefunds, recordExternalRefund } from "./refunds";
import { paymentProviderKeySchema, ProviderNotImplementedError } from "./types";

export type WebhookResponse = { status: number; body: string | { received: true } };

/**
 * Provider callback handling, shared by the route
 * (app/api/webhooks/payments/[provider]/route.ts) and the integration
 * suites. Never trusts the payload's claims on their own: each adapter's
 * handleWebhook authenticates the call (signature) and reports the provider's
 * own view of the payment; this function only applies it through the one
 * settlement path every other caller uses.
 *
 * Responses: 200 once the outcome is durably recorded (including duplicates —
 * a provider retrying a delivered callback must not loop); 400 for a call
 * that is not genuine or can never apply (don't retry); 404 for a provider
 * this deployment doesn't use; 5xx only for our own transient failure (retry).
 */
/**
 * Whether this deployment has a callback endpoint for `providerParam` at all:
 * only the configured provider, and the TEST webhook only where fake payments
 * were explicitly enabled AND a signing secret is set. Pure — no I/O — so the
 * route can answer 404 before spending anything (rate-limit store, body).
 */
export function webhookEndpointExists(providerParam: string): boolean {
  const parsed = paymentProviderKeySchema.safeParse(providerParam);
  if (!parsed.success || parsed.data !== env.PAYMENTS_PROVIDER) return false;
  if (parsed.data === "TEST" && (!env.ALLOW_TEST_PAYMENTS || !env.TEST_PAYMENTS_WEBHOOK_SECRET || env.NODE_ENV === "production")) return false;
  return true;
}

export async function handleProviderWebhook(providerParam: string, rawBody: string, headers: Headers): Promise<WebhookResponse> {
  if (!webhookEndpointExists(providerParam)) return { status: 404, body: "Unknown provider" };
  const providerKey = paymentProviderKeySchema.parse(providerParam);

  let webhookResult;
  try {
    webhookResult = await getPaymentProvider().handleWebhook(rawBody, headers);
  } catch (err) {
    if (err instanceof ProviderNotImplementedError) {
      console.error(`[webhook] ${providerKey} handleWebhook not implemented`);
      return { status: 501, body: "Provider not implemented" };
    }
    // Signature mismatch, malformed payload, or the provider's status lookup
    // failing — logged without the body or headers.
    console.error(`[webhook] ${providerKey} verification failed:`, err instanceof Error ? err.message : err);
    return { status: 400, body: "Invalid webhook" };
  }

  try {
    // Asynchronous refunds: our own open refund requests are settled against
    // the provider's state on every callback, not only when it reports a
    // refund state (a REJECTED refund leaves the charge "completed"; only its
    // refund action says rejected). A refund we never asked for is recorded
    // for a person, never applied automatically.
    const refund = webhookResult.refund;
    if (refund) {
      const counts = await reconcileOrderRefunds(webhookResult.orderId);
      const ours = counts.completed + counts.rejected + counts.pending;
      if (refund.status !== "NONE") {
        if (ours === 0) {
          await recordExternalRefund(webhookResult.orderId, webhookResult.providerPaymentId, refund.refundedAmountMinor);
        }
        return { status: 200, body: { received: true } };
      }
      // No refund on THIS charge: continue below. The open refund may be for
      // another charge of the same order, and settling this one is idempotent.
    }

    // The provider's own reported outcome decides what happens — a FAILED or
    // PENDING notification must never be treated as money received.
    if (webhookResult.status === "FAILED") {
      await recordProviderFailure({ provider: providerKey, providerPaymentId: webhookResult.providerPaymentId, orderId: webhookResult.orderId });
      return { status: 200, body: { received: true } };
    }
    if (webhookResult.status !== "SUCCEEDED") {
      return { status: 200, body: { received: true } };
    }

    const confirmation = await confirmPaymentSuccess({
      provider: providerKey,
      providerPaymentId: webhookResult.providerPaymentId,
      orderId: webhookResult.orderId,
      amountMinor: webhookResult.amountMinor,
      currency: webhookResult.currency,
      metadata: webhookResult.metadata,
    });
    // Refunds (ineligible greeting, greeting already paid, a duplicate
    // capture) or activation — the same settlement every path uses.
    await settleConfirmedPayment(confirmation);
    return { status: 200, body: { received: true } };
  } catch (err) {
    if (err instanceof PaymentConfirmationError) {
      // Order not found / amount-currency mismatch / payment-order mismatch:
      // a real rejection that retrying won't change.
      console.error(`[webhook] ${providerKey} rejected:`, err.message);
      return { status: 400, body: "Rejected" };
    }
    logServerError("providerWebhook", err, { provider: providerKey });
    return { status: 500, body: "Internal error" };
  }
}

import { z } from "zod";

/**
 * Payment provider domain boundary (architecture plan §7 / Phase 0.5 §7).
 * Implemented by the BOG Payment Manager adapter (providers/bog-provider.ts)
 * and the local TEST adapter (providers/test-provider.ts).
 * `lib/payments/service.ts` (the domain logic: idempotency, ledger, activation)
 * depends only on this interface, never on a concrete provider.
 */

/**
 * "TEST" — simulated payments, refused in production (provider-factory.ts).
 * "BOG" — Bank of Georgia Payment Manager (providers/bog-provider.ts):
 * hosted payment page, SHA256withRSA-signed callbacks re-verified against
 * BOG's receipt, and asynchronous refunds behind BOG_REFUNDS_ENABLED.
 */
export const PAYMENT_PROVIDERS = ["TEST", "BOG"] as const;
export type PaymentProviderKey = (typeof PAYMENT_PROVIDERS)[number];

export const paymentProviderKeySchema = z.enum(PAYMENT_PROVIDERS);

export type CreatePaymentInput = {
  orderId: string;
  amountMinor: number;
  currency: string;
  /** Where the provider should send the browser back after success/cancel — a redirect-based provider needs these at session-creation time. Never treated as proof of payment when the browser lands there; see checkout.ts. */
  returnUrls: { success: string; cancel: string };
  /** The order's product (orders.product_id), for providers that itemise the purchase. */
  productId?: string;
  /** Language for a hosted payment page, when the provider has one. */
  locale?: "ka" | "en";
};

export type CreatePaymentResult = {
  providerPaymentId: string;
  /** Where to send the customer to complete payment, if the provider is redirect-based. */
  redirectUrl?: string;
  metadata: Record<string, unknown>;
};

export type PaymentVerificationResult = {
  providerPaymentId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amountMinor: number;
  currency: string;
  metadata: Record<string, unknown>;
  /**
   * Refund state of this charge as the provider reports it, for providers
   * whose refunds complete asynchronously (BOG). Absent = no refund info.
   * `rejectedActionIds` are refund actions the provider declined.
   */
  refund?: {
    status: "NONE" | "REQUESTED" | "COMPLETED" | "PARTIAL";
    refundedAmountMinor: number;
    rejectedActionIds: string[];
  };
};

export type WebhookResult = PaymentVerificationResult & { orderId: string };

export type RefundResult = {
  providerPaymentId: string;
  refundedAmountMinor: number;
  /**
   * REFUNDED: the provider confirms the money is returned (TEST, synchronous).
   * PENDING: the provider accepted the request and confirms completion later,
   * by callback and in its payment status (BOG). FAILED: refused.
   */
  status: "REFUNDED" | "PENDING" | "FAILED";
  /** The provider's id for this refund action, when it issues one. */
  providerActionId?: string;
};

/**
 * Thrown when a provider operation is definitely NOT sent because this
 * deployment has it switched off or unavailable (e.g. BOG refunds while
 * BOG_REFUNDS_ENABLED=false — BogRefundsDisabledError). Distinct from a
 * generic Error so callers know nothing reached the provider: a refund is
 * closed as NOT_SENT, the webhook answers 501, and logs show a configuration
 * gap rather than a bug.
 */
export class ProviderNotImplementedError extends Error {
  constructor(provider: PaymentProviderKey, method: string, missing: string) {
    super(`${provider} provider's ${method}() is not implemented — missing: ${missing}`);
    this.name = "ProviderNotImplementedError";
  }
}

export interface PaymentProvider {
  readonly key: PaymentProviderKey;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(providerPaymentId: string): Promise<PaymentVerificationResult>;
  /** Parses+verifies a raw provider webhook request (signature check belongs here). */
  handleWebhook(rawBody: string, headers: Headers): Promise<WebhookResult>;
  /**
   * `idempotencyKey` identifies one refund of one charge (lib/payments/service.ts
   * refundIdempotencyKey). A real adapter MUST forward it as the provider's
   * refund idempotency key (or equivalent), so a retried or concurrent refund
   * request can never return the money twice.
   */
  refundPayment(providerPaymentId: string, amountMinor?: number, idempotencyKey?: string): Promise<RefundResult>;
}

/**
 * `payments.provider_metadata` must never contain card numbers, CVVs, or raw
 * provider auth tokens (architecture plan §12/§7). Every adapter MUST route its
 * metadata through this before it reaches the database — it's an explicit
 * allowlist, not a denylist, so a new unexpected field from a provider response
 * is dropped rather than accidentally persisted.
 */
const SAFE_METADATA_KEYS = new Set([
  "cardBrand",
  "cardLast4",
  "paymentMethodType",
  "providerReference",
  "failureReason",
]);

export function sanitizeProviderMetadata(raw: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (SAFE_METADATA_KEYS.has(key)) safe[key] = raw[key];
  }
  return safe;
}

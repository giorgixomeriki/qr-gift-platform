import { z } from "zod";

/**
 * Payment provider domain boundary (architecture plan §7 / Phase 0.5 §7).
 * No production provider (BOG/TBC/Stripe/...) is integrated yet — this is the
 * interface every future adapter implements, plus the local TEST adapter.
 * `lib/payments/service.ts` (the domain logic: idempotency, ledger, activation)
 * depends only on this interface, never on a concrete provider.
 */

/**
 * "BOG" (Bank of Georgia) is the concrete example a real Georgian merchant
 * pilot would most likely integrate first — added here as the production
 * provider *key* only. See providers/bog-provider.ts: every method on that
 * adapter throws a clear "not implemented, official docs required" error.
 * Selecting PAYMENTS_PROVIDER=BOG does not mean BOG is actually integrated.
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
};

export type WebhookResult = PaymentVerificationResult & { orderId: string };

export type RefundResult = {
  providerPaymentId: string;
  refundedAmountMinor: number;
  status: "REFUNDED" | "FAILED";
};

/**
 * Thrown by a real-provider adapter method that cannot be implemented without
 * information this repo does not have (official API docs, sandbox
 * credentials, signature spec, etc). Distinct from a generic Error so callers
 * (checkout UI, webhook route, reconciliation) can render a specific
 * "payment provider not available" state instead of a generic crash, and so
 * it's unambiguous in logs that this is a known configuration gap, not a bug.
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
  refundPayment(providerPaymentId: string, amountMinor?: number): Promise<RefundResult>;
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

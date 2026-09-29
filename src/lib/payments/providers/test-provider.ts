import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentVerificationResult,
  WebhookResult,
  RefundResult,
} from "../types";

/**
 * Local-development-only simulated provider. Never wired up when
 * NODE_ENV=production — see provider-factory.ts's hard guard, which is the
 * actual enforcement point; this file being importable is not itself a risk.
 *
 * Simulates an always-succeeds redirect-based flow: createPayment mints a
 * fake provider id immediately in SUCCEEDED state (no real async gap), which
 * is enough to exercise the full order/payment/ledger/activation pipeline in
 * tests without a real provider integration.
 */
// This adapter has no backing store of its own — it's stateless by design.
// A real provider's verify/webhook endpoints return the amount THEY actually
// processed (independent of our local order row), which is exactly what
// confirmPaymentSuccess's amount/currency cross-check needs to be meaningful.
// To simulate that honestly without a database of its own, the fake payment
// id embeds the amount/currency it was created with, and verifyPayment/
// handleWebhook parse it back out — never trusting a caller-supplied amount,
// same as a real provider wouldn't.
function encodePaymentId(amountMinor: number, currency: string): string {
  return `test_${amountMinor}_${currency}_${randomUUID()}`;
}
function decodePaymentId(providerPaymentId: string): { amountMinor: number; currency: string } {
  const match = /^test_(\d+)_([A-Za-z]{3})_/.exec(providerPaymentId);
  if (!match) throw new Error(`Malformed TEST providerPaymentId: ${providerPaymentId}`);
  return { amountMinor: Number(match[1]), currency: match[2]! };
}

/** Header carrying a TEST webhook's signature: hex HMAC-SHA256 of the raw request body. */
export const TEST_WEBHOOK_SIGNATURE_HEADER = "x-test-webhook-signature";

/** Signs a TEST webhook body — for local tooling and automated tests that play the provider's part. */
export function signTestWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export class TestPaymentProvider implements PaymentProvider {
  readonly key = "TEST" as const;

  /** Without a secret the TEST webhook refuses every call — it is never an open "mark this paid" endpoint. */
  constructor(private readonly webhookSecret?: string) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      providerPaymentId: encodePaymentId(input.amountMinor, input.currency),
      metadata: { paymentMethodType: "test", providerReference: input.orderId },
    };
  }

  async verifyPayment(providerPaymentId: string): Promise<PaymentVerificationResult> {
    const { amountMinor, currency } = decodePaymentId(providerPaymentId);
    return {
      providerPaymentId,
      status: "SUCCEEDED",
      amountMinor,
      currency,
      metadata: { paymentMethodType: "test" },
    };
  }

  async handleWebhook(rawBody: string, headers: Headers): Promise<WebhookResult> {
    if (!this.webhookSecret) throw new Error("TEST webhook is disabled (TEST_PAYMENTS_WEBHOOK_SECRET not set)");
    const presented = Buffer.from(headers.get(TEST_WEBHOOK_SIGNATURE_HEADER) ?? "", "utf8");
    const expected = Buffer.from(signTestWebhook(rawBody, this.webhookSecret), "utf8");
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new Error("TEST webhook signature invalid");
    }

    const parsed = JSON.parse(rawBody) as { orderId: string; providerPaymentId: string };
    const { amountMinor, currency } = decodePaymentId(parsed.providerPaymentId);
    return {
      orderId: parsed.orderId,
      providerPaymentId: parsed.providerPaymentId,
      status: "SUCCEEDED",
      amountMinor,
      currency,
      metadata: { paymentMethodType: "test" },
    };
  }

  async refundPayment(providerPaymentId: string, amountMinor = 0): Promise<RefundResult> {
    return { providerPaymentId, refundedAmountMinor: amountMinor, status: "REFUNDED" };
  }
}

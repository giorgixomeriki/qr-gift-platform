import "server-only";
import type {
  PaymentProvider,
  CreatePaymentResult,
  PaymentVerificationResult,
  WebhookResult,
  RefundResult,
} from "../types";
import { ProviderNotImplementedError } from "../types";

/**
 * Production-provider integration BOUNDARY for Bank of Georgia's merchant
 * payment API — deliberately NOT a working implementation. Every method
 * below throws ProviderNotImplementedError rather than fabricating a request
 * shape, an OAuth flow, a webhook signature scheme, or any other undocumented
 * behavior. This class exists so the rest of the codebase (provider-factory,
 * checkout, the webhook route, reconciliation) has a real integration point
 * to wire up against once official information is available — the seam is
 * ready; the network calls are not invented.
 *
 * Required before this can be implemented for real (none of this is
 * fabricated below — these are the categories of information genuinely
 * needed, not filled-in values):
 *
 *   - BOG merchant/client id and client secret (or whatever their current
 *     API calls them) — likely issued via BOG's merchant onboarding process.
 *   - The API base URL for sandbox vs. production (e.g. some `*.bog.ge`
 *     domain) — must come from BOG's own current developer documentation,
 *     not guessed.
 *   - The auth mechanism for calling BOG's API (OAuth2 client-credentials is
 *     typical for bank payment APIs, but the exact token endpoint, scopes,
 *     and token lifetime must come from BOG's docs).
 *   - The payment-creation request/response shape: what fields it expects
 *     (amount, currency, order reference, return URLs, language), what it
 *     returns (a payment/order id, a redirect URL, expiry).
 *   - The payment-status/verification endpoint: how to look up a payment by
 *     BOG's own id and what status values it returns.
 *   - The webhook/callback specification: URL registration process, request
 *     method/body shape, and — critically — the signature/authentication
 *     scheme BOG uses to prove a callback really came from them (HMAC header,
 *     RSA-signed JWT, mutual TLS, IP allowlist, etc). This is the single most
 *     important piece of missing information: fabricating this would be a
 *     genuine security hole (fake-signature verification is worse than none,
 *     since it looks safe).
 *   - The refund endpoint's request/response shape, if BOG's API supports
 *     partial/full refunds this way.
 *   - Sandbox test credentials to develop and test against before going live.
 *   - Production credentials, issued separately once the pilot is approved.
 *
 * See provider-factory.ts and lib/env.ts for the BOG_* environment variables
 * this adapter reads (client id/secret/base URL/webhook key) — those are
 * validated as present when PAYMENTS_PROVIDER=BOG, but their *content* being
 * present doesn't mean this adapter can act on it correctly yet, since the
 * request/response shapes above are still unknown.
 */
export class BOGPaymentProvider implements PaymentProvider {
  readonly key = "BOG" as const;

  constructor(private readonly config: { clientId: string; clientSecret: string; apiBaseUrl: string; webhookSigningKey: string }) {
    // Constructor intentionally does NOT make any network call (e.g. to fetch
    // an OAuth token) — with the token endpoint/flow undocumented here, doing
    // so would mean guessing at a request shape. It only stores config so a
    // real implementation has somewhere to read it from later.
    void this.config;
  }

  // These intentionally omit their (unused) parameters — TypeScript allows a
  // method implementation to declare fewer params than the interface it
  // satisfies, which avoids unused-parameter noise for a method whose entire
  // body is "this isn't implemented yet."
  async createPayment(): Promise<CreatePaymentResult> {
    throw new ProviderNotImplementedError(
      this.key,
      "createPayment",
      "BOG's payment-creation endpoint URL, request/response shape, and auth flow (see class doc comment)",
    );
  }

  async verifyPayment(): Promise<PaymentVerificationResult> {
    throw new ProviderNotImplementedError(
      this.key,
      "verifyPayment",
      "BOG's payment-status lookup endpoint and response shape",
    );
  }

  async handleWebhook(): Promise<WebhookResult> {
    throw new ProviderNotImplementedError(
      this.key,
      "handleWebhook",
      "BOG's webhook signature/authentication scheme — this must never be guessed, since a fabricated check would look safe while verifying nothing",
    );
  }

  async refundPayment(): Promise<RefundResult> {
    throw new ProviderNotImplementedError(this.key, "refundPayment", "BOG's refund endpoint request/response shape");
  }
}

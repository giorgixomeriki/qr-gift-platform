import "server-only";
import { env } from "@/lib/env";
import type { PaymentProvider } from "./types";
import { TestPaymentProvider } from "./providers/test-provider";
import { BOGPaymentProvider } from "./providers/bog-provider";

/**
 * The single place a concrete PaymentProvider is chosen. Hard-fails rather
 * than silently falling back if the TEST provider is ever selected in
 * production — "impossible to accidentally enable a fake-success payment
 * mechanism in production" (Phase 0.5 §7).
 */
export function getPaymentProvider(): PaymentProvider {
  if (env.PAYMENTS_PROVIDER === "TEST") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "PAYMENTS_PROVIDER=TEST is not allowed when NODE_ENV=production. " +
          "Configure a real payment provider before deploying.",
      );
    }
    return new TestPaymentProvider();
  }

  if (env.PAYMENTS_PROVIDER === "BOG") {
    // env.ts's loadEnv() already refuses to start at all if any of these are
    // missing — they're guaranteed present here, not re-checked defensively.
    return new BOGPaymentProvider({
      clientId: env.BOG_CLIENT_ID!,
      clientSecret: env.BOG_CLIENT_SECRET!,
      apiBaseUrl: env.BOG_API_BASE_URL!,
      webhookSigningKey: env.BOG_WEBHOOK_SIGNING_KEY!,
    });
  }

  throw new Error(`Unknown or unconfigured PAYMENTS_PROVIDER: "${env.PAYMENTS_PROVIDER}"`);
}

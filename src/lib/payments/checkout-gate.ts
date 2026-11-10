import "server-only";
import { env } from "@/lib/env";

/**
 * Real-money checkout is off unless CHECKOUT_ENABLED=true. The simulated TEST
 * provider is unaffected (it has its own guards: provider-factory.ts). While
 * closed, no order is opened and no provider is called, so nothing is left
 * half-started at the bank.
 */
export class CheckoutUnavailableError extends Error {
  constructor() {
    super("Checkout is not open yet");
    this.name = "CheckoutUnavailableError";
  }
}

export function isCheckoutOpen(): boolean {
  // TEST is refused outright in production (provider-factory.ts), so a
  // production deployment without a real provider is simply closed: the
  // sender sees "payments open soon" rather than a provider error.
  if (env.PAYMENTS_PROVIDER === "TEST") return env.NODE_ENV !== "production";
  return env.CHECKOUT_ENABLED;
}

export function assertCheckoutOpen(): void {
  if (!isCheckoutOpen()) throw new CheckoutUnavailableError();
}

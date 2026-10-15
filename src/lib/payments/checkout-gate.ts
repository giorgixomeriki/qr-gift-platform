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
  return env.PAYMENTS_PROVIDER === "TEST" || env.CHECKOUT_ENABLED;
}

export function assertCheckoutOpen(): void {
  if (!isCheckoutOpen()) throw new CheckoutUnavailableError();
}

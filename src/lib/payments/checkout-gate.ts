import "server-only";
import { env } from "@/lib/env";
import { loadMerchantInfo, policiesInEffect } from "@/lib/merchant/info";

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

/**
 * Real-money checkout also needs the policies in force (LEGAL_EFFECTIVE_DATE
 * set after legal approval, and reached): consent to terms marked "not yet in
 * effect" is no consent. CHECKOUT_ENABLED alone never opens it.
 *
 * Owner pilot (M1): with CHECKOUT_ENABLED=false, a QR code listed in
 * CHECKOUT_PILOT_QR_IDS is still payable (same consent, same provider, same
 * money path). Every other card stays closed. Callers that know which card the
 * payment is for pass its qr_codes.id; without it only the global switch counts.
 */
export function isCheckoutOpen(qrCodeId?: string): boolean {
  // TEST is refused outright in production (provider-factory.ts), so a
  // production deployment without a real provider is simply closed: the
  // sender sees "payments open soon" rather than a provider error.
  if (env.PAYMENTS_PROVIDER === "TEST") return env.NODE_ENV !== "production";
  if (!policiesInEffect(loadMerchantInfo(process.env))) return false;
  if (env.CHECKOUT_ENABLED) return true;
  return !!qrCodeId && env.CHECKOUT_PILOT_QR_IDS.includes(qrCodeId.toLowerCase());
}

export function assertCheckoutOpen(qrCodeId?: string): void {
  if (!isCheckoutOpen(qrCodeId)) throw new CheckoutUnavailableError();
}

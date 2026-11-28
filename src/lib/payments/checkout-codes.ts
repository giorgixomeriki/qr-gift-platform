/**
 * Error codes a checkout server action returns in place of a message, for
 * outcomes the Checkout UI renders differently from a generic failure.
 * Plain module (no server-only) so client components can compare against it.
 */
export const CHECKOUT_CLOSED = "CHECKOUT_CLOSED";

/** A bank payment for this card is still open: show "still verifying", never Pay. */
export const PAYMENT_IN_PROGRESS = "PAYMENT_IN_PROGRESS";

/** The buyer did not give both checkout consents (terms + immediate activation). */
export const CONSENT_REQUIRED = "CONSENT_REQUIRED";

/** The two consents the buyer must give before payment; both must be literally true. */
export type CheckoutConsents = { terms: true; immediateActivation: true };
export const ALL_CHECKOUT_CONSENTS: CheckoutConsents = { terms: true, immediateActivation: true };

/** Server-side check of untrusted input: true only for { terms: true, immediateActivation: true }. */
export function isFullCheckoutConsent(value: unknown): value is CheckoutConsents {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.terms === true && v.immediateActivation === true;
}

/**
 * Error codes a checkout server action returns in place of a message, for
 * outcomes the Checkout UI renders differently from a generic failure.
 * Plain module (no server-only) so client components can compare against it.
 */
export const CHECKOUT_CLOSED = "CHECKOUT_CLOSED";

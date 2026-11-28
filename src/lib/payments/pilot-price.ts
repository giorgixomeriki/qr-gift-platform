import "server-only";
import { env } from "@/lib/env";
import { isCheckoutOpen } from "./checkout-gate";

/**
 * Owner pilot price (M1 at 1.00 GEL). Returns the pilot amount in tetri for
 * the designated pilot card, or null (= the normal server-resolved price).
 *
 * Applies only when ALL of these hold, every one of them server-side:
 *   - CHECKOUT_PILOT_PRICE_MINOR is set (validated: 100–100000, exactly one
 *     pilot card, never together with CHECKOUT_ENABLED=true; lib/env.ts);
 *   - public checkout is closed (CHECKOUT_ENABLED=false);
 *   - qrCodeId is the card listed in CHECKOUT_PILOT_QR_IDS;
 *   - checkout is open for that card (policies in force, real provider).
 *
 * qrCodeId always comes from the database (the greeting's own qr_code_id or
 * the resolved QR token), never from the request, so the browser cannot
 * select or change this price. The prices table is never written: every other
 * card, and the public display price, keep the configured price.
 */
export function pilotPriceOverrideMinor(qrCodeId: string | null | undefined): number | null {
  const amount = env.CHECKOUT_PILOT_PRICE_MINOR;
  if (amount === null || amount === undefined) return null;
  if (env.CHECKOUT_ENABLED) return null;
  if (!qrCodeId || env.CHECKOUT_PILOT_QR_IDS.length !== 1) return null;
  if (env.CHECKOUT_PILOT_QR_IDS[0] !== qrCodeId.toLowerCase()) return null;
  if (!isCheckoutOpen(qrCodeId)) return null;
  return amount;
}

export class PilotPriceMismatchError extends Error {
  constructor() {
    super("This order's amount no longer matches the card's price");
    this.name = "PilotPriceMismatchError";
  }
}

/**
 * Checked right before a bank payment is opened for an order. An order is
 * payable only at the amount the card is priced at now:
 *   - a pilot-priced order (price_id null, priced by the override) needs the
 *     override still in force for that card at exactly that amount;
 *   - while the override is in force for a card, an order for it at any other
 *     amount is refused.
 * So withdrawing the pilot price (unset the env var) also stops any open
 * 1.00 GEL order from ever reaching the bank.
 */
export function assertOrderAmountCurrent(order: { qrCodeId: string; priceId: string | null; grossAmountMinor: number }): void {
  const override = pilotPriceOverrideMinor(order.qrCodeId);
  if (order.priceId === null && override !== order.grossAmountMinor) throw new PilotPriceMismatchError();
  if (override !== null && order.grossAmountMinor !== override) throw new PilotPriceMismatchError();
}

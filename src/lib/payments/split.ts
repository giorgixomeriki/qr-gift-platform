/**
 * Client-safe pricing arithmetic (no server imports) — the single definition
 * of how an activation price is split, shared by checkout (which snapshots
 * the result into the order) and the admin pricing preview (which only
 * displays it). All amounts are integer minor units (tetri); rates are basis
 * points (1/100 of a percent: 3000 = 30%).
 *
 * Rounding: the partner commission is rounded DOWN to a whole tetri,
 * floor(gross × bps / 10000), and the platform share is the remainder. The
 * two always add up to exactly the gross amount (orders_amounts_reconcile),
 * any sub-tetri fraction goes to the platform, and the result depends only
 * on (gross, bps) — never on the order in which anything ran.
 */

/** Admin-configurable activation price bounds: 1.00 – 1,000.00 GEL. */
export const MIN_PRICE_MINOR = 100;
export const MAX_PRICE_MINOR = 100_000;
export const MAX_COMMISSION_BPS = 10_000;

export class PricingArithmeticError extends Error {}

export function splitCommission(grossAmountMinor: number, commissionRateBps: number) {
  if (!Number.isSafeInteger(grossAmountMinor) || grossAmountMinor < 0) {
    throw new PricingArithmeticError(`Gross amount must be a non-negative integer of minor units (got ${grossAmountMinor})`);
  }
  if (!Number.isInteger(commissionRateBps) || commissionRateBps < 0 || commissionRateBps > MAX_COMMISSION_BPS) {
    throw new PricingArithmeticError(`Commission rate must be an integer in [0, ${MAX_COMMISSION_BPS}] bps (got ${commissionRateBps})`);
  }
  const partnerCommissionMinor = Math.floor((grossAmountMinor * commissionRateBps) / 10000);
  const platformShareMinor = grossAmountMinor - partnerCommissionMinor;
  return { partnerCommissionMinor, platformShareMinor };
}

/**
 * "12", "12.5", "12.50", "12,50" → 1200 / 1250 / 1250 / 1250. Exact decimal
 * parsing with no floating point; at most two decimals. Returns null for
 * anything else (negative, empty, exponent, three decimals…).
 */
export function parseMajorToMinor(input: string): number | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** "30", "30.5", "12.25" (percent) → 3000 / 3050 / 1225 bps. Same exact parsing; null if not in [0, 100]. */
export function parsePercentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= MAX_COMMISSION_BPS ? bps : null;
}

/** 3050 → "30.5", 3000 → "30", 1225 → "12.25" — the inverse of parsePercentToBps, for display and form defaults. */
export function formatBpsAsPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** 1250 → "12.50", 1000 → "10.00" — form default for a price field. */
export function formatMinorAsMajorInput(amountMinor: number): string {
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

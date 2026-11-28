export type StandardPrice = { amountMinor: number; currency: string };

/**
 * The single active platform-default price, or null when there is none or
 * more than one. More than one active default is a data error (checkout would
 * pick one arbitrarily; ops:check-launch-pricing flags it), so the public
 * pricing page shows "unavailable" rather than a price that might not be the
 * one charged.
 */
export function pickStandardPrice(rows: StandardPrice[]): StandardPrice | null {
  return rows.length === 1 ? rows[0]! : null;
}

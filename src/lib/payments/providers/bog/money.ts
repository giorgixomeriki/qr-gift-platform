/**
 * BOG's API speaks major units as JSON numbers (10.00 GEL → 10); the app
 * speaks integer minor units (1000 tetri). These two functions are the only
 * crossing between them, and both refuse anything that is not an exact whole
 * number of minor units, so a floating-point artefact can never silently
 * change an amount in either direction.
 */
export class MoneyConversionError extends Error {}

export function minorToMajor(amountMinor: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new MoneyConversionError(`Minor amount must be a non-negative integer, got ${amountMinor}`);
  }
  // Division by 100 of an integer is exact to two decimals once rounded to
  // the nearest representable double, which is what JSON.stringify prints.
  return Number((amountMinor / 100).toFixed(2));
}

export function majorToMinor(amount: number | string): number {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (typeof amount === "string" && !/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
    throw new MoneyConversionError(`Not a major amount: "${amount}"`);
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new MoneyConversionError(`Major amount must be a non-negative finite number, got ${amount}`);
  }
  const minor = Math.round(value * 100);
  if (Math.abs(value * 100 - minor) > 1e-6 || !Number.isSafeInteger(minor)) {
    throw new MoneyConversionError(`Major amount ${amount} is not a whole number of minor units`);
  }
  return minor;
}

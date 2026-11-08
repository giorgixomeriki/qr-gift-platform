/**
 * How long an activated greeting can be opened (owner decision 2026-11-06):
 * 12 months after its payment-verified activation.
 *
 * Source of truth: greetings.activated_at, written once by activatePaidOrder
 * (lib/payments/service.ts) — never by the browser. Nothing is stored or
 * scheduled: availability is derived on every request, so no migration is
 * needed and the rule applies retroactively to every greeting.
 *
 * Availability is NOT data retention. An expired greeting is no longer shown
 * at its QR code, but its rows and media are kept unchanged; deleting them
 * needs a separately approved retention policy (privacy policy D1).
 *
 * Pure (no server-only) so tests can call it.
 */
export const GREETING_AVAILABILITY_MONTHS = 12;

/**
 * The first instant the greeting is no longer available: activation + 12
 * calendar months, in UTC. A day that does not exist in the target month is
 * clamped to its last day (activated 29 Feb → available until 28 Feb next year).
 */
export function greetingAvailableUntil(activatedAt: Date): Date {
  const y = activatedAt.getUTCFullYear();
  const m = activatedAt.getUTCMonth() + GREETING_AVAILABILITY_MONTHS;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = m % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(activatedAt.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(targetYear, targetMonth, day, activatedAt.getUTCHours(), activatedAt.getUTCMinutes(), activatedAt.getUTCSeconds(), activatedAt.getUTCMilliseconds()),
  );
}

/**
 * Has this activated greeting passed its availability window? A greeting with
 * no activation timestamp (none exist in production: activatePaidOrder always
 * sets it) is treated as available — the rule never hides a greeting on
 * missing data.
 */
export function isGreetingExpired(activatedAt: Date | null, now: Date = new Date()): boolean {
  if (!activatedAt) return false;
  return now.getTime() >= greetingAvailableUntil(activatedAt).getTime();
}

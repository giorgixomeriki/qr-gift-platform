/**
 * Business calendar — the ONE place that knows which timezone defines QR
 * Starr's business days (payout periods, "today", date-based financial
 * summaries). Timestamps stay UTC instants everywhere (DB, logic); only
 * CALENDAR DATES ("2026-10-05") are interpreted here, in BUSINESS_TIME_ZONE,
 * and turned into half-open UTC ranges [start, end) for queries.
 *
 * Pure Intl, no offset arithmetic and no server-only imports, so the admin
 * UI (display, date-picker defaults) and the server (authoritative
 * validation) share exactly the same rules. Never depends on the host's or
 * browser's own timezone.
 *
 * Another market later = another IANA zone here; financial queries only ever
 * see UTC instants and don't change.
 */
export const BUSINESS_TIME_ZONE = "Asia/Tbilisi";

/** A business calendar date, "YYYY-MM-DD". */
export type BusinessDate = string;

const BUSINESS_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Wall-clock fields of `instant` in the business timezone. */
function wallClock(instant: Date) {
  const get = (type: string) => Number(partsFormatter.formatToParts(instant).find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset (ms) of the business timezone from UTC at `instant`, derived from Intl — never hardcoded. */
function zoneOffsetMs(instant: Date): number {
  const w = wallClock(instant);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function isBusinessDate(value: string): value is BusinessDate {
  const m = BUSINESS_DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The business date an instant falls on (e.g. 2026-10-04T20:30Z -> "2026-10-05" in Tbilisi). */
export function businessDateOf(instant: Date): BusinessDate {
  const w = wallClock(instant);
  return `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Calendar arithmetic on business dates (no timezone involved). */
export function addBusinessDays(date: BusinessDate, days: number): BusinessDate {
  if (!isBusinessDate(date)) throw new Error(`Invalid business date: ${date}`);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** UTC instant at which `date` begins (00:00:00 local) in the business timezone. */
export function businessDayStart(date: BusinessDate): Date {
  if (!isBusinessDate(date)) throw new Error(`Invalid business date: ${date}`);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const localMidnightAsUtc = Date.UTC(y, m - 1, d);
  // Two passes so a DST transition between the guess and the answer is handled.
  let instant = localMidnightAsUtc - zoneOffsetMs(new Date(localMidnightAsUtc));
  instant = localMidnightAsUtc - zoneOffsetMs(new Date(instant));
  return new Date(instant);
}

/**
 * Whole business days `from`..`to` (both inclusive as calendar dates) as a
 * half-open UTC range [periodFrom, periodTo): periodTo is the start of the
 * day AFTER `to`. Consecutive periods share a boundary instant without
 * overlapping or leaving a gap — no instant is ever in two periods or none.
 */
export function businessDayRange(from: BusinessDate, to: BusinessDate): { periodFrom: Date; periodTo: Date } {
  return { periodFrom: businessDayStart(from), periodTo: businessDayStart(addBusinessDays(to, 1)) };
}

/** Today's business date (authoritative "today" — not the browser's or host's date). */
export function businessToday(now: Date = new Date()): BusinessDate {
  return businessDateOf(now);
}

/** The most recent business date that has fully ended (= yesterday in the business timezone). */
export function lastClosedBusinessDate(now: Date = new Date()): BusinessDate {
  return addBusinessDays(businessToday(now), -1);
}

/** True when the half-open range ending at `periodTo` lies entirely in the past. */
export function isPeriodClosed(periodTo: Date, now: Date = new Date()): boolean {
  return periodTo.getTime() <= now.getTime();
}

/** The last business date covered by a half-open period end (for display: [from, to) -> "… – to-1day"). */
export function lastBusinessDateOfPeriod(periodTo: Date): BusinessDate {
  return businessDateOf(new Date(periodTo.getTime() - 1));
}

/** Locale-formatted date in the business timezone (financial displays). */
export function formatBusinessDate(instant: Date | string, locale: string): string {
  return new Date(instant).toLocaleDateString(locale === "ka" ? "ka-GE" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

/** Locale-formatted date + time in the business timezone (financial displays). */
export function formatBusinessDateTime(instant: Date | string, locale: string): string {
  return new Date(instant).toLocaleString(locale === "ka" ? "ka-GE" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

/** Formats a stored half-open period as its business dates, e.g. "1 Oct 2026 – 31 Oct 2026". */
export function formatBusinessPeriod(periodFrom: Date | string, periodTo: Date | string, locale: string): string {
  const lastInstant = new Date(new Date(periodTo).getTime() - 1);
  return `${formatBusinessDate(periodFrom, locale)} – ${formatBusinessDate(lastInstant, locale)}`;
}

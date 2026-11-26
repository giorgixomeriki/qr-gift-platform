/**
 * Scheduled Reveal + Celebration Countdown — time arithmetic.
 *
 * Pure (no server-only, no dependencies) so the server actions, the client
 * fields and the verify script share exactly one implementation.
 *
 * The sender picks a wall-clock date and time in a named IANA zone ("14 Feb
 * 2027, 20:00, Asia/Tbilisi"). It is converted to an absolute instant ONCE,
 * on the server, and stored as timestamptz; everything after that (unlocking,
 * counting down) works on instants only, so the recipient's zone and device
 * clock can never move the moment. The zone is kept for display ("20:00
 * Tbilisi time").
 *
 * Daylight-saving rules:
 *  - A wall time that does not exist (the hour skipped when clocks go
 *    forward) is refused — never silently shifted — so the sender sees it.
 *  - A wall time that happens twice (clocks go back) resolves to the FIRST
 *    occurrence, i.e. the earlier instant.
 */

/** A greeting may be scheduled at most this far ahead: always inside its 12-month availability (lib/greetings/availability.ts), which only starts at activation, later than any save. */
export const UNLOCK_MAX_DAYS = 360;
/** An unlock time must be at least this far in the future when it is saved. */
export const UNLOCK_MIN_LEAD_MS = 60_000;
/** An event countdown may target at most this far ahead (an engagement long before the wedding). */
export const COUNTDOWN_MAX_DAYS = 3 * 366;
/** After the event, "today is the day" lasts this long; then the countdown reads as a date that has been celebrated. */
export const CELEBRATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The zone the product is sold in; the default when the device's zone is unknown. */
export const DEFAULT_TIME_ZONE = "Asia/Tbilisi";

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length < 1 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

type Wall = { y: number; mo: number; d: number; h: number; mi: number };

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** The wall-clock reading of an instant in a zone. */
export function wallTimeIn(instantMs: number, tz: string): Wall & { s: number } {
  const parts = partsFormatter(tz).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** UTC offset of a zone at an instant, in ms (Tbilisi: +4h). */
function offsetAt(instantMs: number, tz: string): number {
  const w = wallTimeIn(instantMs, tz);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return asUtc - (instantMs - (((instantMs % 1000) + 1000) % 1000));
}

export type ZonedResult = { ok: true; instant: Date } | { ok: false; error: "invalid" | "nonexistent" };

/** "2027-02-14" + "20:00" in "Asia/Tbilisi" → the instant. See the DST rules above. */
export function zonedWallTimeToUtc(date: string, time: string, tz: string): ZonedResult {
  const dm = DATE_RE.exec(date);
  const tm = TIME_RE.exec(time);
  if (!dm || !tm || !isValidTimeZone(tz)) return { ok: false, error: "invalid" };
  const want: Wall = { y: +dm[1]!, mo: +dm[2]!, d: +dm[3]!, h: +tm[1]!, mi: +tm[2]! };
  if (want.mo < 1 || want.mo > 12 || want.d < 1 || want.h > 23 || want.mi > 59) return { ok: false, error: "invalid" };
  const naive = Date.UTC(want.y, want.mo - 1, want.d, want.h, want.mi);
  // A calendar day that does not exist (31 April) rolls over in Date.UTC: refuse it.
  const check = new Date(naive);
  if (check.getUTCFullYear() !== want.y || check.getUTCMonth() !== want.mo - 1 || check.getUTCDate() !== want.d) return { ok: false, error: "invalid" };

  // Every offset the zone has around that day; keep the candidates that read back as the wanted wall time.
  const offsets = new Set([offsetAt(naive - DAY_MS, tz), offsetAt(naive, tz), offsetAt(naive + DAY_MS, tz)]);
  const matches = [...offsets]
    .map((o) => naive - o)
    .filter((t) => {
      const w = wallTimeIn(t, tz);
      return w.y === want.y && w.mo === want.mo && w.d === want.d && w.h === want.h && w.mi === want.mi;
    })
    .sort((a, b) => a - b);
  if (matches.length === 0) return { ok: false, error: "nonexistent" };
  return { ok: true, instant: new Date(matches[0]!) };
}

/** The instant as "YYYY-MM-DD" + "HH:MM" in a zone (to put a saved value back into the date/time fields). */
export function utcToZonedFields(instant: Date, tz: string): { date: string; time: string } {
  const w = wallTimeIn(instant.getTime(), tz);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return { date: `${p(w.y, 4)}-${p(w.mo)}-${p(w.d)}`, time: `${p(w.h)}:${p(w.mi)}` };
}

export type ScheduleError = "invalid" | "nonexistent" | "past" | "too_far";

/** Validates an unlock instant at save time (server clock). */
export function checkUnlockInstant(instant: Date, nowMs: number = Date.now()): ScheduleError | null {
  const t = instant.getTime();
  if (!Number.isFinite(t)) return "invalid";
  if (t < nowMs + UNLOCK_MIN_LEAD_MS) return "past";
  if (t > nowMs + UNLOCK_MAX_DAYS * DAY_MS) return "too_far";
  return null;
}

/** Validates an event countdown target at save time (server clock). */
export function checkCountdownInstant(instant: Date, nowMs: number = Date.now()): ScheduleError | null {
  const t = instant.getTime();
  if (!Number.isFinite(t)) return "invalid";
  if (t <= nowMs) return "past";
  if (t > nowMs + COUNTDOWN_MAX_DAYS * DAY_MS) return "too_far";
  return null;
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number; totalMs: number };

/** Remaining time split into units, never negative (0 once the moment has come). */
export function countdownParts(remainingMs: number): CountdownParts {
  const ms = Math.max(0, remainingMs);
  const total = Math.ceil(ms / 1000); // 0.4 s left still reads 00:00:01 — never 0 before the moment
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    totalMs: ms,
  };
}

export type CountdownPhase = "counting" | "today" | "celebrated";

/** Where an event countdown is: still counting, the day itself (24 h from the moment), or a date that has passed. */
export function countdownPhase(targetMs: number, nowMs: number): CountdownPhase {
  if (nowMs < targetMs) return "counting";
  if (nowMs < targetMs + CELEBRATION_WINDOW_MS) return "today";
  return "celebrated";
}

/** A zone's name for people ("Tbilisi"), from its IANA id. */
export function cityOfZone(tz: string): string {
  const last = tz.split("/").pop() ?? tz;
  return last.replace(/_/g, " ");
}

import { z } from "zod";
import { isValidTimeZone } from "./schedule";

/**
 * Celebration Countdown — the stored shape.
 *
 * One greeting_content row (type "countdown", slot 0, READY) whose text_value
 * is this JSON document. Being greeting content it inherits everything the
 * message has: editable only while DRAFT, readable by the public only when
 * app_greeting_public_state() = 'OPEN' (migrations/0030), never visible
 * before a scheduled unlock.
 *
 * Pure (shared by server, client and the verify script).
 */

export const COUNTDOWN_STYLES = ["editorial", "atelier", "midnight"] as const;
export type CountdownStyle = (typeof COUNTDOWN_STYLES)[number];

/** Occasion presets only suggest a title; the title the sender types is what is stored. */
export const COUNTDOWN_OCCASIONS = ["wedding", "birthday", "anniversary", "reunion", "vacation", "baby", "newYear", "custom"] as const;
export type CountdownOccasion = (typeof COUNTDOWN_OCCASIONS)[number];

export const COUNTDOWN_TITLE_MAX = 48;
export const COUNTDOWN_NOTE_MAX = 140;

/** Single line: newlines and runs of whitespace collapse to one space. */
const line = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

export const countdownInputSchema = z.object({
  title: line(COUNTDOWN_TITLE_MAX).pipe(z.string().min(1)),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  timeZone: z.string().refine(isValidTimeZone),
  style: z.enum(COUNTDOWN_STYLES),
  note: line(COUNTDOWN_NOTE_MAX).optional().default(""),
  occasion: z.enum(COUNTDOWN_OCCASIONS).optional().default("custom"),
});
export type CountdownInput = z.input<typeof countdownInputSchema>;

const storedSchema = z.object({
  v: z.literal(1),
  title: z.string().min(1).max(COUNTDOWN_TITLE_MAX),
  at: z.string().datetime({ offset: true }),
  tz: z.string().refine(isValidTimeZone),
  style: z.enum(COUNTDOWN_STYLES),
  note: z.string().max(COUNTDOWN_NOTE_MAX).optional(),
  occasion: z.enum(COUNTDOWN_OCCASIONS).optional(),
});

/** What the renderer gets: the moment as an instant, its zone for display. */
export type EventCountdown = {
  title: string;
  /** ISO instant (UTC). */
  at: string;
  timeZone: string;
  style: CountdownStyle;
  note: string | null;
  occasion: CountdownOccasion;
};

export function serializeCountdown(c: EventCountdown): string {
  return JSON.stringify({ v: 1, title: c.title, at: c.at, tz: c.timeZone, style: c.style, note: c.note || undefined, occasion: c.occasion });
}

/** A stored row back to a countdown; anything malformed is dropped (never rendered, never thrown). */
export function parseStoredCountdown(textValue: string | null | undefined): EventCountdown | null {
  if (!textValue) return null;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(textValue));
    if (!parsed.success) return null;
    const d = parsed.data;
    return { title: d.title, at: new Date(d.at).toISOString(), timeZone: d.tz, style: d.style, note: d.note?.trim() || null, occasion: d.occasion ?? "custom" };
  } catch {
    return null;
  }
}

import { z } from "zod";

/**
 * Partner login contacts: one Georgian mobile number and/or one email.
 * Pure and client-safe, so forms can normalize what the server will store.
 */

/** E.164 Georgian mobile: +995 then a 9-digit number starting with 5. */
export const GEORGIAN_MOBILE_E164 = /^\+9955\d{8}$/;

/**
 * Accepts the ways people write a Georgian mobile number — "555 12 34 56",
 * "+995 555-123-456", "995555123456", "00995 555 123456" — and returns
 * "+995555123456", or null when it is not a Georgian mobile number.
 * Landlines (+995 32…) and foreign numbers are refused on purpose.
 */
export function normalizeGeorgianMobile(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, "");
  let digits: string;
  if (compact.startsWith("+")) digits = compact.slice(1);
  else if (compact.startsWith("00")) digits = compact.slice(2);
  else digits = compact;
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 9) digits = `995${digits}`;
  const e164 = `+${digits}`;
  return GEORGIAN_MOBILE_E164.test(e164) ? e164 : null;
}

const emailSchema = z.email().max(254);

/** Lowercased, trimmed email, or null when it is not a valid address. */
export function normalizeEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  return emailSchema.safeParse(value).success ? value : null;
}

/** Supabase Auth stores phones without the "+" ("995555123456"). */
export function toAuthPhone(e164: string): string {
  return e164.replace(/^\+/, "");
}

/** Normalizes a phone as Supabase Auth returns it back to E.164. */
export function fromAuthPhone(authPhone: string | null | undefined): string | null {
  if (!authPhone) return null;
  return normalizeGeorgianMobile(authPhone.startsWith("+") ? authPhone : `+${authPhone}`);
}

/** "+995 5•• ••• •56": enough to recognize, not enough to harvest. */
export function maskPhone(e164: string): string {
  const local = e164.replace(/^\+995/, "");
  return `+995 ${local.slice(0, 1)}•• ••• •${local.slice(-2)}`;
}

/** "g•••@gmail.com". */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** Display form "+995 555 12 34 56". */
export function formatGeorgianMobile(e164: string): string {
  const local = e164.replace(/^\+995/, "");
  return `+995 ${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`;
}

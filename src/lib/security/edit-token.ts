import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Sender edit-token scheme (architecture plan §7).
 *
 * The public QR token (`qr_codes.public_token`) is a *permanent identity* — it is
 * what's printed on the card and must always be enough to resolve QR state. It is
 * deliberately NOT sufficient authorization to mutate a greeting: possession of
 * the public URL alone must not let someone edit a draft, in case the same QR
 * URL becomes visible to more than one person before activation (photographed,
 * shared, etc).
 *
 * So a second, unrelated secret is minted when a sender starts a draft: the edit
 * token. It is:
 *   - generated with crypto-secure randomness (32 bytes)
 *   - returned to the client ONLY inside an HttpOnly cookie — the server never
 *     needs to display or re-derive the plaintext value
 *   - stored in the DB only as an HMAC-SHA256 hash (`greetings.edit_token_hash`),
 *     keyed with a server-side secret, so a DB leak alone doesn't let an attacker
 *     forge or brute-force-verify tokens offline against a bare hash
 *   - cleared to NULL the moment the greeting leaves DRAFT, so a cached/leaked
 *     cookie can't be replayed to mutate an activated greeting
 */

const COOKIE_PREFIX = "qr_edit_";

export function generateEditToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashEditToken(token: string): string {
  return createHmac("sha256", env.EDIT_TOKEN_SECRET).update(token).digest("hex");
}

export function verifyEditToken(token: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const candidate = Buffer.from(hashEditToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function editTokenCookieName(greetingId: string): string {
  return `${COOKIE_PREFIX}${greetingId}`;
}

export const EDIT_TOKEN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  // A QR scan is a top-level GET navigation, so "lax" (not "strict") is required
  // for the cookie to be sent on that first request while still blocking
  // cross-site POST/CSRF use.
  path: "/",
  maxAge: 60 * 60 * 24 * 14, // 14 days — generous for an abandoned-then-resumed draft
};

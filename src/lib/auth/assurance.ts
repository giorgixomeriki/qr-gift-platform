/**
 * The admin access decision, as pure functions (no I/O) so every outcome can
 * be tested directly. lib/auth/admin.ts feeds them verified server-side facts;
 * nothing client-supplied ever reaches them.
 */
export type Aal = "aal1" | "aal2" | null;
export type AdminAccess = "ANONYMOUS" | "NOT_ADMIN" | "MFA_LOCKED" | "MFA_ENROLL" | "MFA_CHALLENGE" | "GRANTED";

/**
 * Supabase lets any password session enroll a first factor through its public
 * API, so "has a verified factor" alone proves nothing about who enrolled it.
 * An admin factor counts only if the server authorized it, and enrolling needs
 * an operator-issued, expiring grant. Both live in auth app_metadata, which a
 * user cannot write. Any verified factor outside the list locks the account
 * until an operator resets it.
 */
export function decideAdminAccess(facts: {
  signedIn: boolean;
  isAdmin: boolean;
  aal: Aal;
  authorizedFactors: number;
  unauthorizedFactors: number;
  enrollmentAuthorized: boolean;
}): AdminAccess {
  if (!facts.signedIn) return "ANONYMOUS";
  if (!facts.isAdmin) return "NOT_ADMIN";
  if (facts.unauthorizedFactors > 0) return "MFA_LOCKED";
  if (facts.authorizedFactors === 0) return facts.enrollmentAuthorized ? "MFA_ENROLL" : "MFA_LOCKED";
  return facts.aal === "aal2" ? "GRANTED" : "MFA_CHALLENGE";
}

export type AdminMfaPolicy = { enrollmentAuthorized: boolean; factorIds: Set<string> };

/** Reads app_metadata.admin_mfa. Anything malformed means no grant and no authorized factors. */
export function readAdminMfaPolicy(appMetadata: unknown, now = Date.now()): AdminMfaPolicy {
  const raw = (appMetadata as { admin_mfa?: { enrollment_until?: unknown; factor_ids?: unknown } } | null | undefined)?.admin_mfa;
  const until = typeof raw?.enrollment_until === "string" ? Date.parse(raw.enrollment_until) : NaN;
  const ids = Array.isArray(raw?.factor_ids) ? raw.factor_ids.filter((id): id is string => typeof id === "string") : [];
  return { enrollmentAuthorized: Number.isFinite(until) && until > now, factorIds: new Set(ids) };
}

export const ADMIN_MFA_ENROLL_PATH = "/admin/mfa/setup";
export const ADMIN_MFA_CHALLENGE_PATH = "/admin/mfa";
export const ADMIN_MFA_LOCKED_PATH = "/admin/mfa/locked";

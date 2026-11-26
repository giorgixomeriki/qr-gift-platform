/**
 * The admin access decision, as pure functions (no I/O) so every outcome can
 * be tested directly. lib/auth/admin.ts feeds them verified server-side facts;
 * nothing client-supplied ever reaches them.
 */
export type Aal = "aal1" | "aal2" | null;
export type AdminAccess = "ANONYMOUS" | "NOT_ADMIN" | "MFA_LOCKED" | "MFA_ENROLL" | "MFA_CHALLENGE" | "GRANTED" | "GRANTED_MFA_PAUSED";

/** Access that may use the admin area. GRANTED_MFA_PAUSED is admin access without financial actions. */
export function isAdminGranted(access: AdminAccess): access is "GRANTED" | "GRANTED_MFA_PAUSED" {
  return access === "GRANTED" || access === "GRANTED_MFA_PAUSED";
}

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
  /** True only when the temporary MFA pause (readAdminMfaPause) names this user and has not expired. */
  mfaPaused?: boolean;
}): AdminAccess {
  if (!facts.signedIn) return "ANONYMOUS";
  if (!facts.isAdmin) return "NOT_ADMIN";
  // A factor nobody authorized means someone else enrolled it: locked even while MFA is paused.
  if (facts.unauthorizedFactors > 0) return "MFA_LOCKED";
  if (facts.authorizedFactors > 0 && facts.aal === "aal2") return "GRANTED";
  // An operator enrollment grant wins over the pause, so restoring MFA always routes to enrollment.
  if (facts.authorizedFactors === 0 && facts.enrollmentAuthorized) return "MFA_ENROLL";
  if (facts.mfaPaused && facts.aal !== null) return "GRANTED_MFA_PAUSED";
  return facts.authorizedFactors === 0 ? "MFA_LOCKED" : "MFA_CHALLENGE";
}

/**
 * Temporary admin MFA pause (docs/security/ADMIN_MFA_TEMPORARY_PAUSE.md), for
 * an owner who lost their authenticator. Off unless BOTH variables are set
 * and valid: ADMIN_MFA_PAUSE_USER_ID names exactly one account (it must still
 * be in admin_users), and ADMIN_MFA_PAUSE_UNTIL is an ISO time in the future
 * and at most ADMIN_MFA_PAUSE_MAX_DAYS away. Anything malformed, expired or
 * too long means MFA stays required: it fails closed, never open.
 */
export const ADMIN_MFA_PAUSE_MAX_DAYS = 31;
export type AdminMfaPause = { active: false; problem: string | null } | { active: true; userId: string; until: Date };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readAdminMfaPause(userId: string | undefined, until: string | undefined, now = Date.now()): AdminMfaPause {
  const id = userId?.trim() ?? "";
  const at = until?.trim() ?? "";
  if (!id && !at) return { active: false, problem: null };
  if (!UUID.test(id)) return { active: false, problem: "ADMIN_MFA_PAUSE_USER_ID is not a single user id" };
  // A date without a time zone would be read in the server's zone; require an explicit one.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(at)) {
    return { active: false, problem: "ADMIN_MFA_PAUSE_UNTIL is not an ISO time with a zone" };
  }
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return { active: false, problem: "ADMIN_MFA_PAUSE_UNTIL is not a valid time" };
  if (ms <= now) return { active: false, problem: "ADMIN_MFA_PAUSE_UNTIL has passed" };
  if (ms - now > ADMIN_MFA_PAUSE_MAX_DAYS * 86_400_000) return { active: false, problem: `ADMIN_MFA_PAUSE_UNTIL is more than ${ADMIN_MFA_PAUSE_MAX_DAYS} days away` };
  return { active: true, userId: id.toLowerCase(), until: new Date(ms) };
}

export function isMfaPausedFor(pause: AdminMfaPause, userId: string): boolean {
  return pause.active && pause.userId === userId.toLowerCase();
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

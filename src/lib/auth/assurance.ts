/**
 * The admin access decision, as a pure function (no I/O) so every outcome can
 * be tested directly. lib/auth/admin.ts feeds it verified server-side facts;
 * nothing client-supplied ever reaches it.
 */
export type Aal = "aal1" | "aal2" | null;
export type AdminAccess = "ANONYMOUS" | "NOT_ADMIN" | "MFA_ENROLL" | "MFA_CHALLENGE" | "GRANTED";

export function decideAdminAccess(facts: { signedIn: boolean; isAdmin: boolean; aal: Aal; hasVerifiedFactor: boolean }): AdminAccess {
  if (!facts.signedIn) return "ANONYMOUS";
  if (!facts.isAdmin) return "NOT_ADMIN";
  if (!facts.hasVerifiedFactor) return "MFA_ENROLL"; // includes an aal2 session whose factor was reset
  return facts.aal === "aal2" ? "GRANTED" : "MFA_CHALLENGE";
}

export const ADMIN_MFA_ENROLL_PATH = "/admin/mfa/setup";
export const ADMIN_MFA_CHALLENGE_PATH = "/admin/mfa";

import "server-only";
import { redirect } from "next/navigation";
import { checkIsAdmin, withAdminContext, type Tx } from "@/db/client";
import { ADMIN_MFA_CHALLENGE_PATH, ADMIN_MFA_ENROLL_PATH, ADMIN_MFA_LOCKED_PATH, decideAdminAccess, type AdminAccess } from "./assurance";
import { getSessionAssurance, type SessionUser, type VerifiedFactor } from "./session";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** A real admin whose session has not completed MFA. */
export class MfaRequiredError extends UnauthorizedError {
  constructor() {
    super("Multi-factor authentication required");
    this.name = "MfaRequiredError";
  }
}

export type AdminSession = { access: AdminAccess; user: SessionUser | null; factors: VerifiedFactor[]; authorizedFactorIds: Set<string> };

/** The one place admin access is decided, from verified server-side facts only. */
export async function getAdminAccess(): Promise<AdminSession> {
  const session = await getSessionAssurance();
  if (!session) return { access: "ANONYMOUS", user: null, factors: [], authorizedFactorIds: new Set() };

  const isAdmin = await checkIsAdmin(session.user.id);
  const access = decideAdminAccess({
    signedIn: true,
    isAdmin,
    aal: session.aal,
    authorizedFactors: session.factors.length,
    unauthorizedFactors: session.unauthorizedFactors,
    enrollmentAuthorized: session.enrollmentAuthorized,
  });
  return { access, user: session.user, factors: session.factors, authorizedFactorIds: session.authorizedFactorIds };
}

/**
 * Verifies the current request is an authenticated admin with a verified
 * second factor (aal2) and returns a transaction scoped to that identity.
 * Every admin route handler/server action must go through this rather than
 * trusting any client-supplied flag.
 */
export async function requireAdmin<T>(fn: (tx: Tx, adminUserId: string) => Promise<T>): Promise<T> {
  const { access, user } = await getAdminAccess();
  if (!user) throw new UnauthorizedError("Not signed in");
  if (access === "NOT_ADMIN") throw new UnauthorizedError("Not an admin");
  if (access !== "GRANTED") throw new MfaRequiredError();

  return withAdminContext(user.id, (tx) => fn(tx, user.id));
}

/**
 * Guard for every admin page. Sends anyone who has not finished signing in to
 * the right step. A signed-in non-admin stays on the page with isAdmin=false
 * so it can render the NotAdmin message.
 */
export async function requireAdminPage(): Promise<{ user: SessionUser; isAdmin: boolean }> {
  const { access, user } = await getAdminAccess();
  if (!user) redirect("/admin/login");
  if (access === "MFA_LOCKED") redirect(ADMIN_MFA_LOCKED_PATH);
  if (access === "MFA_ENROLL") redirect(ADMIN_MFA_ENROLL_PATH);
  if (access === "MFA_CHALLENGE") redirect(ADMIN_MFA_CHALLENGE_PATH);
  return { user, isAdmin: access === "GRANTED" };
}

export type OperatorViewer =
  | { kind: "ANONYMOUS" }
  | { kind: "MFA_REQUIRED"; user: SessionUser }
  | { kind: "ADMIN" | "PARTNER"; user: SessionUser };

/**
 * For surfaces open to both admins and partners (QR assets, batch export and
 * print). Those authorize through RLS, where app_is_admin() depends only on
 * the user id, so an admin who has not passed MFA must be refused here rather
 * than treated as a partner: RLS would still give them the admin view.
 */
export async function resolveOperatorViewer(): Promise<OperatorViewer> {
  const { access, user } = await getAdminAccess();
  if (!user) return { kind: "ANONYMOUS" };
  if (access === "GRANTED") return { kind: "ADMIN", user };
  if (access === "NOT_ADMIN") return { kind: "PARTNER", user };
  return { kind: "MFA_REQUIRED", user };
}

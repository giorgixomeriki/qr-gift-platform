import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { partnerMembers, partners } from "@/db/schema";
import { getPartnerRole, withPartnerContext, withUserContext, type Tx } from "@/db/client";
import { getSessionUser } from "./session";
import { UnauthorizedError } from "./admin";

export const ACTIVE_PARTNER_COOKIE = "active_partner_id";

export type PartnerMembership = { partnerId: string; role: string };
export type PartnerMembershipWithName = PartnerMembership & { partnerName: string };

/**
 * A user can belong to multiple partners (architecture plan §"Partner
 * membership"). This lists all of the current session user's memberships —
 * used to render a partner switcher and to pick a default when none is
 * selected yet.
 */
export async function listMyPartnerMemberships(userId: string): Promise<PartnerMembership[]> {
  return withUserContext(userId, async (tx) => {
    const rows = await tx
      .select({ partnerId: partnerMembers.partnerId, role: partnerMembers.role })
      .from(partnerMembers)
      .where(eq(partnerMembers.userId, userId));
    return rows;
  });
}

/** Same as listMyPartnerMemberships, joined with the partner's display name (for a switcher UI). */
export async function listMyPartnerMembershipsWithNames(userId: string): Promise<PartnerMembershipWithName[]> {
  return withUserContext(userId, async (tx) => {
    return tx
      .select({ partnerId: partnerMembers.partnerId, role: partnerMembers.role, partnerName: partners.name })
      .from(partnerMembers)
      .innerJoin(partners, eq(partners.id, partnerMembers.partnerId))
      .where(eq(partnerMembers.userId, userId));
  });
}

/**
 * Resolves which partner the current request operates against and verifies
 * (server-side, against the DB — never trusting the cookie or a client-supplied
 * id alone) that the signed-in user actually belongs to it, then runs `fn`
 * inside a transaction scoped to that verified membership.
 *
 * `requestedPartnerId` should come from the route (e.g. /partner/[partnerId]/...)
 * when the UI is switching partners; otherwise the last-selected partner cookie
 * is used. Either way, membership is re-verified here — the cookie/route value
 * is only ever a hint about *which* partner to check, never proof of access.
 */
export async function requirePartnerContext<T>(
  fn: (tx: Tx, ctx: { userId: string; partnerId: string; role: string }) => Promise<T>,
  requestedPartnerId?: string,
): Promise<T> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError("Not signed in");

  const cookieStore = await cookies();
  let partnerId = requestedPartnerId ?? cookieStore.get(ACTIVE_PARTNER_COOKIE)?.value;

  // No explicit choice yet (route param or cookie) — default to the user's
  // first membership rather than failing. This is what makes single-partner
  // accounts (the common case) work without ever needing the switcher to run
  // first; a user with multiple memberships can still switch explicitly.
  if (!partnerId) {
    const memberships = await listMyPartnerMemberships(user.id);
    partnerId = memberships[0]?.partnerId;
  }
  if (!partnerId) throw new UnauthorizedError("No partner selected");

  const role = await getPartnerRole(user.id, partnerId);
  if (!role) throw new UnauthorizedError("Not a member of this partner");

  return withPartnerContext(user.id, partnerId, (tx) => fn(tx, { userId: user.id, partnerId, role }));
}

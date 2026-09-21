import "server-only";
import { and, eq, ne } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { partners, partnerMembers } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import { resolveOrInviteUserByEmail } from "@/lib/auth/admin-users";
import type {
  CreatePartnerInput,
  UpdatePartnerInput,
  AddPartnerMemberInput,
} from "@/lib/validation/partners";

export class PartnerServiceError extends Error {}

export async function createPartner(tx: Tx, adminUserId: string, input: CreatePartnerInput) {
  const [existing] = await tx.select({ id: partners.id }).from(partners).where(eq(partners.slug, input.slug)).limit(1);
  if (existing) throw new PartnerServiceError(`Slug "${input.slug}" is already in use`);

  const [created] = await tx
    .insert(partners)
    .values({
      slug: input.slug,
      name: input.name,
      defaultLocale: input.defaultLocale,
      country: input.country,
      currency: input.currency,
      commissionRateBps: input.commissionRateBps,
    })
    .returning();
  if (!created) throw new PartnerServiceError("Failed to create partner");

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_CREATED",
    targetType: "partner",
    targetId: created.id,
    metadata: { slug: created.slug, name: created.name },
  });

  return created;
}

export async function listPartners(tx: Tx) {
  return tx.select().from(partners).orderBy(partners.createdAt);
}

export async function getPartnerById(tx: Tx, partnerId: string) {
  const [row] = await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
  return row ?? null;
}

export async function updatePartner(
  tx: Tx,
  actor: { actorType: "ADMIN" | "PARTNER"; actorId: string },
  partnerId: string,
  input: UpdatePartnerInput,
) {
  const [updated] = await tx
    .update(partners)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(partners.id, partnerId))
    .returning();
  if (!updated) throw new PartnerServiceError("Partner not found or not authorized");

  await recordAuditLog(tx, {
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: "PARTNER_UPDATED",
    targetType: "partner",
    targetId: partnerId,
    metadata: input,
  });

  return updated;
}

export async function setPartnerStatus(
  tx: Tx,
  adminUserId: string,
  partnerId: string,
  status: "ACTIVE" | "SUSPENDED",
) {
  const [updated] = await tx
    .update(partners)
    .set({ status, updatedAt: new Date() })
    .where(eq(partners.id, partnerId))
    .returning();
  if (!updated) throw new PartnerServiceError("Partner not found or not authorized");

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: status === "SUSPENDED" ? "PARTNER_SUSPENDED" : "PARTNER_REACTIVATED",
    targetType: "partner",
    targetId: partnerId,
  });

  return updated;
}

export async function listPartnerMembers(tx: Tx, partnerId: string) {
  return tx
    .select()
    .from(partnerMembers)
    .where(eq(partnerMembers.partnerId, partnerId))
    .orderBy(partnerMembers.createdAt);
}

export async function addPartnerMember(
  tx: Tx,
  actor: { actorType: "ADMIN" | "PARTNER"; actorId: string },
  partnerId: string,
  input: AddPartnerMemberInput,
) {
  const [existing] = await tx
    .select({ id: partnerMembers.id })
    .from(partnerMembers)
    .where(and(eq(partnerMembers.partnerId, partnerId), eq(partnerMembers.userId, input.userId)))
    .limit(1);
  if (existing) throw new PartnerServiceError("User is already a member of this partner");

  const [created] = await tx
    .insert(partnerMembers)
    .values({ partnerId, userId: input.userId, role: input.role })
    .returning();
  if (!created) throw new PartnerServiceError("Failed to add member — not authorized");

  await recordAuditLog(tx, {
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: "PARTNER_MEMBER_ADDED",
    targetType: "partner_member",
    targetId: created.id,
    metadata: { partnerId, memberUserId: input.userId, role: input.role },
  });

  return created;
}

/**
 * Phase 5 §13's replacement for "type a raw Supabase UUID" — resolves (or
 * invites) the person by email via lib/auth/admin-users.ts, then delegates to
 * addPartnerMember exactly as before, so authorization/audit-logging is
 * unchanged: this is a friendlier front door onto the same function, not a
 * parallel membership-granting path.
 */
export async function addPartnerMemberByEmail(
  tx: Tx,
  actor: { actorType: "ADMIN" | "PARTNER"; actorId: string },
  partnerId: string,
  input: { email: string; role: AddPartnerMemberInput["role"] },
) {
  const { userId, invited } = await resolveOrInviteUserByEmail(input.email);
  const created = await addPartnerMember(tx, actor, partnerId, { userId, role: input.role });
  return { ...created, invited };
}

/**
 * Refuses to demote/remove the last remaining OWNER of a partner — otherwise
 * a partner could be left with no one able to manage membership at all
 * (not even an admin-assisted recovery path exists for that short of direct
 * DB access). Admins are exempt from this check when acting as a break-glass
 * path, since they're a separate authorization root entirely.
 */
async function assertNotLastOwner(tx: Tx, partnerId: string, memberUserId: string) {
  const owners = await tx
    .select({ userId: partnerMembers.userId })
    .from(partnerMembers)
    .where(and(eq(partnerMembers.partnerId, partnerId), eq(partnerMembers.role, "OWNER"), ne(partnerMembers.userId, memberUserId)));
  if (owners.length === 0) {
    throw new PartnerServiceError("Cannot remove or demote the last remaining OWNER of this partner");
  }
}

export async function updatePartnerMemberRole(
  tx: Tx,
  actor: { actorType: "ADMIN" | "PARTNER"; actorId: string },
  partnerId: string,
  memberUserId: string,
  role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER",
) {
  const [current] = await tx
    .select()
    .from(partnerMembers)
    .where(and(eq(partnerMembers.partnerId, partnerId), eq(partnerMembers.userId, memberUserId)))
    .limit(1);
  if (!current) throw new PartnerServiceError("Membership not found");

  if (current.role === "OWNER" && role !== "OWNER" && actor.actorType !== "ADMIN") {
    await assertNotLastOwner(tx, partnerId, memberUserId);
  }

  const [updated] = await tx
    .update(partnerMembers)
    .set({ role })
    .where(and(eq(partnerMembers.partnerId, partnerId), eq(partnerMembers.userId, memberUserId)))
    .returning();
  if (!updated) throw new PartnerServiceError("Failed to update role — not authorized");

  await recordAuditLog(tx, {
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: "PARTNER_MEMBER_ROLE_UPDATED",
    targetType: "partner_member",
    targetId: updated.id,
    metadata: { partnerId, memberUserId, role },
  });

  return updated;
}

export async function removePartnerMember(
  tx: Tx,
  actor: { actorType: "ADMIN" | "PARTNER"; actorId: string },
  partnerId: string,
  memberUserId: string,
) {
  const [current] = await tx
    .select()
    .from(partnerMembers)
    .where(and(eq(partnerMembers.partnerId, partnerId), eq(partnerMembers.userId, memberUserId)))
    .limit(1);
  if (!current) throw new PartnerServiceError("Membership not found");

  if (current.role === "OWNER" && actor.actorType !== "ADMIN") {
    await assertNotLastOwner(tx, partnerId, memberUserId);
  }

  const deleted = await tx
    .delete(partnerMembers)
    .where(and(eq(partnerMembers.partnerId, partnerId), eq(partnerMembers.userId, memberUserId)))
    .returning({ id: partnerMembers.id });
  if (deleted.length === 0) throw new PartnerServiceError("Failed to remove member — not authorized");

  await recordAuditLog(tx, {
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: "PARTNER_MEMBER_REMOVED",
    targetType: "partner_member",
    targetId: deleted[0]!.id,
    metadata: { partnerId, memberUserId },
  });
}

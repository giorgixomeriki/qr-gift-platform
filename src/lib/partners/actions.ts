"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { requirePartnerContext } from "@/lib/auth/partner-context";
import {
  createPartnerSchema,
  updatePartnerSchema,
  partnerStatusSchema,
  addPartnerMemberSchema,
  addPartnerMemberByEmailSchema,
  updatePartnerMemberRoleSchema,
} from "@/lib/validation/partners";
import * as partnerService from "./service";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type AddMemberByEmailResult = { ok: true; invited: boolean } | { ok: false; error: string };

function errorResult(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

const MANAGE_ROLES = ["OWNER", "ADMIN"] as const;

function requireManageRole(role: string) {
  if (!(MANAGE_ROLES as readonly string[]).includes(role)) {
    throw new Error("Only an OWNER or ADMIN of this partner may perform this action");
  }
}

// ---------------------------------------------------------------------------
// Admin-only: Partner CRUD + status
// ---------------------------------------------------------------------------

export async function adminCreatePartnerAction(input: unknown): Promise<ActionResult> {
  try {
    const parsed = createPartnerSchema.parse(input);
    await requireAdmin((tx, adminUserId) => partnerService.createPartner(tx, adminUserId, parsed));
    revalidatePath("/admin/partners");
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function adminUpdatePartnerAction(partnerId: string, input: unknown): Promise<ActionResult> {
  try {
    const parsed = updatePartnerSchema.parse(input);
    await requireAdmin((tx, adminUserId) =>
      partnerService.updatePartner(tx, { actorType: "ADMIN", actorId: adminUserId }, partnerId, parsed),
    );
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function adminSetPartnerStatusAction(partnerId: string, status: unknown): Promise<ActionResult> {
  try {
    const parsed = partnerStatusSchema.parse(status);
    await requireAdmin((tx, adminUserId) => partnerService.setPartnerStatus(tx, adminUserId, partnerId, parsed));
    revalidatePath(`/admin/partners/${partnerId}`);
    revalidatePath("/admin/partners");
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

// ---------------------------------------------------------------------------
// Membership management — usable from either the admin console (any partner)
// or a partner's own dashboard (OWNER/ADMIN of THAT partner only, enforced
// both here and independently by RLS's partner_members_insert/update/delete).
// ---------------------------------------------------------------------------

export async function adminAddPartnerMemberAction(partnerId: string, input: unknown): Promise<ActionResult> {
  try {
    const parsed = addPartnerMemberSchema.parse(input);
    await requireAdmin((tx, adminUserId) =>
      partnerService.addPartnerMember(tx, { actorType: "ADMIN", actorId: adminUserId }, partnerId, parsed),
    );
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function adminAddPartnerMemberByEmailAction(partnerId: string, input: unknown): Promise<AddMemberByEmailResult> {
  try {
    const parsed = addPartnerMemberByEmailSchema.parse(input);
    const result = await requireAdmin((tx, adminUserId) =>
      partnerService.addPartnerMemberByEmail(tx, { actorType: "ADMIN", actorId: adminUserId }, partnerId, parsed),
    );
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true, invited: result.invited };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function adminUpdatePartnerMemberRoleAction(
  partnerId: string,
  memberUserId: string,
  role: unknown,
): Promise<ActionResult> {
  try {
    const parsed = updatePartnerMemberRoleSchema.parse({ role });
    await requireAdmin((tx, adminUserId) =>
      partnerService.updatePartnerMemberRole(
        tx,
        { actorType: "ADMIN", actorId: adminUserId },
        partnerId,
        memberUserId,
        parsed.role,
      ),
    );
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function adminRemovePartnerMemberAction(partnerId: string, memberUserId: string): Promise<ActionResult> {
  try {
    await requireAdmin((tx, adminUserId) =>
      partnerService.removePartnerMember(tx, { actorType: "ADMIN", actorId: adminUserId }, partnerId, memberUserId),
    );
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function partnerAddMemberByEmailAction(input: unknown): Promise<AddMemberByEmailResult> {
  try {
    const parsed = addPartnerMemberByEmailSchema.parse(input);
    const result = await requirePartnerContext(async (tx, ctx) => {
      requireManageRole(ctx.role);
      return partnerService.addPartnerMemberByEmail(tx, { actorType: "PARTNER", actorId: ctx.userId }, ctx.partnerId, parsed);
    });
    revalidatePath("/partner/dashboard");
    return { ok: true, invited: result.invited };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function partnerAddMemberAction(input: unknown): Promise<ActionResult> {
  try {
    const parsed = addPartnerMemberSchema.parse(input);
    await requirePartnerContext(async (tx, ctx) => {
      requireManageRole(ctx.role);
      await partnerService.addPartnerMember(tx, { actorType: "PARTNER", actorId: ctx.userId }, ctx.partnerId, parsed);
    });
    revalidatePath("/partner/dashboard");
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function partnerUpdateMemberRoleAction(memberUserId: string, role: unknown): Promise<ActionResult> {
  try {
    const parsed = updatePartnerMemberRoleSchema.parse({ role });
    await requirePartnerContext(async (tx, ctx) => {
      requireManageRole(ctx.role);
      await partnerService.updatePartnerMemberRole(
        tx,
        { actorType: "PARTNER", actorId: ctx.userId },
        ctx.partnerId,
        memberUserId,
        parsed.role,
      );
    });
    revalidatePath("/partner/dashboard");
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function partnerRemoveMemberAction(memberUserId: string): Promise<ActionResult> {
  try {
    await requirePartnerContext(async (tx, ctx) => {
      requireManageRole(ctx.role);
      await partnerService.removePartnerMember(tx, { actorType: "PARTNER", actorId: ctx.userId }, ctx.partnerId, memberUserId);
    });
    revalidatePath("/partner/dashboard");
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

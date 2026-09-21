"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { requirePartnerContext } from "@/lib/auth/partner-context";
import { createBatchSchema, markDistributedSchema } from "@/lib/validation/qr";
import { createQrBatch, markQrCodesDistributed } from "./batches";
import { recordAnalyticsEvent } from "@/lib/analytics";

export type ActionResult = { ok: true } | { ok: false; error: string };

function errorResult(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

const BATCH_CREATE_ROLES = ["OWNER", "ADMIN"] as const;
const DISTRIBUTE_ROLES = ["OWNER", "ADMIN", "STAFF"] as const;

export async function adminCreateBatchAction(partnerId: string, input: unknown): Promise<ActionResult> {
  try {
    const parsed = createBatchSchema.parse(input);
    const { batch } = await requireAdmin((tx, adminUserId) =>
      createQrBatch(tx, { actorType: "ADMIN", actorId: adminUserId }, partnerId, parsed),
    );
    await recordAnalyticsEvent({ eventType: "QR_GENERATED", qrBatchId: batch.id, quantity: parsed.quantity }, { partnerId });
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function partnerCreateBatchAction(input: unknown): Promise<ActionResult> {
  try {
    const parsed = createBatchSchema.parse(input);
    const { batch, partnerId } = await requirePartnerContext(async (tx, ctx) => {
      if (!(BATCH_CREATE_ROLES as readonly string[]).includes(ctx.role)) {
        throw new Error("Only an OWNER or ADMIN of this partner may create QR batches");
      }
      const result = await createQrBatch(tx, { actorType: "PARTNER", actorId: ctx.userId }, ctx.partnerId, parsed);
      return { ...result, partnerId: ctx.partnerId };
    });
    await recordAnalyticsEvent({ eventType: "QR_GENERATED", qrBatchId: batch.id, quantity: parsed.quantity }, { partnerId });
    revalidatePath("/partner/dashboard");
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function partnerMarkDistributedAction(input: unknown): Promise<ActionResult> {
  try {
    const parsed = markDistributedSchema.parse(input);
    const { distributedIds, partnerId } = await requirePartnerContext(async (tx, ctx) => {
      if (!(DISTRIBUTE_ROLES as readonly string[]).includes(ctx.role)) {
        throw new Error("VIEWER role cannot mark QR codes as distributed");
      }
      const ids = await markQrCodesDistributed(tx, { actorType: "PARTNER", actorId: ctx.userId }, ctx.partnerId, parsed.qrCodeIds);
      return { distributedIds: ids, partnerId: ctx.partnerId };
    });
    for (const qrCodeId of distributedIds) {
      await recordAnalyticsEvent({ eventType: "QR_DISTRIBUTED", qrCodeId }, { partnerId });
    }
    revalidatePath("/partner/dashboard");
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

export async function adminMarkDistributedAction(partnerId: string, input: unknown): Promise<ActionResult> {
  try {
    const parsed = markDistributedSchema.parse(input);
    const distributedIds = await requireAdmin((tx, adminUserId) =>
      markQrCodesDistributed(tx, { actorType: "ADMIN", actorId: adminUserId }, partnerId, parsed.qrCodeIds),
    );
    for (const qrCodeId of distributedIds) {
      await recordAnalyticsEvent({ eventType: "QR_DISTRIBUTED", qrCodeId }, { partnerId });
    }
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true };
  } catch (err) {
    return errorResult(err);
  }
}

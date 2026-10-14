"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { logServerError } from "@/lib/log";
import { setDefaultPriceSchema, setPartnerCommissionSchema, setPartnerPriceSchema } from "@/lib/validation/pricing";
import { setDefaultPrice, setPartnerCommission, setPartnerPrice } from "./pricing-admin";

/**
 * Super Admin pricing endpoints. requireAdmin authorizes the session;
 * pricing-admin.ts re-checks app_is_admin() inside the transaction, and the
 * prices RLS policies / partners commission trigger (migrations/0001, 0018)
 * refuse the write at the database layer for anyone else.
 */

export type PricingActionResult = { ok: true; changed: boolean } | { ok: false; error: string };

const partnerIdSchema = z.uuid();

function errorResult(scope: string, err: unknown, context: Record<string, string | undefined> = {}): PricingActionResult {
  logServerError(scope, err, context);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

export async function adminSetDefaultPriceAction(input: unknown): Promise<PricingActionResult> {
  try {
    const parsed = setDefaultPriceSchema.parse(input);
    const { changed } = await requireAdmin((tx, adminUserId) => setDefaultPrice(tx, adminUserId, parsed));
    revalidatePath("/admin/partners", "layout");
    return { ok: true, changed };
  } catch (err) {
    return errorResult("adminSetDefaultPriceAction", err);
  }
}

export async function adminSetPartnerPriceAction(partnerId: string, input: unknown): Promise<PricingActionResult> {
  try {
    const id = partnerIdSchema.parse(partnerId);
    const parsed = setPartnerPriceSchema.parse(input);
    const { changed } = await requireAdmin((tx, adminUserId) => setPartnerPrice(tx, adminUserId, id, parsed));
    revalidatePath(`/admin/partners/${id}`);
    revalidatePath("/admin/partners");
    return { ok: true, changed };
  } catch (err) {
    return errorResult("adminSetPartnerPriceAction", err, { partnerId });
  }
}

export async function adminSetPartnerCommissionAction(partnerId: string, input: unknown): Promise<PricingActionResult> {
  try {
    const id = partnerIdSchema.parse(partnerId);
    const parsed = setPartnerCommissionSchema.parse(input);
    const { changed } = await requireAdmin((tx, adminUserId) => setPartnerCommission(tx, adminUserId, id, parsed));
    revalidatePath(`/admin/partners/${id}`);
    revalidatePath("/admin/partners");
    return { ok: true, changed };
  } catch (err) {
    return errorResult("adminSetPartnerCommissionAction", err, { partnerId });
  }
}

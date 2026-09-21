"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { recordPayoutSchema } from "@/lib/validation/payouts";
import { recordManualPayout, listPartnerPayouts, getPartnerUnpaidBalance } from "./payouts";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorResult(err: unknown): ActionResult<never> {
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

/**
 * Admin-only (Phase 5 §16/§17) — requireAdmin is the sole authorization
 * boundary; RLS independently re-enforces app_is_admin() on both
 * partner_payouts and the PAYOUT ledger insert (migrations/0003), so a
 * non-admin caller is rejected even if this check were ever bypassed.
 */
export async function adminRecordPayoutAction(partnerId: string, input: unknown): Promise<ActionResult<{ payoutId: string }>> {
  try {
    const parsed = recordPayoutSchema.parse(input);
    const payout = await requireAdmin((tx, adminUserId) => recordManualPayout(tx, adminUserId, { partnerId, ...parsed }));
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true, data: { payoutId: payout.id } };
  } catch (err) {
    return errorResult(err);
  }
}

export async function adminListPartnerPayoutsAction(partnerId: string) {
  return requireAdmin((tx) => listPartnerPayouts(tx, partnerId));
}

export async function adminGetPartnerUnpaidBalanceAction(partnerId: string, currency: string): Promise<number> {
  return requireAdmin((tx) => getPartnerUnpaidBalance(tx, partnerId, currency));
}

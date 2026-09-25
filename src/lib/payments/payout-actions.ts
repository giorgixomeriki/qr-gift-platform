"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { recordPayoutSchema } from "@/lib/validation/payouts";
import { recordManualPayout, listPartnerPayouts, getPartnerUnpaidBalance } from "./payouts";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/log";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorResult(scope: string, err: unknown, context: Record<string, string | number | undefined> = {}): ActionResult<never> {
  logServerError(scope, err, context);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

/**
 * Admin-only (Phase 5 §16/§17) — requireAdmin is the sole authorization
 * boundary; RLS independently re-enforces app_is_admin() on both
 * partner_payouts and the PAYOUT ledger insert (migrations/0003), so a
 * non-admin caller is rejected even if this check were ever bypassed.
 * PRIVILEGED, generous rate limit — a real financial action, still guarded
 * mainly to catch a misbehaving script rather than a realistic abuse case.
 */
export async function adminRecordPayoutAction(partnerId: string, input: unknown): Promise<ActionResult<{ payoutId: string }>> {
  try {
    const parsed = recordPayoutSchema.parse(input);
    const payout = await requireAdmin(async (tx, adminUserId) => {
      await enforceRateLimit({ key: `payout-record:${adminUserId}`, limit: 20, windowSeconds: 60 });
      return recordManualPayout(tx, adminUserId, { partnerId, ...parsed });
    });
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true, data: { payoutId: payout.id } };
  } catch (err) {
    return errorResult("adminRecordPayoutAction", err, { partnerId });
  }
}

export async function adminListPartnerPayoutsAction(partnerId: string) {
  return requireAdmin((tx) => listPartnerPayouts(tx, partnerId));
}

export async function adminGetPartnerUnpaidBalanceAction(partnerId: string, currency: string): Promise<number> {
  return requireAdmin((tx) => getPartnerUnpaidBalance(tx, partnerId, currency));
}

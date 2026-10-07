"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { recordPayoutSchema, payoutStatementSchema } from "@/lib/validation/payouts";
import { businessDayRange } from "@/lib/business-calendar";
import { recordManualPayout, listPartnerPayouts, getPartnerUnpaidBalance, getPartnerPayoutStatement, type PayoutStatement } from "./payouts";
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
      return recordManualPayout(tx, adminUserId, { partnerId, ...parsed, ...businessDayRange(parsed.periodFrom, parsed.periodTo) });
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

/**
 * Period statement shown while recording a payout — what was sold and earned
 * on business days periodFrom..periodTo (inclusive, business timezone) and how much of it is still
 * payable, with the exact candidate ledger rows. Read-only; the payout itself
 * is adminRecordPayoutAction, which must be sent this statement's
 * payableMinor + eligibleLedgerEntryIds back as its expectation.
 */
export async function adminGetPayoutStatementAction(partnerId: string, input: unknown): Promise<ActionResult<PayoutStatement>> {
  try {
    const parsed = payoutStatementSchema.parse(input);
    const statement = await requireAdmin((tx) =>
      getPartnerPayoutStatement(tx, { partnerId, currency: parsed.currency, ...businessDayRange(parsed.periodFrom, parsed.periodTo) }),
    );
    return { ok: true, data: statement };
  } catch (err) {
    return errorResult("adminGetPayoutStatementAction", err, { partnerId });
  }
}

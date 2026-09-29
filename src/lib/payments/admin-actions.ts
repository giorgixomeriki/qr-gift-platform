"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { findOrdersNeedingActivation, activatePaidOrder, verifyAndReconcileOrder } from "./service";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { withPublicContext } from "@/db/client";
import { orders, qrCodes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logServerError } from "@/lib/log";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorResult(scope: string, err: unknown, context: Record<string, string | number | undefined> = {}): ActionResult<never> {
  logServerError(scope, err, context);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

/**
 * Operational reconciliation (Phase 3 §7): finds every PAID order whose
 * Greeting never made it to ACTIVE (activatePaidOrder was interrupted after
 * payment genuinely succeeded) and retries activation for each. Safe to run
 * repeatedly — activatePaidOrder is idempotent (matches 0 rows if already
 * ACTIVE). This never re-runs payment confirmation and never touches an
 * order that isn't already authoritatively PAID.
 */
export async function reconcileActivationsAction(): Promise<ActionResult<{ checked: number; activated: number }>> {
  try {
    const stuck = await requireAdmin((tx, adminUserId) => findOrdersNeedingActivation(adminUserId));

    let activated = 0;
    for (const row of stuck) {
      const result = await activatePaidOrder(row.orderId);
      if (result.activated) {
        activated++;
        const [qr] = await withPublicContext((tx) => tx.select({ partnerId: qrCodes.partnerId }).from(qrCodes).where(eq(qrCodes.id, row.qrCodeId)).limit(1));
        await recordAnalyticsEvent({ eventType: "QR_ACTIVATED", qrCodeId: row.qrCodeId, greetingId: row.greetingId }, { partnerId: qr?.partnerId });
      }
    }

    revalidatePath("/admin/dashboard");
    return { ok: true, data: { checked: stuck.length, activated } };
  } catch (err) {
    return errorResult("reconcileActivationsAction", err);
  }
}

/**
 * Admin-triggered payment-state reconciliation (Phase 5 §8) — for the
 * "customer paid, redirect got lost, webhook is delayed" case. This asks the
 * PROVIDER what actually happened (verifyAndReconcileOrder → provider's own
 * verifyPayment) and only ever activates through the normal
 * confirmPaymentSuccess/activatePaidOrder path if the provider itself says
 * SUCCEEDED. There is deliberately no action anywhere that lets an admin
 * mark an arbitrary order PAID directly — this is the only reconciliation
 * entry point, and it is provider-authoritative, not admin-authoritative.
 */
export async function adminReconcilePaymentAction(orderId: string): Promise<ActionResult<{ status: string; activated: boolean }>> {
  try {
    // requireAdmin's own tx is admin-scoped (orders_select's app_is_admin()
    // branch), unlike a bare withPublicContext call — orders has no
    // public-read policy at all.
    await requireAdmin(async (tx) => {
      const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) throw new Error(`Order ${orderId} not found`);
    });
    const result = await verifyAndReconcileOrder(orderId);
    revalidatePath("/admin/dashboard");
    return { ok: true, data: result };
  } catch (err) {
    return errorResult("adminReconcilePaymentAction", err, { orderId });
  }
}

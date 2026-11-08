import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { runPaymentReconciliation } from "@/lib/payments/reconcile";
import { buildReconcileAlert, dispatchReconcileAlert } from "@/lib/payments/reconcile-alerts";

/**
 * Scheduled payment reconciliation (BOG plan §3.8): repairs only what the
 * provider confirms or what is internal-only (lib/payments/reconcile.ts),
 * and reports everything else. Called by a scheduler with
 * `Authorization: Bearer $CRON_SECRET` (Vercel Cron's convention).
 *
 * The endpoint does not exist (404) unless CRON_SECRET and
 * RECONCILE_ADMIN_USER_ID are both configured. The response carries counts
 * only. The log and the optional alert carry the sanitized summary from
 * reconcile-alerts.ts; `npm run payments:reconcile` shows full detail. A run
 * that cannot work (e.g. the identity is no longer an admin) answers 500, so
 * the scheduler reports it rather than recording a clean run.
 */
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!env.CRON_SECRET || !env.RECONCILE_ADMIN_USER_ID) return new Response("Not found", { status: 404, headers });
  if (!authorized(request.headers.get("authorization"), env.CRON_SECRET)) return new Response("Unauthorized", { status: 401, headers });

  try {
    const report = await runPaymentReconciliation(env.RECONCILE_ADMIN_USER_ID, { apply: true });
    const alert = buildReconcileAlert(report);
    if (alert.total > 0 || alert.repairs.attempted > 0) {
      console.warn(JSON.stringify({ level: "warn", scope: "paymentReconcile", alert, timestamp: new Date().toISOString() }));
    }
    const alerted = await dispatchReconcileAlert(env.RECONCILE_ADMIN_USER_ID, alert);
    return Response.json(
      { anomalies: report.anomalies.length, repaired: alert.repairs.succeeded, repairFailures: alert.repairs.failed, remaining: alert.total, alerted },
      { headers },
    );
  } catch (err) {
    logServerError("paymentReconcile", err);
    return Response.json({ error: "reconciliation failed" }, { status: 500, headers });
  }
}

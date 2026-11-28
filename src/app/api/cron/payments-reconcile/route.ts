import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { runPaymentReconciliation } from "@/lib/payments/reconcile";
import { buildReconcileAlert, dispatchReconcileAlert } from "@/lib/payments/reconcile-alerts";
import { recordReconcileRun } from "@/lib/payments/reconcile-heartbeat";

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
 *
 * FA-03: one run at a time per instance. A second call while a run is in
 * progress (a scheduler retry after a client-side timeout) answers 409 and
 * changes nothing, so retries can never overlap. Every run, clean or failed,
 * leaves a heartbeat (lib/payments/reconcile-heartbeat.ts) that the admin
 * dashboard shows, so a schedule that stops is visible.
 */
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

/** Single-flight guard for this server instance (Render runs one). */
let inFlight = false;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!env.CRON_SECRET || !env.RECONCILE_ADMIN_USER_ID) return new Response("Not found", { status: 404, headers });
  if (!authorized(request.headers.get("authorization"), env.CRON_SECRET)) return new Response("Unauthorized", { status: 401, headers });

  if (inFlight) return Response.json({ error: "reconciliation already running" }, { status: 409, headers });
  const adminUserId = env.RECONCILE_ADMIN_USER_ID;
  const started = Date.now();
  inFlight = true;
  try {
    const report = await runPaymentReconciliation(adminUserId, { apply: true });
    const alert = buildReconcileAlert(report);
    if (alert.total > 0 || alert.repairs.attempted > 0) {
      console.warn(JSON.stringify({ level: "warn", scope: "paymentReconcile", alert, timestamp: new Date().toISOString() }));
    }
    const alerted = await dispatchReconcileAlert(adminUserId, alert);
    await recordReconcileRun(adminUserId, {
      ok: true,
      anomalies: report.anomalies.length,
      remaining: alert.total,
      repaired: alert.repairs.succeeded,
      repairFailures: alert.repairs.failed,
      durationMs: Date.now() - started,
    });
    return Response.json(
      { anomalies: report.anomalies.length, repaired: alert.repairs.succeeded, repairFailures: alert.repairs.failed, remaining: alert.total, alerted },
      { headers },
    );
  } catch (err) {
    logServerError("paymentReconcile", err);
    await recordReconcileRun(adminUserId, { ok: false, anomalies: 0, remaining: 0, repaired: 0, repairFailures: 0, durationMs: Date.now() - started });
    return Response.json({ error: "reconciliation failed" }, { status: 500, headers });
  } finally {
    inFlight = false;
  }
}

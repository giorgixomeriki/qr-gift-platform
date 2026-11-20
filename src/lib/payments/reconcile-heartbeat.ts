import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { withAdminContext, type Tx } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";

/**
 * FA-03 monitoring: every scheduled reconciliation run leaves one audit row
 * (counts only), so "is reconciliation actually running?" has an answer in
 * the admin dashboard. A scheduler that silently stops shows up as STALE
 * instead of looking like a quiet, clean system.
 */
const ACTION = "PAYMENT_RECONCILE_RUN";
const TARGET_TYPE = "payment_reconciliation";
/** Hourly schedule + GitHub's scheduling delay + one missed run. */
export const RECONCILE_STALE_AFTER_MS = 150 * 60 * 1000;

export type ReconcileRunSummary = {
  ok: boolean;
  anomalies: number;
  remaining: number;
  repaired: number;
  repairFailures: number;
  durationMs: number;
};

/** Never throws: a failed heartbeat must not turn a successful run into a failed one. */
export async function recordReconcileRun(adminUserId: string, summary: ReconcileRunSummary): Promise<void> {
  try {
    await withAdminContext(adminUserId, (tx) =>
      recordAuditLog(tx, { actorType: "SYSTEM", action: ACTION, targetType: TARGET_TYPE, targetId: "scheduled", metadata: summary }),
    );
  } catch (err) {
    logServerError("paymentReconcileHeartbeat", err);
  }
}

export type ReconcileHealth = {
  /** OK: a clean run recently. ATTENTION: recent runs work but anomalies remain. FAILING: the last run failed. STALE: no successful run recently. NEVER: no run recorded. */
  status: "OK" | "ATTENTION" | "FAILING" | "STALE" | "NEVER";
  /** Whether payments are live (BOG configured and checkout open), i.e. whether a missing schedule matters. */
  required: boolean;
  scheduleConfigured: boolean;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastRemaining: number | null;
};

export function classifyReconcileHealth(
  runs: { createdAt: Date; ok: boolean; remaining: number }[],
  now: Date = new Date(),
): Pick<ReconcileHealth, "status" | "lastRunAt" | "lastSuccessAt" | "lastRemaining"> {
  const [last] = runs;
  if (!last) return { status: "NEVER", lastRunAt: null, lastSuccessAt: null, lastRemaining: null };
  const lastSuccess = runs.find((r) => r.ok) ?? null;
  const base = { lastRunAt: last.createdAt, lastSuccessAt: lastSuccess?.createdAt ?? null, lastRemaining: lastSuccess ? lastSuccess.remaining : null };
  if (!lastSuccess || now.getTime() - lastSuccess.createdAt.getTime() > RECONCILE_STALE_AFTER_MS) return { ...base, status: "STALE" };
  if (!last.ok) return { ...base, status: "FAILING" };
  return { ...base, status: lastSuccess.remaining > 0 ? "ATTENTION" : "OK" };
}

/** Inside an admin transaction (the dashboard's requireAdmin). */
export async function getReconcileHealth(tx: Tx, now: Date = new Date()): Promise<ReconcileHealth> {
  const rows = await tx
    .select({ createdAt: auditLogs.createdAt, metadata: auditLogs.metadata })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, ACTION), eq(auditLogs.targetType, TARGET_TYPE)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(24);
  const runs = rows.map((r) => {
    const m = (r.metadata ?? {}) as Partial<ReconcileRunSummary>;
    return { createdAt: r.createdAt, ok: m.ok === true, remaining: Number(m.remaining ?? 0) };
  });
  return {
    ...classifyReconcileHealth(runs, now),
    required: env.PAYMENTS_PROVIDER === "BOG" && env.CHECKOUT_ENABLED,
    scheduleConfigured: !!env.CRON_SECRET && !!env.RECONCILE_ADMIN_USER_ID,
  };
}

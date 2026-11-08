import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { withAdminContext } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import type { PaymentAnomalyKind } from "./service";
import type { ReconcileReport } from "./reconcile";

/**
 * Operational alert for a reconciliation run. Built only from anomaly KINDS,
 * counts and shortened internal ids; `detail` and repair outcome strings are
 * never copied in, so no greeting content, QR or edit token, payer data,
 * provider reference or secret can reach a log drain or a chat channel. The
 * full picture stays with `npm run payments:reconcile`.
 */
export type AlertSeverity = "critical" | "warning" | "info";

const SEVERITY: Record<PaymentAnomalyKind, AlertSeverity> = {
  CAPTURED_NOT_APPLIED: "critical",
  DUPLICATE_CAPTURE: "critical",
  PAID_WITHOUT_CHARGE: "critical",
  PAID_NOT_ACTIVATED: "critical",
  PAID_QR_NOT_ACTIVATED: "critical",
  COMMISSION_MISSING: "critical",
  COMMISSION_NOT_REVERSED: "critical",
  AMOUNT_MISMATCH: "critical",
  REFUND_REJECTED: "critical",
  STATUS_MISMATCH: "critical",
  ACTIVE_WITHOUT_PAYMENT: "critical",
  MISSING_PROVIDER_REFERENCE: "warning",
  REFUND_PENDING: "warning",
  REFUND_AWAITING_PROVIDER: "warning",
  EXTERNAL_REFUND: "warning",
  // A customer who left the bank's page looks like this until the bank expires it.
  STALE_PENDING: "info",
};

const MAX_REFS = 20;
const RESEND_AFTER_MS = 24 * 60 * 60 * 1000;
const DELIVERY_TIMEOUT_MS = 5_000;
const AUDIT_ACTION = "PAYMENT_RECONCILE_ALERT";

export type ReconcileAlert = {
  severity: AlertSeverity;
  total: number;
  byKind: { kind: PaymentAnomalyKind; count: number; severity: AlertSeverity }[];
  repairs: { attempted: number; succeeded: number; failed: number };
  /** First 8 characters of internal ids, enough to find them in the admin report. */
  refs: string[];
  /** Changes when the set of open problems changes; repeats of the same set are not re-sent. */
  fingerprint: string;
  actionable: boolean;
};

export function buildReconcileAlert(report: ReconcileReport): ReconcileAlert {
  const counts = new Map<PaymentAnomalyKind, number>();
  for (const a of report.remaining) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const byKind = [...counts].map(([kind, count]) => ({ kind, count, severity: SEVERITY[kind] })).sort((a, b) => a.kind.localeCompare(b.kind));

  const failed = report.actions.filter((a) => !a.ok).length;
  const actionableKinds = report.remaining.filter((a) => SEVERITY[a.kind] !== "info");
  const severity: AlertSeverity = byKind.some((k) => k.severity === "critical") ? "critical" : actionableKinds.length > 0 || failed > 0 ? "warning" : "info";
  const keys = report.remaining.map((a) => `${a.kind}:${a.orderId}`).sort();

  return {
    severity,
    total: report.remaining.length,
    byKind,
    repairs: { attempted: report.actions.length, succeeded: report.actions.length - failed, failed },
    refs: [...new Set(actionableKinds.map((a) => a.orderId.slice(0, 8)))].slice(0, MAX_REFS),
    fingerprint: createHash("sha256").update(keys.join("|")).update(`failed=${failed > 0}`).digest("hex").slice(0, 16),
    actionable: actionableKinds.length > 0 || failed > 0,
  };
}

export function formatAlertText(alert: ReconcileAlert): string {
  const kinds = alert.byKind.map((k) => `${k.kind} ×${k.count}`).join(", ") || "none";
  return `[QR Starr payments ${alert.severity.toUpperCase()}] ${alert.total} open: ${kinds}. Repairs: ${alert.repairs.succeeded} ok, ${alert.repairs.failed} failed. Details: npm run payments:reconcile.`;
}

/**
 * Sends the alert if it is actionable and new (not the same set as an alert in
 * the last 24 hours), and records that it went. Never throws: a broken alert
 * channel must not fail the reconciliation that has already happened.
 */
export async function dispatchReconcileAlert(adminUserId: string, alert: ReconcileAlert): Promise<boolean> {
  const url = env.PAYMENT_ALERT_WEBHOOK_URL;
  if (!url || !alert.actionable) return false;
  try {
    const repeated = await withAdminContext(adminUserId, async (tx) => {
      const [latest] = await tx
        .select({ metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, AUDIT_ACTION), gt(auditLogs.createdAt, new Date(Date.now() - RESEND_AFTER_MS))))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      return (latest?.metadata as { fingerprint?: string } | undefined)?.fingerprint === alert.fingerprint;
    });
    if (repeated) return false;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: formatAlertText(alert), alert }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`alert webhook answered ${response.status}`);

    await withAdminContext(adminUserId, (tx) =>
      recordAuditLog(tx, {
        actorType: "SYSTEM",
        action: AUDIT_ACTION,
        targetType: "payment_reconciliation",
        targetId: alert.fingerprint,
        metadata: { fingerprint: alert.fingerprint, severity: alert.severity, total: alert.total },
      }),
    );
    return true;
  } catch (err) {
    // Only the error message: the URL itself is a credential.
    logServerError("paymentReconcileAlert", err instanceof Error ? new Error(err.name === "TimeoutError" ? "alert webhook timed out" : "alert delivery failed") : err);
    return false;
  }
}

import "server-only";
import type { Tx } from "@/db/client";
import { auditLogs } from "@/db/schema";

/**
 * The only entry point for writing audit_logs (see migrations/0001_rls_and_functions.sql,
 * "written only via lib/audit.ts, never with raw/free-text user input"). Every
 * sensitive admin/partner mutation (Partner CRUD, membership changes, QR batch
 * creation, distribution marking, status changes) should call this inside the
 * same transaction as the mutation it's recording, so the audit row can never
 * exist without the mutation actually having committed (or vice versa).
 */
export async function recordAuditLog(
  tx: Tx,
  entry: {
    actorType: "ADMIN" | "PARTNER" | "SYSTEM";
    actorId?: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
  });
}

import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { qrBatches, qrCodes } from "@/db/schema";
import { generatePublicToken } from "@/lib/security/public-token";
import { recordAuditLog } from "@/lib/audit";
import type { CreateBatchInput } from "@/lib/validation/qr";

export class QrBatchError extends Error {}

/**
 * Generates `quantity` distinct public tokens. generatePublicToken has ~120
 * bits of entropy (see lib/security/public-token.ts), so an in-process
 * collision within one batch is not realistically possible — the Set is a
 * correctness guarantee, not a defense against an expected collision.
 */
function generateUniqueTokens(quantity: number): string[] {
  const tokens = new Set<string>();
  while (tokens.size < quantity) {
    tokens.add(generatePublicToken());
  }
  return [...tokens];
}

/**
 * Creates a QR batch and mints `quantity` qr_codes rows for it in one
 * transaction (Phase 1). Token uniqueness is guaranteed twice over: in-process
 * (generateUniqueTokens) and at the DB level (qr_codes.public_token UNIQUE) —
 * a genuine cross-batch collision (astronomically unlikely) is handled by
 * retrying just the missing rows via ON CONFLICT DO NOTHING, so bulk
 * generation can never silently under-produce or duplicate a token.
 */
export async function createQrBatch(
  tx: Tx,
  actor: { actorType: "ADMIN" | "PARTNER"; actorId: string },
  partnerId: string,
  input: CreateBatchInput,
) {
  const [batch] = await tx
    .insert(qrBatches)
    .values({ partnerId, label: input.label, quantity: input.quantity })
    .returning();
  if (!batch) throw new QrBatchError("Failed to create batch — not authorized");

  let remaining = input.quantity;
  let attempts = 0;
  const insertedIds: string[] = [];

  while (remaining > 0) {
    attempts++;
    if (attempts > 10) {
      throw new QrBatchError("Failed to generate unique QR tokens after repeated attempts");
    }
    const tokens = generateUniqueTokens(remaining);
    const inserted = await tx
      .insert(qrCodes)
      .values(tokens.map((publicToken) => ({ publicToken, batchId: batch.id, partnerId })))
      .onConflictDoNothing({ target: qrCodes.publicToken })
      .returning({ id: qrCodes.id });
    insertedIds.push(...inserted.map((r) => r.id));
    remaining = input.quantity - insertedIds.length;
  }

  await recordAuditLog(tx, {
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: "QR_BATCH_CREATED",
    targetType: "qr_batch",
    targetId: batch.id,
    metadata: { partnerId, label: input.label, quantity: input.quantity },
  });

  return { batch, qrCodeIds: insertedIds };
}

export async function listQrBatches(tx: Tx, partnerId: string) {
  return tx.select().from(qrBatches).where(eq(qrBatches.partnerId, partnerId)).orderBy(qrBatches.createdAt);
}

export async function getQrBatch(tx: Tx, batchId: string) {
  const [row] = await tx.select().from(qrBatches).where(eq(qrBatches.id, batchId)).limit(1);
  return row ?? null;
}

export async function listQrCodesForBatch(tx: Tx, batchId: string) {
  return tx.select().from(qrCodes).where(eq(qrCodes.batchId, batchId)).orderBy(qrCodes.createdAt);
}

export async function listQrCodesForPartner(tx: Tx, partnerId: string) {
  return tx.select().from(qrCodes).where(eq(qrCodes.partnerId, partnerId)).orderBy(qrCodes.createdAt);
}

export async function getQrCodeById(tx: Tx, qrCodeId: string) {
  const [row] = await tx.select().from(qrCodes).where(eq(qrCodes.id, qrCodeId)).limit(1);
  return row ?? null;
}

export async function markExported(tx: Tx, batchId: string) {
  await tx.update(qrBatches).set({ exportedAt: sql`now()` }).where(eq(qrBatches.id, batchId));
}

/**
 * Marks specific QR codes as physically DISTRIBUTED. Deliberately separate
 * from batch/CSV export (markExported above) and from QR lifecycle status —
 * a batch being printed/exported is not the same fact as the cards having
 * actually left the building, and generation never implies distribution.
 * Scoped to `partnerId` and NOT_DISTRIBUTED-only so this can never touch
 * another partner's QR codes or double-count an already-distributed one.
 */
export async function markQrCodesDistributed(
  tx: Tx,
  actor: { actorType: "ADMIN" | "PARTNER"; actorId: string },
  partnerId: string,
  qrCodeIds: string[],
) {
  if (qrCodeIds.length === 0) return [];

  const updated = await tx
    .update(qrCodes)
    .set({ distributionStatus: "DISTRIBUTED", distributedAt: sql`now()` })
    .where(
      and(
        eq(qrCodes.partnerId, partnerId),
        inArray(qrCodes.id, qrCodeIds),
        eq(qrCodes.distributionStatus, "NOT_DISTRIBUTED"),
      ),
    )
    .returning({ id: qrCodes.id });

  if (updated.length > 0) {
    await recordAuditLog(tx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "QR_CODES_DISTRIBUTED",
      targetType: "qr_batch_distribution",
      targetId: partnerId,
      metadata: { qrCodeIds: updated.map((r) => r.id), count: updated.length },
    });
  }

  return updated.map((r) => r.id);
}

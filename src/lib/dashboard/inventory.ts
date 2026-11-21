import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { analyticsEvents, qrBatches, qrCodes } from "@/db/schema";

/**
 * One partner's QR card inventory, counted ONE way for every screen that shows
 * it (the partner dashboard and the admin's page for that partner), straight
 * from qr_codes — the source of truth.
 *
 * Definitions (business rules, not display choices):
 *   issued       every card assigned to the partner (assignment is not a sale)
 *   available    AVAILABLE: unclaimed, nobody has started a greeting
 *   draft        DRAFT: a sender started a greeting; NOT paid, NOT active
 *   active       ACTIVE: paid activation (only a verified payment sets this)
 *   blocked      BLOCKED: moderated
 *   distributed  physically handed over (independent of status; not a sale)
 *   scannedCards distinct cards with at least one QR_SCANNED event — a card
 *                scanned 10 times is one scanned card (same rule as the
 *                per-batch line and the admin funnel)
 *   batchCount   batches created for the partner
 *
 * available + draft + active + blocked === issued always holds (the status
 * column is NOT NULL and these are all of qr_status's values); callers may
 * rely on it.
 *
 * Runs inside the caller's partner or admin transaction.
 */
export type PartnerInventorySummary = {
  issued: number;
  available: number;
  draft: number;
  active: number;
  blocked: number;
  distributed: number;
  scannedCards: number;
  batchCount: number;
};

export async function getPartnerInventorySummary(tx: Tx, partnerId: string): Promise<PartnerInventorySummary> {
  const [status] = await tx
    .select({
      issued: sql<number>`count(*)::int`,
      available: sql<number>`count(*) filter (where ${qrCodes.status} = 'AVAILABLE')::int`,
      draft: sql<number>`count(*) filter (where ${qrCodes.status} = 'DRAFT')::int`,
      active: sql<number>`count(*) filter (where ${qrCodes.status} = 'ACTIVE')::int`,
      blocked: sql<number>`count(*) filter (where ${qrCodes.status} = 'BLOCKED')::int`,
      distributed: sql<number>`count(*) filter (where ${qrCodes.distributionStatus} = 'DISTRIBUTED')::int`,
    })
    .from(qrCodes)
    .where(eq(qrCodes.partnerId, partnerId));

  // Attributed through the card's owner (qr_codes.partner_id), like the
  // per-batch performance query, so a scan always counts for the partner
  // that holds the card.
  const [scanned] = await tx
    .select({ count: sql<number>`count(distinct ${analyticsEvents.qrCodeId})::int` })
    .from(analyticsEvents)
    .innerJoin(qrCodes, eq(qrCodes.id, analyticsEvents.qrCodeId))
    .where(and(eq(qrCodes.partnerId, partnerId), eq(analyticsEvents.eventType, "QR_SCANNED")));

  const [batches] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(qrBatches)
    .where(eq(qrBatches.partnerId, partnerId));

  return {
    issued: status?.issued ?? 0,
    available: status?.available ?? 0,
    draft: status?.draft ?? 0,
    active: status?.active ?? 0,
    blocked: status?.blocked ?? 0,
    distributed: status?.distributed ?? 0,
    scannedCards: scanned?.count ?? 0,
    batchCount: batches?.count ?? 0,
  };
}

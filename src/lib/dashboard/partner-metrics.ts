import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { qrCodes, qrBatches, orders, partnerLedgerEntries, analyticsEvents } from "@/db/schema";

export type PartnerMetrics = {
  qrIssued: number;
  qrAvailable: number;
  qrDraft: number;
  qrActive: number;
  qrBlocked: number;
  qrDistributed: number;
  qrScanned: number;
  batchCount: number;
  successfulSales: number;
  commissionEarnedMinor: number;
  commissionPaidMinor: number;
  commissionUnpaidMinor: number;
  currency: string;
};

/**
 * Every figure here is a live aggregate over rows RLS already scopes to this
 * partner (the caller runs this inside withPartnerContext) — never a
 * client-supplied filter, never fabricated/placeholder data (Phase 1 §"no
 * fake data").
 */
export async function getPartnerMetrics(tx: Tx, partnerId: string): Promise<PartnerMetrics> {
  const [statusCounts] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      available: sql<number>`count(*) filter (where ${qrCodes.status} = 'AVAILABLE')::int`,
      draft: sql<number>`count(*) filter (where ${qrCodes.status} = 'DRAFT')::int`,
      active: sql<number>`count(*) filter (where ${qrCodes.status} = 'ACTIVE')::int`,
      blocked: sql<number>`count(*) filter (where ${qrCodes.status} = 'BLOCKED')::int`,
      distributed: sql<number>`count(*) filter (where ${qrCodes.distributionStatus} = 'DISTRIBUTED')::int`,
    })
    .from(qrCodes)
    .where(eq(qrCodes.partnerId, partnerId));

  const [batchRow] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(qrBatches)
    .where(eq(qrBatches.partnerId, partnerId));

  const [scannedRow] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.partnerId, partnerId), eq(analyticsEvents.eventType, "QR_SCANNED")));

  const [salesRow] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.partnerId, partnerId), eq(orders.status, "PAID")));

  // Sign convention (see schema/partner-ledger.ts): COMMISSION_EARNED positive,
  // PAYOUT negative. Unpaid balance is a plain SUM(amount_minor) — NOT
  // filtered by payout_id IS NULL, since partner_ledger_entries has no
  // UPDATE RLS policy at all (append-only, by design), so nothing can ever
  // retroactively mark an earning row's payout_id — see
  // lib/payments/payouts.ts's getPartnerUnpaidBalance doc comment for the
  // full explanation (this is the same figure, computed inline here since
  // this function is scoped to a caller-provided partner tx already).
  const [ledgerRow] = await tx
    .select({
      earned: sql<number>`coalesce(sum(${partnerLedgerEntries.amountMinor}) filter (where ${partnerLedgerEntries.type} = 'COMMISSION_EARNED'), 0)::int`,
      paidOut: sql<number>`coalesce(-sum(${partnerLedgerEntries.amountMinor}) filter (where ${partnerLedgerEntries.type} = 'PAYOUT'), 0)::int`,
      unpaid: sql<number>`coalesce(sum(${partnerLedgerEntries.amountMinor}), 0)::int`,
      currency: sql<string | null>`min(${partnerLedgerEntries.currency})`,
    })
    .from(partnerLedgerEntries)
    .where(eq(partnerLedgerEntries.partnerId, partnerId));

  return {
    qrIssued: statusCounts?.total ?? 0,
    qrAvailable: statusCounts?.available ?? 0,
    qrDraft: statusCounts?.draft ?? 0,
    qrActive: statusCounts?.active ?? 0,
    qrBlocked: statusCounts?.blocked ?? 0,
    qrDistributed: statusCounts?.distributed ?? 0,
    qrScanned: scannedRow?.count ?? 0,
    batchCount: batchRow?.count ?? 0,
    successfulSales: salesRow?.count ?? 0,
    commissionEarnedMinor: ledgerRow?.earned ?? 0,
    commissionPaidMinor: ledgerRow?.paidOut ?? 0,
    commissionUnpaidMinor: ledgerRow?.unpaid ?? 0,
    currency: ledgerRow?.currency ?? "GEL",
  };
}

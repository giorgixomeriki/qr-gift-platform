import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { qrBatches, qrCodes, orders, payments, partnerLedgerEntries } from "@/db/schema";

export type BatchPerformance = {
  batchId: string;
  label: string;
  quantity: number;
  distributed: number;
  /** Distinct cards of this batch with at least one QR_SCANNED event. */
  scanned: number;
  /** Orders on this batch's cards that are PAID (refunded sales excluded). */
  paidActivations: number;
  /** paidActivations / scanned, one decimal; null before the first scan. */
  conversionPct: number | null;
  /** Earned minus reversed commission booked for this batch's sales. */
  netCommissionMinor: number;
};

/**
 * Per-batch funnel from existing relationships only (QR -> batch, analytics
 * events, orders, ledger) — no separate analytics tables. Aggregates only:
 * never touches greetings or greeting_content, so it's safe for the partner
 * dashboard. Runs inside the caller's partner/admin transaction; RLS scopes
 * every subquery to rows that caller may see.
 */
export async function getBatchPerformance(tx: Tx, partnerId: string): Promise<BatchPerformance[]> {
  // Fully qualified on purpose: drizzle emits bare column names for a
  // single-table select, which is ambiguous inside the correlated subqueries.
  const batchIdRef = sql.raw(`"qr_batches"."id"`);
  const rows = await tx
    .select({
      batchId: qrBatches.id,
      label: qrBatches.label,
      quantity: qrBatches.quantity,
      distributed: sql<number>`(select count(*) from qr_codes q where q.batch_id = ${batchIdRef} and q.distribution_status = 'DISTRIBUTED')::int`,
      scanned: sql<number>`(select count(distinct e.qr_code_id) from analytics_events e join qr_codes q on q.id = e.qr_code_id where q.batch_id = ${batchIdRef} and e.event_type = 'QR_SCANNED')::int`,
      paidActivations: sql<number>`(select count(*) from orders o join qr_codes q on q.id = o.qr_code_id where q.batch_id = ${batchIdRef} and o.status = 'PAID')::int`,
      netCommissionMinor: sql<number>`(select coalesce(sum(l.amount_minor), 0) from partner_ledger_entries l join orders o on o.id = l.order_id join qr_codes q on q.id = o.qr_code_id where q.batch_id = ${batchIdRef} and l.type in ('COMMISSION_EARNED', 'COMMISSION_REVERSAL'))::int`,
    })
    .from(qrBatches)
    .where(eq(qrBatches.partnerId, partnerId))
    .orderBy(qrBatches.createdAt);

  return rows.map((r) => ({
    ...r,
    conversionPct: r.scanned > 0 ? Math.round((r.paidActivations / r.scanned) * 1000) / 10 : null,
  }));
}

export type SaleTraceRow = {
  orderId: string;
  orderStatus: string;
  paidAt: Date | null;
  createdAt: Date;
  qrCodeId: string;
  qrPublicToken: string;
  batchId: string;
  batchLabel: string;
  currency: string;
  grossAmountMinor: number;
  partnerCommissionMinor: number;
  commissionRateBps: number | null;
  paymentProvider: string | null;
  providerPaymentId: string | null;
  paymentStatus: string | null;
  commissionEarnedMinor: number | null;
  commissionReversedMinor: number | null;
};

/**
 * Admin-only: every money-bearing order for a partner, with the full chain
 * QR -> batch -> order -> payment -> ledger on one row, so "which partner
 * generated this paid activation?" and "why do we owe this amount?" never
 * need manual reconstruction. No greeting content is selected. Must run in
 * an admin transaction (payments are admin-only under RLS).
 */
export async function listPartnerSalesTrace(tx: Tx, partnerId: string, limit = 100): Promise<SaleTraceRow[]> {
  const base = await tx
    .select({
      orderId: orders.id,
      orderStatus: orders.status,
      paidAt: orders.paidAt,
      createdAt: orders.createdAt,
      qrCodeId: qrCodes.id,
      qrPublicToken: qrCodes.publicToken,
      batchId: qrBatches.id,
      batchLabel: qrBatches.label,
      currency: orders.currency,
      grossAmountMinor: orders.grossAmountMinor,
      partnerCommissionMinor: orders.partnerCommissionMinor,
      commissionRateBps: orders.commissionRateBps,
    })
    .from(orders)
    .innerJoin(qrCodes, eq(qrCodes.id, orders.qrCodeId))
    .innerJoin(qrBatches, eq(qrBatches.id, qrCodes.batchId))
    .where(and(eq(orders.partnerId, partnerId), inArray(orders.status, ["PAID", "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_REQUIRED"])))
    .orderBy(desc(sql`coalesce(${orders.paidAt}, ${orders.createdAt})`))
    .limit(limit);
  if (base.length === 0) return [];

  const orderIds = base.map((r) => r.orderId);
  const paymentRows = await tx
    .select({ orderId: payments.orderId, provider: payments.provider, providerPaymentId: payments.providerPaymentId, status: payments.status })
    .from(payments)
    .where(and(inArray(payments.orderId, orderIds), inArray(payments.status, ["SUCCEEDED", "REFUNDED"])));
  const ledgerRows = await tx
    .select({ orderId: partnerLedgerEntries.orderId, type: partnerLedgerEntries.type, amountMinor: partnerLedgerEntries.amountMinor })
    .from(partnerLedgerEntries)
    .where(inArray(partnerLedgerEntries.orderId, orderIds));

  return base.map((row) => {
    const payment = paymentRows.find((p) => p.orderId === row.orderId);
    const earned = ledgerRows.find((l) => l.orderId === row.orderId && l.type === "COMMISSION_EARNED");
    const reversal = ledgerRows.find((l) => l.orderId === row.orderId && l.type === "COMMISSION_REVERSAL");
    return {
      ...row,
      paymentProvider: payment?.provider ?? null,
      providerPaymentId: payment?.providerPaymentId ?? null,
      paymentStatus: payment?.status ?? null,
      commissionEarnedMinor: earned?.amountMinor ?? null,
      commissionReversedMinor: reversal ? -reversal.amountMinor : null,
    };
  });
}

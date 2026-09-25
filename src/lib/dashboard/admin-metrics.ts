import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { partners, qrCodes, qrBatches, orders, partnerLedgerEntries, analyticsEvents } from "@/db/schema";

export type AdminMetrics = {
  partnerCount: number;
  activePartnerCount: number;
  batchCount: number;
  qrGenerated: number;
  qrDistributed: number;
  qrActive: number;
  qrBlocked: number;
  successfulSales: number;
  totalCommissionMinor: number;
  funnel: FunnelStage[];
};

export const FUNNEL_STAGE_KEYS = [
  "qrGenerated",
  "qrDistributed",
  "qrScanned",
  "creationStarted",
  "themeSelected",
  "contentCreated",
  "previewViewed",
  "checkoutStarted",
  "paymentSucceeded",
  "qrActivated",
  "recipientViewed",
] as const;
export type FunnelStageKey = (typeof FUNNEL_STAGE_KEYS)[number];

export type FunnelStage = {
  /** A stable key, not display text — the caller looks this up in admin.dashboard.funnel.stages via next-intl, since this module has no locale of its own. */
  key: FunnelStageKey;
  count: number;
  /** % of the immediately preceding stage — null for the first stage. */
  conversionFromPreviousPct: number | null;
};

export async function getAdminMetrics(tx: Tx): Promise<AdminMetrics> {
  const [partnerRow] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${partners.status} = 'ACTIVE')::int`,
    })
    .from(partners);

  const [batchRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(qrBatches);

  const [qrRow] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      distributed: sql<number>`count(*) filter (where ${qrCodes.distributionStatus} = 'DISTRIBUTED')::int`,
      active: sql<number>`count(*) filter (where ${qrCodes.status} = 'ACTIVE')::int`,
      blocked: sql<number>`count(*) filter (where ${qrCodes.status} = 'BLOCKED')::int`,
    })
    .from(qrCodes);

  const [salesRow] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.status, "PAID"));

  const [commissionRow] = await tx
    .select({
      total: sql<number>`coalesce(sum(${partnerLedgerEntries.amountMinor}) filter (where ${partnerLedgerEntries.type} = 'COMMISSION_EARNED'), 0)::int`,
    })
    .from(partnerLedgerEntries);

  // Every per-greeting stage below counts DISTINCT greeting_id (QR_SCANNED
  // counts distinct qr_code_id, since it can fire before a Greeting exists
  // yet) rather than raw count(*) — an event like PREVIEW_VIEWED or
  // RECIPIENT_VIEWED can genuinely fire more than once for the same
  // Greeting (a repeat visit, a page refresh), and counting those rows
  // directly inflated the funnel and produced conversion percentages that
  // didn't reflect how many distinct QR codes/Greetings actually reached
  // each stage.
  const [eventRow] = await tx
    .select({
      scanned: sql<number>`count(distinct ${analyticsEvents.qrCodeId}) filter (where ${analyticsEvents.eventType} = 'QR_SCANNED')::int`,
      creationStarted: sql<number>`count(distinct ${analyticsEvents.greetingId}) filter (where ${analyticsEvents.eventType} = 'CREATION_STARTED')::int`,
      themeSelected: sql<number>`count(distinct ${analyticsEvents.greetingId}) filter (where ${analyticsEvents.eventType} = 'THEME_SELECTED')::int`,
      contentCreated: sql<number>`count(distinct ${analyticsEvents.greetingId}) filter (where ${analyticsEvents.eventType} = 'CONTENT_CREATED')::int`,
      previewViewed: sql<number>`count(distinct ${analyticsEvents.greetingId}) filter (where ${analyticsEvents.eventType} = 'PREVIEW_VIEWED')::int`,
      checkoutStarted: sql<number>`count(distinct ${analyticsEvents.greetingId}) filter (where ${analyticsEvents.eventType} = 'CHECKOUT_STARTED')::int`,
      recipientViewed: sql<number>`count(distinct ${analyticsEvents.greetingId}) filter (where ${analyticsEvents.eventType} = 'RECIPIENT_VIEWED')::int`,
    })
    .from(analyticsEvents);

  return {
    partnerCount: partnerRow?.total ?? 0,
    activePartnerCount: partnerRow?.active ?? 0,
    batchCount: batchRow?.count ?? 0,
    qrGenerated: qrRow?.total ?? 0,
    qrDistributed: qrRow?.distributed ?? 0,
    qrActive: qrRow?.active ?? 0,
    qrBlocked: qrRow?.blocked ?? 0,
    successfulSales: salesRow?.count ?? 0,
    totalCommissionMinor: commissionRow?.total ?? 0,
    funnel: buildFunnel({
      generated: qrRow?.total ?? 0,
      distributed: qrRow?.distributed ?? 0,
      scanned: eventRow?.scanned ?? 0,
      creationStarted: eventRow?.creationStarted ?? 0,
      themeSelected: eventRow?.themeSelected ?? 0,
      contentCreated: eventRow?.contentCreated ?? 0,
      previewViewed: eventRow?.previewViewed ?? 0,
      checkoutStarted: eventRow?.checkoutStarted ?? 0,
      paid: salesRow?.count ?? 0,
      activated: qrRow?.active ?? 0,
      recipientViewed: eventRow?.recipientViewed ?? 0,
    }),
  };
}

/**
 * The V1 commercial funnel (see lib/validation/analytics-events.ts's doc
 * comment for the canonical stage list) — QR_GENERATED and QR_ACTIVE come
 * from qr_codes' own authoritative status, not events, since those are real
 * current-state counts rather than lifetime event counts; every other stage
 * is a lifetime count of its analytics event. Conversion % is intentionally
 * only ever computed against the IMMEDIATELY prior stage, never a compounding
 * "% of total" — a partner/admin reading this wants "how many of the people
 * who reached step N also reached step N+1," not a compounded fraction.
 */
function buildFunnel(counts: {
  generated: number;
  distributed: number;
  scanned: number;
  creationStarted: number;
  themeSelected: number;
  contentCreated: number;
  previewViewed: number;
  checkoutStarted: number;
  paid: number;
  activated: number;
  recipientViewed: number;
}): FunnelStage[] {
  const stages: { key: FunnelStageKey; count: number }[] = [
    { key: "qrGenerated", count: counts.generated },
    { key: "qrDistributed", count: counts.distributed },
    { key: "qrScanned", count: counts.scanned },
    { key: "creationStarted", count: counts.creationStarted },
    { key: "themeSelected", count: counts.themeSelected },
    { key: "contentCreated", count: counts.contentCreated },
    { key: "previewViewed", count: counts.previewViewed },
    { key: "checkoutStarted", count: counts.checkoutStarted },
    { key: "paymentSucceeded", count: counts.paid },
    { key: "qrActivated", count: counts.activated },
    { key: "recipientViewed", count: counts.recipientViewed },
  ];

  return stages.map((stage, i) => {
    const previous = stages[i - 1];
    const conversionFromPreviousPct = previous && previous.count > 0 ? Math.round((stage.count / previous.count) * 1000) / 10 : null;
    return { ...stage, conversionFromPreviousPct };
  });
}

import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { withAdminContext } from "@/db/client";
import { analyticsEvents, greetings, orders, paymentRefunds, payments, qrCodes } from "@/db/schema";

export type DisputeEvidence = {
  generatedAt: string;
  order: { id: string; status: string; createdAt: string; paidAt: string | null; amountMinor: number; currency: string };
  charges: { provider: string; providerReference: string | null; status: string; amountMinor: number; currency: string; confirmedAt: string | null; cardBrand?: string; cardLast4?: string; paymentMethodType?: string }[];
  delivery: { greetingActivatedAt: string | null; cardActivatedAt: string | null; recipientViews: number; firstRecipientViewAt: string | null; lastRecipientViewAt: string | null };
  refunds: { reason: string; status: string; amountMinor: number; reference: string | null; requestedAt: string; resolvedAt: string | null }[];
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Evidence pack for a card dispute (BOG plan §3.7): what was bought, how it
 * was paid, and proof of delivery (activation, recipient opened it). Admin
 * only. Deliberately contains NO greeting content, media or sender/recipient
 * identity (docs/PRIVACY_MODEL.md) and no card data beyond the brand and last
 * four digits already kept by sanitizeProviderMetadata.
 */
export async function getDisputeEvidence(adminUserId: string, orderId: string): Promise<DisputeEvidence> {
  return withAdminContext(adminUserId, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw new Error(`Order ${orderId} not found`);
    const charges = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, orderId), inArray(payments.status, ["SUCCEEDED", "REFUNDED"])))
      .orderBy(asc(payments.confirmedAt));
    const [greeting] = await tx.select({ activatedAt: greetings.activatedAt }).from(greetings).where(eq(greetings.id, order.greetingId)).limit(1);
    const [qr] = await tx.select({ activatedAt: qrCodes.activatedAt }).from(qrCodes).where(eq(qrCodes.id, order.qrCodeId)).limit(1);
    const views = await tx
      .select({ createdAt: analyticsEvents.createdAt })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.greetingId, order.greetingId), eq(analyticsEvents.eventType, "RECIPIENT_VIEWED")))
      .orderBy(asc(analyticsEvents.createdAt));
    const refunds = await tx.select().from(paymentRefunds).where(eq(paymentRefunds.orderId, orderId)).orderBy(asc(paymentRefunds.requestedAt));

    return {
      generatedAt: new Date().toISOString(),
      order: { id: order.id, status: order.status, createdAt: order.createdAt.toISOString(), paidAt: iso(order.paidAt), amountMinor: order.grossAmountMinor, currency: order.currency },
      charges: charges.map((c) => {
        const m = c.providerMetadata as Record<string, unknown>;
        const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : undefined);
        return {
          provider: c.provider,
          providerReference: c.providerPaymentId,
          status: c.status,
          amountMinor: c.amountMinor,
          currency: c.currency,
          confirmedAt: iso(c.confirmedAt),
          ...(str("cardBrand") ? { cardBrand: str("cardBrand") } : {}),
          ...(str("cardLast4") ? { cardLast4: str("cardLast4") } : {}),
          ...(str("paymentMethodType") ? { paymentMethodType: str("paymentMethodType") } : {}),
        };
      }),
      delivery: {
        greetingActivatedAt: iso(greeting?.activatedAt ?? null),
        cardActivatedAt: iso(qr?.activatedAt ?? null),
        recipientViews: views.length,
        firstRecipientViewAt: iso(views[0]?.createdAt ?? null),
        lastRecipientViewAt: iso(views.at(-1)?.createdAt ?? null),
      },
      refunds: refunds.map((r) => ({ reason: r.reason, status: r.status, amountMinor: r.amountMinor, reference: r.providerActionId, requestedAt: r.requestedAt.toISOString(), resolvedAt: iso(r.resolvedAt) })),
    };
  });
}

import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { withEditableGreeting } from "@/db/client";
import { checkoutConsents, greetings, orders } from "@/db/schema";
import { isOriginalSender } from "@/lib/greetings/recipient";
import { greetingAvailableUntil } from "@/lib/greetings/availability";
import { checkoutSeller } from "@/lib/merchant/info";
import { getMerchantInfo } from "@/lib/merchant/server";
import { consentTextSha256 } from "./checkout";
import { renderConfirmationHtml, type ConfirmationData } from "./confirmation-html";
import kaMessages from "@/messages/ka.json";
import enMessages from "@/messages/en.json";

/**
 * The buyer's copy of the contract and payment (a durable record they can
 * save or print): order reference, amount, payment time, activation and
 * opening time, the policies' effective date and the two consent sentences
 * exactly as accepted. Built on request from the records that already exist
 * (orders, checkout_consents, greetings) — nothing new is stored.
 *
 * Only the original sender gets it: the same edit-token cookie that shows the
 * "sent by you" note. Anyone else gets null (→ 404, nothing revealed).
 */
export async function loadPurchaseConfirmation(greetingId: string, editToken: string | undefined): Promise<ConfirmationData | null> {
  if (!(await isOriginalSender(greetingId, editToken))) return null;
  return withEditableGreeting(greetingId, async (tx) => {
    const [g] = await tx
      .select({ activatedAt: greetings.activatedAt, unlockAt: greetings.unlockAt, unlockTimeZone: greetings.unlockTimeZone })
      .from(greetings)
      .where(eq(greetings.id, greetingId))
      .limit(1);
    if (!g?.activatedAt) return null;
    const [order] = await tx
      .select({ id: orders.id, currency: orders.currency, amountMinor: orders.grossAmountMinor, paidAt: orders.paidAt, status: orders.status })
      .from(orders)
      .where(and(eq(orders.greetingId, greetingId), isNotNull(orders.paidAt)))
      .orderBy(desc(orders.paidAt))
      .limit(1);
    if (!order?.paidAt) return null;
    const [consent] = await tx
      .select({ acceptedAt: checkoutConsents.acceptedAt, locale: checkoutConsents.locale, sha: checkoutConsents.consentTextSha256, effective: checkoutConsents.policiesEffectiveDate })
      .from(checkoutConsents)
      .where(eq(checkoutConsents.orderId, order.id))
      .orderBy(desc(checkoutConsents.acceptedAt))
      .limit(1);
    const consentLocale = consent?.locale === "en" ? "en" : "ka";
    const legal = (consentLocale === "en" ? enMessages : kaMessages).wizard.checkout.legal;
    const seller = checkoutSeller(getMerchantInfo(), consentLocale);
    return {
      orderId: order.id,
      orderStatus: order.status,
      amountMinor: order.amountMinor,
      currency: order.currency,
      paidAt: order.paidAt,
      activatedAt: g.activatedAt,
      availableUntil: greetingAvailableUntil(g.activatedAt),
      unlockAt: g.unlockAt,
      unlockTimeZone: g.unlockTimeZone,
      consent: consent
        ? {
            acceptedAt: consent.acceptedAt,
            locale: consentLocale,
            policiesEffectiveDate: consent.effective,
            sha256: consent.sha,
            // Shown only when the recorded hash proves these are the sentences that were accepted.
            statements: consent.sha === consentTextSha256(consentLocale) ? [legal.consent, legal.activationConsent] : null,
          }
        : null,
      seller,
    };
  });
}

export { renderConfirmationHtml };

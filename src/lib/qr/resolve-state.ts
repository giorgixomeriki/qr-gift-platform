import "server-only";
import { eq, sql } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { qrCodes, greetings } from "@/db/schema";
import { isGreetingExpired } from "@/lib/greetings/availability";

export type QrResolution =
  | { kind: "not_found" }
  | { kind: "available"; qrId: string; partnerId: string }
  | { kind: "draft"; qrId: string; greetingId: string; partnerId: string }
  | { kind: "active"; qrId: string; greetingId: string; partnerId: string }
  /** Paid and activated, but past its availability window (lib/greetings/availability.ts). Nothing is deleted. */
  | { kind: "expired"; qrId: string; greetingId: string; partnerId: string }
  /**
   * Refund Model C: the purchase was fully refunded (admin refund or recorded chargeback), so the
   * greeting is not shown publicly. Nothing is deleted — QR token, greeting, content and media stay.
   */
  | { kind: "suspended"; qrId: string; greetingId: string; partnerId: string }
  | { kind: "blocked" };

/**
 * The single place that turns a scanned public_token into "what should render
 * at /g/{token} right now" (architecture plan §2). No caller-supplied ID is
 * ever trusted here — the token IS the lookup key, resolved with zero actor
 * context (withPublicContext), consistent with the public QR identity model.
 * `partnerId` is returned (never rendered — only used server-side for
 * analytics attribution by the caller) so the dashboards' "scanned" figures
 * reflect real traffic; a "not_found"/"blocked" resolution never reaches this
 * far, so it carries no partnerId and cannot leak partner existence either way.
 *
 * Suspended partner (QA-04): no new commercial activity — an AVAILABLE card
 * can't be started and a DRAFT can't be continued to checkout, so both
 * resolve to "blocked". A greeting that is already ACTIVE (paid for) stays
 * readable by its recipient: suspension is about the partner's business,
 * not about taking away something a customer already bought.
 *
 * Refund Model C: an ACTIVE greeting whose purchase was fully refunded
 * (order REFUNDED, no PAID order — app_greeting_refund_suspended) resolves to
 * "suspended". A duplicate-charge refund or a partial refund does not.
 */
export async function resolveQrState(publicToken: string): Promise<QrResolution> {
  return withPublicContext(async (tx) => {
    const [qr] = await tx
      .select({
        id: qrCodes.id,
        status: qrCodes.status,
        partnerId: qrCodes.partnerId,
        partnerActive: sql<boolean>`app_partner_is_active(${qrCodes.partnerId})`,
      })
      .from(qrCodes)
      .where(eq(qrCodes.publicToken, publicToken))
      .limit(1);

    if (!qr) return { kind: "not_found" };
    if (!qr.partnerActive && (qr.status === "AVAILABLE" || qr.status === "DRAFT")) return { kind: "blocked" };

    switch (qr.status) {
      case "AVAILABLE":
        return { kind: "available", qrId: qr.id, partnerId: qr.partnerId };
      case "BLOCKED":
        // Never distinguish "blocked" from "never existed" beyond this point —
        // no internal IDs, moderation reasons, or sender info are exposed.
        return { kind: "blocked" };
      case "DRAFT":
      case "ACTIVE": {
        const [greeting] = await tx
          .select({
            id: greetings.id,
            status: greetings.status,
            activatedAt: greetings.activatedAt,
            // migrations/0029: the one authority for "fully refunded" (the content RLS policy enforces it too).
            refundSuspended: sql<boolean>`app_greeting_refund_suspended(${greetings.id})`,
          })
          .from(greetings)
          .where(eq(greetings.qrCodeId, qr.id))
          .limit(1);
        if (!greeting) return { kind: "blocked" }; // inconsistent state — fail closed, not found-shaped
        if (qr.status === "ACTIVE" && greeting.status === "ACTIVE") {
          // Checked before expiry and before anything else that could show the greeting.
          if (greeting.refundSuspended !== false) return { kind: "suspended", qrId: qr.id, greetingId: greeting.id, partnerId: qr.partnerId };
          if (isGreetingExpired(greeting.activatedAt)) return { kind: "expired", qrId: qr.id, greetingId: greeting.id, partnerId: qr.partnerId };
          return { kind: "active", qrId: qr.id, greetingId: greeting.id, partnerId: qr.partnerId };
        }
        return { kind: "draft", qrId: qr.id, greetingId: greeting.id, partnerId: qr.partnerId };
      }
    }
  });
}

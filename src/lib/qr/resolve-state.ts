import "server-only";
import { eq } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { qrCodes, greetings } from "@/db/schema";

export type QrResolution =
  | { kind: "not_found" }
  | { kind: "available"; qrId: string; partnerId: string }
  | { kind: "draft"; qrId: string; greetingId: string; partnerId: string }
  | { kind: "active"; qrId: string; greetingId: string; partnerId: string }
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
 */
export async function resolveQrState(publicToken: string): Promise<QrResolution> {
  return withPublicContext(async (tx) => {
    const [qr] = await tx
      .select({ id: qrCodes.id, status: qrCodes.status, partnerId: qrCodes.partnerId })
      .from(qrCodes)
      .where(eq(qrCodes.publicToken, publicToken))
      .limit(1);

    if (!qr) return { kind: "not_found" };

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
          .select({ id: greetings.id, status: greetings.status })
          .from(greetings)
          .where(eq(greetings.qrCodeId, qr.id))
          .limit(1);
        if (!greeting) return { kind: "blocked" }; // inconsistent state — fail closed, not found-shaped
        if (qr.status === "ACTIVE" && greeting.status === "ACTIVE") {
          return { kind: "active", qrId: qr.id, greetingId: greeting.id, partnerId: qr.partnerId };
        }
        return { kind: "draft", qrId: qr.id, greetingId: greeting.id, partnerId: qr.partnerId };
      }
    }
  });
}

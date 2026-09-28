import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withPublicContext, withClaimableQr, type Tx } from "@/db/client";
import { qrCodes, greetings, themes, products } from "@/db/schema";
import { generateEditToken, hashEditToken } from "@/lib/security/edit-token";
import { DEFAULT_THEME_KEY } from "@/lib/themes/registry";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { DEFAULT_PRODUCT_KEY } from "./constants";

export class StartGreetingError extends Error {}

/**
 * Sender-facing start flow (Phase 2 §2): AVAILABLE QR -> DRAFT Greeting ->
 * DRAFT QR -> fresh edit token. Returns the PLAINTEXT edit token exactly
 * once — callers must set it as an HttpOnly cookie immediately and never
 * persist or log it; only its hash is stored (greetings.edit_token_hash).
 *
 * Race safety: the actual claim is a single conditional
 * `UPDATE qr_codes SET status='DRAFT' WHERE id=? AND status='AVAILABLE'`
 * inside the transaction (via qr_codes_update_by_claim's RLS, which itself
 * requires status='AVAILABLE' in USING). Two concurrent calls for the same
 * QR: Postgres serializes the row-locking UPDATE, the loser's WHERE clause
 * matches zero rows once the winner has committed, .returning() comes back
 * empty, and we throw — no greeting is ever inserted for the loser. This
 * needs no explicit SELECT FOR UPDATE; the conditional UPDATE IS the lock.
 */
export async function startGreeting(publicToken: string): Promise<{ greetingId: string; editToken: string }> {
  const qr = await withPublicContext(async (tx) => {
    const [row] = await tx
      .select({
        id: qrCodes.id,
        status: qrCodes.status,
        partnerId: qrCodes.partnerId,
        partnerActive: sql<boolean>`app_partner_is_active(${qrCodes.partnerId})`,
      })
      .from(qrCodes)
      .where(eq(qrCodes.publicToken, publicToken))
      .limit(1);
    return row ?? null;
  });

  if (!qr) throw new StartGreetingError("QR not found");
  if (qr.status !== "AVAILABLE") {
    throw new StartGreetingError("This QR has already been started or is unavailable");
  }
  // Suspended partner: no new claims. qr_codes_update_by_claim enforces the
  // same rule in RLS (migrations/0011) in case this check is ever bypassed.
  if (!qr.partnerActive) {
    throw new StartGreetingError("This QR is unavailable");
  }

  const [defaultTheme, defaultProduct] = await withPublicContext(async (tx) => {
    const [theme] = await tx.select({ id: themes.id }).from(themes).where(eq(themes.key, DEFAULT_THEME_KEY)).limit(1);
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.key, DEFAULT_PRODUCT_KEY)).limit(1);
    return [theme, product] as const;
  });
  if (!defaultTheme || !defaultProduct) {
    throw new StartGreetingError("Catalog not seeded (theme/product missing)");
  }

  const editToken = generateEditToken();
  const editTokenHash = hashEditToken(editToken);

  const greetingId = await withClaimableQr(qr.id, async (tx: Tx) => {
    const claimed = await tx
      .update(qrCodes)
      .set({ status: "DRAFT" })
      .where(and(eq(qrCodes.id, qr.id), eq(qrCodes.status, "AVAILABLE")))
      .returning({ id: qrCodes.id });
    if (claimed.length === 0) {
      throw new StartGreetingError("This QR was just started by someone else");
    }

    const [greeting] = await tx
      .insert(greetings)
      .values({
        qrCodeId: qr.id,
        themeId: defaultTheme.id,
        productId: defaultProduct.id,
        status: "DRAFT",
        editTokenHash,
      })
      .returning({ id: greetings.id });
    if (!greeting) throw new StartGreetingError("Failed to create greeting");
    return greeting.id;
  });

  await recordAnalyticsEvent({ eventType: "CREATION_STARTED", qrCodeId: qr.id, greetingId }, { partnerId: qr.partnerId });

  return { greetingId, editToken };
}

import "server-only";
import { eq } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { greetings, greetingContent, themes, qrCodes } from "@/db/schema";
import { verifyEditToken } from "@/lib/security/edit-token";
import type { ThemeKey } from "@/lib/themes/registry";
import { createSignedReadUrl } from "@/lib/storage/media";

export class RecipientAccessError extends Error {}

/**
 * The ACTIVE-only counterpart to loadDraftForEdit (Phase 3 §9/§11). No edit
 * token is required or accepted — authorization here IS "QR ACTIVE AND
 * Greeting ACTIVE", enforced twice: once by the caller only ever reaching
 * this function via resolveQrState's "active" branch, and again here by
 * re-checking both statuses directly rather than trusting the caller.
 * greeting_content_select's RLS policy has its own unconditional `g.status =
 * 'ACTIVE'` public branch (migrations/0001), so this needs no special
 * transaction context — the same guarantee exists at the DB layer, not just
 * in this function.
 */
export async function loadActiveGreetingForRecipient(greetingId: string) {
  return withPublicContext(async (tx) => {
    const [greeting] = await tx.select().from(greetings).where(eq(greetings.id, greetingId)).limit(1);
    if (!greeting || greeting.status !== "ACTIVE") throw new RecipientAccessError("Greeting is not active");

    const [qr] = await tx.select({ status: qrCodes.status }).from(qrCodes).where(eq(qrCodes.id, greeting.qrCodeId)).limit(1);
    if (!qr || qr.status !== "ACTIVE") throw new RecipientAccessError("QR is not active");

    const [themeRow] = await tx.select({ key: themes.key }).from(themes).where(eq(themes.id, greeting.themeId)).limit(1);

    const contentRows = await tx.select().from(greetingContent).where(eq(greetingContent.greetingId, greetingId));
    const content = await Promise.all(
      contentRows.map(async (row) => ({
        ...row,
        // Freshly signed on every load, never a stored/permanent URL — same
        // rule as the sender-side loader (lib/storage/media.ts).
        signedUrl: row.storageKey && row.status === "READY" ? await createSignedReadUrl(row.storageKey) : null,
      })),
    );

    return { greeting, themeKey: (themeRow?.key ?? "minimal") as ThemeKey, themeVersion: greeting.themeVersion, content };
  });
}

/**
 * Read-only identity check: is the presented edit-token cookie the one
 * originally issued for THIS greeting? Deliberately independent of
 * verifyGreetingEditAccess (lib/greetings/access.ts), which additionally
 * requires status === 'DRAFT' and is used to gate MUTATIONS. Once a Greeting
 * is ACTIVE, every mutation path still goes through verifyGreetingEditAccess
 * and is rejected by that DRAFT check (backed independently by RLS's own
 * status checks on greetings_update_by_token / greeting_content_* — not just
 * this app-layer check). This function is only ever used to decide whether
 * to show the sender their own "your surprise is ready" success banner; it
 * grants no write capability of any kind.
 */
export async function isOriginalSender(greetingId: string, presentedToken: string | undefined): Promise<boolean> {
  if (!presentedToken) return false;
  const [greeting] = await withPublicContext((tx) => tx.select({ editTokenHash: greetings.editTokenHash }).from(greetings).where(eq(greetings.id, greetingId)).limit(1));
  if (!greeting) return false;
  return verifyEditToken(presentedToken, greeting.editTokenHash);
}

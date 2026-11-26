import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { greetings, greetingContent, themes, qrCodes } from "@/db/schema";
import { verifyEditToken } from "@/lib/security/edit-token";
import type { ThemeKey } from "@/lib/themes/registry";
import { createSignedReadUrl } from "@/lib/storage/media";
import { isGreetingExpired } from "./availability";
import { parseStoredCountdown } from "./countdown";

export class RecipientAccessError extends Error {}
/** The greeting is paid and active but its scheduled moment has not come (migrations/0030). */
export class GreetingLockedError extends RecipientAccessError {}
/** The scheduled moment arrived between resolving the QR and loading the lock: render the greeting instead. */
export class GreetingNowOpenError extends Error {}

type Tx = Parameters<Parameters<typeof withPublicContext>[0]>[0];

/**
 * app_greeting_public_state() — the one authority (database clock) on whether
 * the public may see this greeting's content now: OPEN, SCHEDULED, SUSPENDED
 * (confirmed full refund) or UNAVAILABLE. Re-checked by every loader here
 * rather than trusted from resolveQrState, and enforced again by RLS.
 */
async function publicState(tx: Tx, greetingId: string): Promise<{ state: string; now: Date }> {
  const [row] = await tx.execute<{ state: string; now: Date | string }>(sql`select app_greeting_public_state(${greetingId}::uuid) as state, now() as now`);
  return { state: row?.state ?? "UNAVAILABLE", now: new Date(row?.now ?? Date.now()) };
}

function assertOpen(state: string) {
  if (state === "SCHEDULED") throw new GreetingLockedError("Greeting is scheduled to open later");
  if (state !== "OPEN") throw new RecipientAccessError(`Greeting is not open (${state})`);
}

/**
 * The ACTIVE-only counterpart to loadDraftForEdit (Phase 3 §9/§11). No edit
 * token is required or accepted — authorization here IS "QR ACTIVE AND
 * Greeting ACTIVE", enforced twice: once by the caller only ever reaching
 * this function via resolveQrState's "active" branch, and again here by
 * re-checking both statuses directly rather than trusting the caller — and
 * the Refund Model C suspension (migrations/0029), so no signed media URL is
 * ever issued for a fully refunded greeting.
 * greeting_content_select's RLS policy has its own unconditional `g.status =
 * 'ACTIVE'` public branch (migrations/0001), so this needs no special
 * transaction context — the same guarantee exists at the DB layer, not just
 * in this function.
 */
export async function loadActiveGreetingForRecipient(greetingId: string) {
  return withPublicContext(async (tx) => {
    const [greeting] = await tx.select().from(greetings).where(eq(greetings.id, greetingId)).limit(1);
    if (!greeting || greeting.status !== "ACTIVE") throw new RecipientAccessError("Greeting is not active");
    // Checked here too, not only in resolveQrState: no signed media URL is ever issued for an expired greeting.
    if (isGreetingExpired(greeting.activatedAt)) throw new RecipientAccessError("Greeting availability has ended");

    const [qr] = await tx.select({ status: qrCodes.status }).from(qrCodes).where(eq(qrCodes.id, greeting.qrCodeId)).limit(1);
    if (!qr || qr.status !== "ACTIVE") throw new RecipientAccessError("QR is not active");
    // Scheduled / refund-suspended: no content row is read and no media URL is signed.
    const { state, now } = await publicState(tx, greetingId);
    assertOpen(state);

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

    const countdownRow = content.find((c) => c.type === "countdown" && c.status === "READY");
    return {
      greeting,
      themeKey: (themeRow?.key ?? "minimal") as ThemeKey,
      themeVersion: greeting.themeVersion,
      content,
      countdown: parseStoredCountdown(countdownRow?.textValue),
      serverNow: now,
    };
  });
}

/**
 * Everything the locked (scheduled) screen may show — and nothing more: the
 * world it will open in (theme metadata is public, like the QR's status), the
 * moment it opens, the zone the sender chose, and the database's clock so the
 * countdown does not depend on the recipient's device clock. Never reads
 * greeting_content (RLS would refuse it anyway) and never signs a URL.
 */
export async function loadScheduledGreetingShell(greetingId: string) {
  return withPublicContext(async (tx) => {
    const [greeting] = await tx
      .select({ id: greetings.id, status: greetings.status, themeId: greetings.themeId, themeVersion: greetings.themeVersion, unlockAt: greetings.unlockAt, unlockTimeZone: greetings.unlockTimeZone, activatedAt: greetings.activatedAt })
      .from(greetings)
      .where(eq(greetings.id, greetingId))
      .limit(1);
    if (!greeting || greeting.status !== "ACTIVE" || !greeting.unlockAt) throw new RecipientAccessError("Greeting is not scheduled");
    if (isGreetingExpired(greeting.activatedAt)) throw new RecipientAccessError("Greeting availability has ended");
    const { state, now } = await publicState(tx, greetingId);
    if (state === "OPEN") throw new GreetingNowOpenError("Greeting has just opened");
    if (state !== "SCHEDULED") throw new RecipientAccessError(`Greeting is not scheduled (${state})`);
    const [themeRow] = await tx.select({ key: themes.key }).from(themes).where(eq(themes.id, greeting.themeId)).limit(1);
    return {
      themeKey: (themeRow?.key ?? "minimal") as ThemeKey,
      themeVersion: greeting.themeVersion,
      unlockAt: greeting.unlockAt,
      timeZone: greeting.unlockTimeZone ?? "Asia/Tbilisi",
      serverNow: now,
    };
  });
}

/**
 * A fresh signed URL for the greeting's voice message, and nothing else.
 *
 * The page signs every media URL once, when it renders (READ_URL_TTL_SECONDS,
 * 10 minutes), but the voice player only mounts at the voice beat or in the
 * closing keepsake — often after a long reading, a locked phone or a replay —
 * and an expired URL fails silently. The player asks for a new one shortly
 * before expiry and after a load error (voice-player.tsx).
 *
 * Exactly the page's access rule, re-checked here rather than trusted:
 * greeting ACTIVE, availability not ended, QR ACTIVE, not refund-suspended (as
 * loadActiveGreetingForRecipient). Signs only the READY audio row, so it
 * reveals nothing the recipient page doesn't already show.
 */
export async function signRecipientVoiceUrl(greetingId: string): Promise<string | null> {
  return withPublicContext(async (tx) => {
    const [greeting] = await tx.select().from(greetings).where(eq(greetings.id, greetingId)).limit(1);
    if (!greeting || greeting.status !== "ACTIVE") throw new RecipientAccessError("Greeting is not active");
    if (isGreetingExpired(greeting.activatedAt)) throw new RecipientAccessError("Greeting availability has ended");
    const [qr] = await tx.select({ status: qrCodes.status }).from(qrCodes).where(eq(qrCodes.id, greeting.qrCodeId)).limit(1);
    if (!qr || qr.status !== "ACTIVE") throw new RecipientAccessError("QR is not active");
    assertOpen((await publicState(tx, greetingId)).state);
    const [row] = await tx
      .select({ storageKey: greetingContent.storageKey, status: greetingContent.status })
      .from(greetingContent)
      .where(and(eq(greetingContent.greetingId, greetingId), eq(greetingContent.type, "audio"), eq(greetingContent.status, "READY")))
      .limit(1);
    return row?.storageKey ? createSignedReadUrl(row.storageKey) : null;
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

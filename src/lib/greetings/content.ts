import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, withEditableGreeting } from "@/db/client";
import { greetings, greetingContent, qrCodes, themes } from "@/db/schema";
import { verifyGreetingEditAccess, InvalidEditTokenError } from "./access";
import { isThemeKey, type ThemeKey } from "@/lib/themes/registry";
import { getTemplate } from "@/lib/templates/catalog";
import { greetingMessageSchema } from "@/lib/validation/greeting-text";
import { validateMediaUpload, allowedMimeTypesFor, type SupportedContentType } from "@/lib/validation/content-types";
import { buildStorageKey, createSignedUploadUrl, createSignedReadUrl, deleteStorageObject } from "@/lib/storage/media";
import { verifyUploadedContentMatchesMime, ContentVerificationError } from "@/lib/storage/verify-upload";
import { recordAnalyticsEvent } from "@/lib/analytics";

export { InvalidEditTokenError };
export class ContentActionError extends Error {}

const SLOT_LIMITS: Record<Extract<SupportedContentType, "photo" | "video" | "audio">, number> = {
  photo: 3,
  video: 1,
  audio: 1,
};

/**
 * qr_codes is fully publicly readable by RLS design (qr_codes_select: `using
 * (true)`, see migrations/0001) and greetings metadata for a DRAFT/ACTIVE row
 * is too (`greetings_select`'s `status in ('ACTIVE','DRAFT')` branch) — so
 * this join needs no special transaction context. It is NEVER used to read
 * greeting_content, which has no such public branch.
 */
async function getOwningPartnerId(greetingId: string): Promise<string> {
  const [row] = await db
    .select({ partnerId: qrCodes.partnerId })
    .from(qrCodes)
    .innerJoin(greetings, eq(greetings.qrCodeId, qrCodes.id))
    .where(eq(greetings.id, greetingId))
    .limit(1);
  if (!row) throw new ContentActionError("Greeting has no owning QR — inconsistent state");
  return row.partnerId;
}

/**
 * Resolves + authorizes a DRAFT greeting for editing and returns everything
 * the creation wizard needs, content rows included with FRESH signed read
 * URLs (never a stored/permanent URL — see lib/storage/media.ts). Every
 * wizard page load calls this; it is also the single re-verification point
 * every mutation below builds on.
 */
export async function loadDraftForEdit(greetingId: string, editToken: string) {
  const greeting = await verifyGreetingEditAccess(greetingId, editToken);
  const partnerId = await getOwningPartnerId(greetingId);

  const [themeRow] = await db.select({ key: themes.key }).from(themes).where(eq(themes.id, greeting.themeId)).limit(1);

  // greeting_content has NO public-read branch (see migrations/0001's
  // greeting_content_select) — reading it for a DRAFT greeting requires the
  // same editable_greeting_id context the mutations below use.
  const contentRows = await withEditableGreeting(greetingId, (tx) =>
    tx.select().from(greetingContent).where(eq(greetingContent.greetingId, greetingId)),
  );
  const contentWithUrls = await Promise.all(
    contentRows.map(async (row) => ({
      ...row,
      signedUrl: row.storageKey && row.status === "READY" ? await createSignedReadUrl(row.storageKey) : null,
    })),
  );

  return {
    greeting,
    partnerId,
    themeKey: (themeRow?.key ?? "minimal") as ThemeKey,
    content: contentWithUrls,
  };
}

export async function updateGreetingTheme(greetingId: string, editToken: string, themeKey: string) {
  await verifyGreetingEditAccess(greetingId, editToken);
  if (!isThemeKey(themeKey)) throw new ContentActionError("Unknown theme");

  const [themeRow] = await db.select({ id: themes.id }).from(themes).where(eq(themes.key, themeKey)).limit(1);
  if (!themeRow) throw new ContentActionError("Theme not found");

  await withEditableGreeting(greetingId, (tx) =>
    // The version chosen now is the version the recipient will see (frozen once ACTIVE).
    tx.update(greetings).set({ themeId: themeRow.id, themeVersion: getTemplate(themeKey)!.version, updatedAt: sql`now()` }).where(eq(greetings.id, greetingId)),
  );

  const partnerId = await getOwningPartnerId(greetingId);
  await recordAnalyticsEvent({ eventType: "THEME_SELECTED", greetingId }, { partnerId });
}

export async function updateGreetingMessage(greetingId: string, editToken: string, text: string) {
  await verifyGreetingEditAccess(greetingId, editToken);
  const message = greetingMessageSchema.parse(text);

  await withEditableGreeting(greetingId, async (tx) => {
    const [existing] = await tx
      .select({ id: greetingContent.id })
      .from(greetingContent)
      .where(and(eq(greetingContent.greetingId, greetingId), eq(greetingContent.type, "text"), eq(greetingContent.slot, 0)))
      .limit(1);

    if (existing) {
      await tx.update(greetingContent).set({ textValue: message, status: "READY", updatedAt: sql`now()` }).where(eq(greetingContent.id, existing.id));
    } else {
      await tx.insert(greetingContent).values({ greetingId, type: "text", slot: 0, textValue: message, status: "READY" });
    }
  });

  const partnerId = await getOwningPartnerId(greetingId);
  await recordAnalyticsEvent({ eventType: "CONTENT_CREATED", greetingId }, { partnerId });
}

/**
 * Step 1 of a media upload: allocates a content row + a short-lived signed
 * Storage upload URL. The declared mimeType/sizeBytes are validated against
 * the allowlist (lib/validation/content-types.ts) purely to decide whether
 * to issue a URL at all — they are NOT trusted as proof of the eventual
 * upload; finalizeMediaUpload re-verifies the real bytes.
 */
export async function requestMediaUpload(
  greetingId: string,
  editToken: string,
  input: { type: Extract<SupportedContentType, "photo" | "video" | "audio">; slot: number; mimeType: string; sizeBytes: number },
) {
  await verifyGreetingEditAccess(greetingId, editToken);
  const validated = validateMediaUpload({ type: input.type, slot: input.slot, mimeType: input.mimeType, sizeBytes: input.sizeBytes });

  const limit = SLOT_LIMITS[input.type];
  if (validated.slot < 0 || validated.slot >= limit) {
    throw new ContentActionError(`${input.type} supports at most ${limit} item(s)`);
  }

  const partnerId = await getOwningPartnerId(greetingId);
  const extension = validated.mimeType.split("/")[1]?.replace("quicktime", "mov") ?? "bin";

  return withEditableGreeting(greetingId, async (tx) => {
    // Replacing this slot: the client calls deleteContent before requesting
    // a replacement, but clear any stale row defensively so this can never
    // violate a future unique-slot constraint.
    const existing = await tx
      .select({ id: greetingContent.id })
      .from(greetingContent)
      .where(and(eq(greetingContent.greetingId, greetingId), eq(greetingContent.type, validated.type), eq(greetingContent.slot, validated.slot)));
    for (const row of existing) {
      await tx.delete(greetingContent).where(eq(greetingContent.id, row.id));
    }

    const [created] = await tx
      .insert(greetingContent)
      .values({
        greetingId,
        type: validated.type,
        slot: validated.slot,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        status: "PENDING",
      })
      .returning({ id: greetingContent.id });
    if (!created) throw new ContentActionError("Failed to allocate content slot");

    const storageKey = buildStorageKey({ partnerId, greetingId, contentId: created.id, extension });
    await tx.update(greetingContent).set({ storageKey }).where(eq(greetingContent.id, created.id));

    const upload = await createSignedUploadUrl(storageKey);
    return { contentId: created.id, storageKey, uploadUrl: upload.signedUrl };
  });
}

/**
 * Step 2: called after the client's direct PUT to Storage completes.
 * Re-verifies the real uploaded bytes match the declared MIME family
 * (lib/storage/verify-upload.ts) before ever marking content READY — a
 * rejected/mismatched upload is deleted from Storage, not just hidden.
 */
export async function finalizeMediaUpload(greetingId: string, editToken: string, contentId: string) {
  await verifyGreetingEditAccess(greetingId, editToken);

  const [row] = await withEditableGreeting(greetingId, (tx) =>
    tx.select().from(greetingContent).where(and(eq(greetingContent.id, contentId), eq(greetingContent.greetingId, greetingId))).limit(1),
  );
  if (!row || !row.storageKey || !row.mimeType) throw new ContentActionError("Upload not found");
  if (row.status !== "PENDING") throw new ContentActionError("Upload already finalized");

  try {
    await verifyUploadedContentMatchesMime(row.storageKey, row.mimeType);
  } catch (err) {
    await deleteStorageObject(row.storageKey).catch(() => {});
    await withEditableGreeting(greetingId, (tx) => tx.delete(greetingContent).where(eq(greetingContent.id, contentId)));
    if (err instanceof ContentVerificationError) throw new ContentActionError(err.message);
    throw err;
  }

  await withEditableGreeting(greetingId, (tx) =>
    tx.update(greetingContent).set({ status: "READY", updatedAt: sql`now()` }).where(eq(greetingContent.id, contentId)),
  );

  const partnerId = await getOwningPartnerId(greetingId);
  await recordAnalyticsEvent({ eventType: "MEDIA_UPLOADED", greetingId, contentType: row.type as "photo" | "video" | "audio" }, { partnerId });

  return { signedUrl: await createSignedReadUrl(row.storageKey) };
}

export async function deleteContent(greetingId: string, editToken: string, contentId: string) {
  await verifyGreetingEditAccess(greetingId, editToken);

  const [row] = await withEditableGreeting(greetingId, (tx) =>
    tx.select({ storageKey: greetingContent.storageKey }).from(greetingContent).where(and(eq(greetingContent.id, contentId), eq(greetingContent.greetingId, greetingId))).limit(1),
  );
  if (!row) return;

  await withEditableGreeting(greetingId, (tx) => tx.delete(greetingContent).where(eq(greetingContent.id, contentId)));
  if (row.storageKey) await deleteStorageObject(row.storageKey).catch(() => {});
}

export async function markPreviewViewed(greetingId: string, editToken: string) {
  await verifyGreetingEditAccess(greetingId, editToken);
  const partnerId = await getOwningPartnerId(greetingId);
  await recordAnalyticsEvent({ eventType: "PREVIEW_VIEWED", greetingId }, { partnerId });
}

export { allowedMimeTypesFor };

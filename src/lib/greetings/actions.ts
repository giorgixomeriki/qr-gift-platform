"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { startGreeting, StartGreetingError } from "./start";
import {
  loadDraftForEdit,
  updateGreetingTheme,
  updateGreetingMessage,
  requestMediaUpload,
  finalizeMediaUpload,
  deleteContent,
  markPreviewViewed,
  ContentActionError,
} from "./content";
import { getEditToken } from "./edit-token-cookie";
import { editTokenCookieName, EDIT_TOKEN_COOKIE_OPTIONS } from "@/lib/security/edit-token";
import type { SupportedContentType } from "@/lib/validation/content-types";
import { enforceRateLimit, getClientIp, RateLimitedError } from "@/lib/rate-limit";
import { logServerError } from "@/lib/log";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorResult(scope: string, err: unknown, context: Record<string, string | number | undefined> = {}): ActionResult<never> {
  logServerError(scope, err, context);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

/**
 * Start flow entry point. On success, sets the HttpOnly edit-token cookie and
 * redirects back to the same public QR URL — the dispatcher (/g/[token])
 * re-resolves state and now sees the DRAFT it just created via the cookie it
 * just set, no id ever appears in the URL.
 *
 * PUBLIC EXPENSIVE per the rate-limiting classification: keyed by the QR
 * token itself (one legitimate sender starts a given QR exactly once — see
 * StartGreetingError's own "already started" case — so a tight limit here
 * only ever throttles a script hammering the same token, never a real
 * sender) and by IP as a second, independent bucket.
 */
export async function startGreetingAction(publicToken: string): Promise<ActionResult<never> | never> {
  let greetingId: string;
  try {
    const ip = getClientIp(await headers());
    await enforceRateLimit({ key: `greeting-start:token:${publicToken}`, limit: 5, windowSeconds: 60 });
    await enforceRateLimit({ key: `greeting-start:ip:${ip}`, limit: 20, windowSeconds: 60 });

    const result = await startGreeting(publicToken);
    greetingId = result.greetingId;
    const cookieStore = await cookies();
    cookieStore.set(editTokenCookieName(greetingId), result.editToken, EDIT_TOKEN_COOKIE_OPTIONS);
  } catch (err) {
    if (err instanceof StartGreetingError) return errorResult("startGreetingAction", err, { publicToken });
    if (err instanceof RateLimitedError) return errorResult("startGreetingAction.rateLimited", err, { publicToken });
    throw err;
  }
  redirect(`/g/${publicToken}`);
}

export async function updateThemeAction(greetingId: string, themeKey: string): Promise<ActionResult> {
  try {
    const token = await getEditToken(greetingId);
    await updateGreetingTheme(greetingId, token, themeKey);
    return { ok: true, data: undefined };
  } catch (err) {
    return errorResult("updateThemeAction", err, { greetingId });
  }
}

export async function updateMessageAction(greetingId: string, text: string): Promise<ActionResult> {
  try {
    const token = await getEditToken(greetingId);
    await updateGreetingMessage(greetingId, token, text);
    return { ok: true, data: undefined };
  } catch (err) {
    return errorResult("updateMessageAction", err, { greetingId });
  }
}

/**
 * PUBLIC EXPENSIVE: each call allocates a signed Storage upload URL. Keyed
 * by greetingId (a sender legitimately uploads at most a handful of items —
 * 3 photos + 1 video + 1 voice message — so a limit well above that only
 * throttles a script hammering one draft, never real use).
 */
export async function requestUploadAction(
  greetingId: string,
  input: { type: Extract<SupportedContentType, "photo" | "video" | "audio">; slot: number; mimeType: string; sizeBytes: number },
): Promise<ActionResult<{ contentId: string; uploadUrl: string }>> {
  try {
    await enforceRateLimit({ key: `media-upload:${greetingId}`, limit: 30, windowSeconds: 60 });
    const token = await getEditToken(greetingId);
    const result = await requestMediaUpload(greetingId, token, input);
    return { ok: true, data: { contentId: result.contentId, uploadUrl: result.uploadUrl } };
  } catch (err) {
    return errorResult("requestUploadAction", err, { greetingId });
  }
}

export async function finalizeUploadAction(greetingId: string, contentId: string): Promise<ActionResult<{ signedUrl: string }>> {
  try {
    const token = await getEditToken(greetingId);
    const result = await finalizeMediaUpload(greetingId, token, contentId);
    return { ok: true, data: result };
  } catch (err) {
    return errorResult("finalizeUploadAction", err, { greetingId, contentId });
  }
}

export async function deleteContentAction(greetingId: string, contentId: string): Promise<ActionResult> {
  try {
    const token = await getEditToken(greetingId);
    await deleteContent(greetingId, token, contentId);
    return { ok: true, data: undefined };
  } catch (err) {
    return errorResult("deleteContentAction", err, { greetingId, contentId });
  }
}

export async function viewPreviewAction(greetingId: string): Promise<ActionResult> {
  try {
    const token = await getEditToken(greetingId);
    await markPreviewViewed(greetingId, token);
    return { ok: true, data: undefined };
  } catch (err) {
    return errorResult("viewPreviewAction", err, { greetingId });
  }
}

export { ContentActionError };

/** Server-side re-fetch the wizard uses after mutations that change content shape. */
export async function getDraftStateAction(greetingId: string): Promise<ActionResult<Awaited<ReturnType<typeof loadDraftForEdit>>>> {
  try {
    const token = await getEditToken(greetingId);
    const data = await loadDraftForEdit(greetingId, token);
    return { ok: true, data };
  } catch (err) {
    return errorResult("getDraftStateAction", err, { greetingId });
  }
}

"use server";

import { cookies } from "next/headers";
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

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorResult(err: unknown): ActionResult<never> {
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

/**
 * Start flow entry point. On success, sets the HttpOnly edit-token cookie and
 * redirects back to the same public QR URL — the dispatcher (/g/[token])
 * re-resolves state and now sees the DRAFT it just created via the cookie it
 * just set, no id ever appears in the URL.
 */
export async function startGreetingAction(publicToken: string): Promise<ActionResult<never> | never> {
  let greetingId: string;
  try {
    const result = await startGreeting(publicToken);
    greetingId = result.greetingId;
    const cookieStore = await cookies();
    cookieStore.set(editTokenCookieName(greetingId), result.editToken, EDIT_TOKEN_COOKIE_OPTIONS);
  } catch (err) {
    if (err instanceof StartGreetingError) return errorResult(err);
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
    return errorResult(err);
  }
}

export async function updateMessageAction(greetingId: string, text: string): Promise<ActionResult> {
  try {
    const token = await getEditToken(greetingId);
    await updateGreetingMessage(greetingId, token, text);
    return { ok: true, data: undefined };
  } catch (err) {
    return errorResult(err);
  }
}

export async function requestUploadAction(
  greetingId: string,
  input: { type: Extract<SupportedContentType, "photo" | "video" | "audio">; slot: number; mimeType: string; sizeBytes: number },
): Promise<ActionResult<{ contentId: string; uploadUrl: string }>> {
  try {
    const token = await getEditToken(greetingId);
    const result = await requestMediaUpload(greetingId, token, input);
    return { ok: true, data: { contentId: result.contentId, uploadUrl: result.uploadUrl } };
  } catch (err) {
    return errorResult(err);
  }
}

export async function finalizeUploadAction(greetingId: string, contentId: string): Promise<ActionResult<{ signedUrl: string }>> {
  try {
    const token = await getEditToken(greetingId);
    const result = await finalizeMediaUpload(greetingId, token, contentId);
    return { ok: true, data: result };
  } catch (err) {
    return errorResult(err);
  }
}

export async function deleteContentAction(greetingId: string, contentId: string): Promise<ActionResult> {
  try {
    const token = await getEditToken(greetingId);
    await deleteContent(greetingId, token, contentId);
    return { ok: true, data: undefined };
  } catch (err) {
    return errorResult(err);
  }
}

export async function viewPreviewAction(greetingId: string): Promise<ActionResult> {
  try {
    const token = await getEditToken(greetingId);
    await markPreviewViewed(greetingId, token);
    return { ok: true, data: undefined };
  } catch (err) {
    return errorResult(err);
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
    return errorResult(err);
  }
}

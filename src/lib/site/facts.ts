import "server-only";
import { MESSAGE_MAX_LENGTH } from "@/lib/validation/greeting-text";
import { MEDIA_SLOT_LIMITS, VOICE_MAX_DURATION_SECONDS, allowedMimeTypesFor, sizeLimitFor } from "@/lib/validation/content-types";
import { SELECTABLE_THEMES } from "@/lib/themes/registry";
import { EDIT_TOKEN_COOKIE_OPTIONS } from "@/lib/security/edit-token";
import type { FactToken } from "./inline";

/**
 * Product facts quoted on the public pages, read from the same constants the
 * product enforces, so the copy cannot drift from the behaviour.
 */
const FORMAT_LABELS: Record<string, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "video/mp4": "MP4",
  "video/quicktime": "MOV",
  "video/webm": "WebM",
  "audio/mpeg": "MP3",
  "audio/mp4": "M4A",
  "audio/webm": "WebM",
  "audio/ogg": "OGG",
};

const mb = (bytes: number) => String(Math.round(bytes / (1024 * 1024)));
const formats = (type: "photo" | "video" | "audio") => allowedMimeTypesFor(type).map((m) => FORMAT_LABELS[m] ?? m).join(", ");

export function getProductFacts(): Record<FactToken, string> {
  return {
    messageMaxLength: String(MESSAGE_MAX_LENGTH),
    photoCount: String(MEDIA_SLOT_LIMITS.photo),
    photoMaxMb: mb(sizeLimitFor("photo")),
    photoFormats: formats("photo"),
    videoCount: String(MEDIA_SLOT_LIMITS.video),
    videoMaxMb: mb(sizeLimitFor("video")),
    videoFormats: formats("video"),
    voiceCount: String(MEDIA_SLOT_LIMITS.audio),
    voiceMaxSeconds: String(VOICE_MAX_DURATION_SECONDS),
    voiceMaxMb: mb(sizeLimitFor("audio")),
    voiceFormats: formats("audio"),
    themeCount: String(SELECTABLE_THEMES.length),
    editAccessDays: String(Math.round(EDIT_TOKEN_COOKIE_OPTIONS.maxAge / 86_400)),
  };
}

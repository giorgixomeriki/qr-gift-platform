import { allowedMimeTypesFor } from "@/lib/validation/content-types";

/**
 * Phones label the same voice file in different ways, so a picked file's
 * `type` is normalised to the one name the upload allowlist uses before it is
 * checked. Names only: the server still reads the file's real first bytes
 * and refuses anything that doesn't match (lib/storage/verify-upload.ts).
 *
 * - iPhone / Mac: Voice Memos and other .m4a files arrive as `audio/x-m4a`
 *   (or `audio/m4a`), AAC in an MP4 container: `audio/mp4`.
 * - Some Android browsers: `audio/mp3`, `audio/x-wav`, `audio/wave`,
 *   `audio/x-aac`, `audio/opus`.
 * - Files from some file managers arrive with no type at all: named from the
 *   extension.
 */
const ALIASES: Record<string, string> = {
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-mp4": "audio/mp4",
  "audio/mp3": "audio/mpeg",
  "audio/x-mp3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/x-aac": "audio/aac",
  "audio/aacp": "audio/aac",
  "audio/opus": "audio/ogg",
  "audio/x-opus+ogg": "audio/ogg",
};

const BY_EXTENSION: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
};

/** What the voice file picker offers: the allowlist, its aliases, and the extensions (iOS greys out a file whose label it doesn't list). */
export const AUDIO_ACCEPT = [...allowedMimeTypesFor("audio"), ...Object.keys(ALIASES), ...Object.keys(BY_EXTENSION).map((e) => `.${e}`)].join(",");

/** The allowlist name for this file, or null when it isn't a supported voice format. */
export function canonicalAudioType(file: Blob & { name?: string }): string | null {
  const declared = file.type.split(";")[0]!.trim().toLowerCase();
  const fromName = file.name?.split(".").pop()?.toLowerCase();
  const candidate = ALIASES[declared] ?? (declared && declared !== "application/octet-stream" ? declared : fromName ? BY_EXTENSION[fromName] : undefined);
  return candidate && allowedMimeTypesFor("audio").includes(candidate) ? candidate : null;
}

/** The same bytes under the allowlist name (no copy of the data), or null when unsupported. */
export function normaliseAudioFile(file: Blob & { name?: string }): Blob | null {
  const type = canonicalAudioType(file);
  if (!type) return null;
  return type === file.type ? file : new Blob([file], { type });
}

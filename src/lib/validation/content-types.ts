import { z } from "zod";

/**
 * The authoritative set of content types the application currently knows how to
 * accept and render. This is intentionally NOT generated from the `content_types`
 * DB table: the table can hold rows for types seeded ahead of a rollout (e.g. for
 * a partner beta) without the running app being able to accept them yet. This
 * union is what actually gates upload/activation requests.
 *
 * Adding a new type (e.g. "music", "gif", "sticker") is: add the literal here,
 * add its metadata shape below, seed a `content_types` row, ship a renderer.
 * No column/enum migration required.
 */
export const SUPPORTED_CONTENT_TYPES = ["text", "photo", "video", "audio"] as const;
export type SupportedContentType = (typeof SUPPORTED_CONTENT_TYPES)[number];

export const contentTypeSchema = z.enum(SUPPORTED_CONTENT_TYPES);

const MIME_ALLOWLIST: Record<Exclude<SupportedContentType, "text">, readonly string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
  audio: ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg"],
};

const SIZE_LIMIT_BYTES: Record<Exclude<SupportedContentType, "text">, number> = {
  photo: 15 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
};

export function allowedMimeTypesFor(type: Exclude<SupportedContentType, "text">): readonly string[] {
  return MIME_ALLOWLIST[type];
}

export function sizeLimitFor(type: Exclude<SupportedContentType, "text">): number {
  return SIZE_LIMIT_BYTES[type];
}

export const textContentSchema = z.object({
  type: z.literal("text"),
  slot: z.number().int().min(0),
  value: z.string().trim().min(1).max(2000),
});

export const mediaContentUploadSchema = z.object({
  type: z.enum(["photo", "video", "audio"]),
  slot: z.number().int().min(0),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export function validateMediaUpload(input: z.infer<typeof mediaContentUploadSchema>) {
  const parsed = mediaContentUploadSchema.parse(input);
  const allowed = allowedMimeTypesFor(parsed.type);
  if (!allowed.includes(parsed.mimeType)) {
    throw new Error(`Unsupported MIME type "${parsed.mimeType}" for content type "${parsed.type}"`);
  }
  const limit = sizeLimitFor(parsed.type);
  if (parsed.sizeBytes > limit) {
    throw new Error(`File too large for "${parsed.type}": ${parsed.sizeBytes} > ${limit} bytes`);
  }
  return parsed;
}

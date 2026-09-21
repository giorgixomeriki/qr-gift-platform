import "server-only";
import { env } from "@/lib/env";

/**
 * Real server-side content verification (Phase 2 §6/§7 — "never trust
 * extension alone"). The declared mimeType a client sends when requesting an
 * upload slot is only ever used to pick a storage extension and an
 * allowlist bucket — it is NOT trusted as proof of what was actually
 * uploaded. After the client's direct-to-Storage PUT completes, this reads
 * the first bytes of the real object (via an authenticated Range request,
 * not a full download) and checks them against known magic-byte signatures
 * for the declared content category. A mismatch fails the upload closed —
 * the object is deleted, never marked READY.
 */

async function readObjectHeaderBytes(storageKey: string, length = 32): Promise<Uint8Array> {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${env.SUPABASE_STORAGE_BUCKET}/${storageKey}`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Range: `bytes=0-${length - 1}`,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to read uploaded object (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

function bytesStartWith(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return bytesStartWith(
    bytes,
    offset,
    [...text].map((c) => c.charCodeAt(0)),
  );
}

/** Signature families, one function per allowed MIME type this app accepts. */
const SNIFFERS: Record<string, (b: Uint8Array) => boolean> = {
  "image/jpeg": (b) => bytesStartWith(b, 0, [0xff, 0xd8, 0xff]),
  "image/png": (b) => bytesStartWith(b, 0, [0x89, 0x50, 0x4e, 0x47]),
  "image/webp": (b) => asciiAt(b, 0, "RIFF") && asciiAt(b, 8, "WEBP"),
  "video/mp4": (b) => asciiAt(b, 4, "ftyp"),
  "video/quicktime": (b) => asciiAt(b, 4, "ftyp") || asciiAt(b, 4, "moov") || asciiAt(b, 4, "free"),
  "video/webm": (b) => bytesStartWith(b, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  "audio/mpeg": (b) => asciiAt(b, 0, "ID3") || bytesStartWith(b, 0, [0xff, 0xfb]) || bytesStartWith(b, 0, [0xff, 0xf3]) || bytesStartWith(b, 0, [0xff, 0xf2]),
  "audio/mp4": (b) => asciiAt(b, 4, "ftyp"),
  "audio/webm": (b) => bytesStartWith(b, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  "audio/ogg": (b) => asciiAt(b, 0, "OggS"),
};

export class ContentVerificationError extends Error {}

/**
 * Throws ContentVerificationError if the uploaded object's real bytes don't
 * match the declared MIME type's known signature. Callers must delete the
 * storage object on failure — this function only inspects, never mutates.
 */
export async function verifyUploadedContentMatchesMime(storageKey: string, declaredMimeType: string): Promise<void> {
  const sniff = SNIFFERS[declaredMimeType];
  if (!sniff) throw new ContentVerificationError(`No content signature known for "${declaredMimeType}"`);

  const header = await readObjectHeaderBytes(storageKey);
  if (!sniff(header)) {
    throw new ContentVerificationError(`Uploaded file's content does not match declared type "${declaredMimeType}"`);
  }
}

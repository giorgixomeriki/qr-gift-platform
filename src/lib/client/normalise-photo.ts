"use client";

/**
 * Photos are normalised in the browser before upload: EXIF-rotated,
 * downscaled to at most 2048px on the long edge and re-encoded as JPEG. A
 * 12 MP phone photo becomes a few hundred KB — seconds instead of minutes on
 * mobile data — and formats the browser can decode but Storage's allowlist
 * doesn't accept (e.g. HEIC on iOS Safari) stop being a user-facing error.
 * Returns the original file untouched when the browser can't decode it, so
 * the normal type/size validation still applies.
 */
const MAX_EDGE = 2048;

export async function normalisePhoto(file: File): Promise<Blob> {
  if (typeof createImageBitmap === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small and already JPEG: keep the original bytes.
    if (scale === 1 && file.type === "image/jpeg") {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}

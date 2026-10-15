import { createHash } from "node:crypto";

/**
 * A stable UUID-v4-shaped key derived from our own record id, for BOG's
 * Idempotency-Key header (which must be a UUID v4). Deterministic, so every
 * retry of the same logical request (one refund of one charge) reuses the
 * same key and BOG returns the original result instead of acting twice.
 */
export function idempotencyKeyFor(seed: string): string {
  const h = createHash("sha256").update(`qrstarr:${seed}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x40; // version 4
  h[8] = (h[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

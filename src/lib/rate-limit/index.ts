import "server-only";
import { checkRateLimit } from "./store";

export { checkRateLimit } from "./store";
export { getClientIp } from "./client-ip";

/**
 * Thrown by `enforceRateLimit` — callers in Server Actions catch this the
 * same way they catch every other domain error (existing `errorResult()`
 * pattern: `err instanceof Error ? err.message : ...`), so the friendly
 * message here is deliberately generic and never reveals which specific
 * limit was hit or why (no account-enumeration signal, no internal detail).
 */
export class RateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Too many requests — please try again in ${retryAfterSeconds}s.`);
    this.name = "RateLimitedError";
  }
}

/** Throws RateLimitedError if the limit is exceeded; otherwise resolves silently. */
export async function enforceRateLimit(params: { key: string; limit: number; windowSeconds: number }): Promise<void> {
  const result = await checkRateLimit(params);
  if (!result.allowed) {
    throw new RateLimitedError(result.retryAfterSeconds ?? params.windowSeconds);
  }
}

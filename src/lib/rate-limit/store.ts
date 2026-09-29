import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimitHits } from "@/db/schema";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

/**
 * Fixed-window counter backed by Postgres (see
 * migrations/0009_rate_limiting.sql for why this — not an in-memory Map —
 * is the correct store for a multi-instance deployment). The window is the
 * caller-given size in seconds, floor-aligned to `windowSeconds` so
 * concurrent callers in the same window share one row (and one atomic
 * increment) rather than each creating their own.
 *
 * Fails OPEN: if the DB round-trip itself throws (a real outage, a
 * migration mid-flight, etc.), this returns `{ allowed: true }` rather than
 * blocking every request in the app. A limiter outage must never become an
 * availability outage — the routes that matter most for real abuse
 * (sign-in, password reset) are protected independently by Supabase Auth's
 * own `[auth.rate_limit]` config regardless of this store's health.
 *
 * Requires migrations/0010_rate_limit_select_policy.sql: `.returning()`
 * makes Postgres re-check the row against a SELECT policy even on INSERT,
 * and with none defined this throws "violates row-level security policy"
 * on every call — silently swallowed by the fail-open catch below until a
 * real verify script (scripts/verify-rate-limiting.ts) caught it.
 */
export async function checkRateLimit(params: { key: string; limit: number; windowSeconds: number }): Promise<RateLimitResult> {
  const { key, limit, windowSeconds } = params;
  const windowMillis = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMillis) * windowMillis);

  try {
    const [row] = await db
      .insert(rateLimitHits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitHits.key, rateLimitHits.windowStart],
        set: { count: sql`${rateLimitHits.count} + 1` },
      })
      .returning({ count: rateLimitHits.count });

    // ~1% of calls also sweep rows from long-expired windows — no cron job
    // needed at pilot write volume; see the migration's own doc comment.
    if (Math.random() < 0.01) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      void db.delete(rateLimitHits).where(sql`${rateLimitHits.windowStart} < ${cutoff}`).catch(() => {});
    }

    const count = row?.count ?? 1;
    if (count > limit) {
      const windowEndsAt = windowStart.getTime() + windowMillis;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowEndsAt - Date.now()) / 1000)) };
    }
    return { allowed: true };
  } catch (err) {
    console.error(`[rate-limit] store check failed for key "${key}" — failing open`, err instanceof Error ? err.message : err);
    return { allowed: true };
  }
}

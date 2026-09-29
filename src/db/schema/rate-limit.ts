import { pgTable, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";

/**
 * Distributed fixed-window rate-limit counter — see
 * migrations/0009_rate_limiting.sql for the full rationale (Postgres-backed
 * so it works correctly across multiple serverless instances, unlike an
 * in-memory Map). `key` is always caller-constructed from server-derived
 * identifiers (a QR token, a greeting id, a verified user id) — never a raw
 * client-supplied string — see src/lib/rate-limit/store.ts.
 */
export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] })],
).enableRLS();

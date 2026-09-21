import { sql } from "drizzle-orm";
import { pgTable, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Lookup table (not a Postgres enum) so new greeting content types — music, gif,
 * sticker, external media, group contributions, etc. — can be added with a plain
 * INSERT instead of a schema migration. `greetingContent.type` references this
 * table's `key`.
 *
 * This table alone is NOT the authority on what the app can currently render or
 * accept: shared/validation/content-types.ts holds a stricter Zod union of the
 * types the app actually implements. A row can exist here (e.g. seeded ahead of
 * a rollout) without the UI supporting it yet.
 */
export const contentTypes = pgTable("content_types", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  active: boolean("active").notNull().default(true),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}).enableRLS();

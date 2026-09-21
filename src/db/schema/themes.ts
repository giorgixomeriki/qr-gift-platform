import { sql } from "drizzle-orm";
import { pgTable, uuid, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Theme engine config store. Themes control typography/animation/reveal style etc.
 * via `config`; recipient rendering logic stays generic and reads this config
 * rather than branching per theme. See architecture plan section 6.
 */
export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}).enableRLS();

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { partners } from "./partners";

/** e.g. PHOTO_GREETING, VIDEO_GREETING, PREMIUM_GREETING, GROUP_GREETING */
export const products = pgTable("products", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}).enableRLS();

/**
 * Monetary values stored as integer minor units (e.g. tetri/cents), never floats.
 * partnerId nullable = platform default price; a row scoped to a partner overrides it.
 */
export const prices = pgTable("prices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "cascade" }),
  currency: text("currency").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  active: boolean("active").notNull().default(true),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().default(sql`now()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}).enableRLS();

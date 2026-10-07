import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { partnerRoleEnum, partnerStatusEnum } from "./enums";

export const partners = pgTable("partners", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  defaultLocale: text("default_locale").notNull().default("ka"),
  country: text("country").notNull().default("GE"),
  currency: text("currency").notNull().default("GEL"),
  commissionRateBps: integer("commission_rate_bps").notNull().default(0),
  branding: jsonb("branding").notNull().default({}),
  status: partnerStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  check("partners_commission_rate_bps_range", sql`${table.commissionRateBps} >= 0 and ${table.commissionRateBps} <= 10000`),
]).enableRLS();

/**
 * User <-> Partner many-to-many. A user may belong to multiple partners with a
 * different role in each. Authorization always operates against a single
 * "active" membership selected per-request — see lib/auth/partner-context.ts.
 */
export const partnerMembers = pgTable(
  "partner_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: partnerRoleEnum("role").notNull().default("STAFF"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [unique("partner_members_partner_user_unique").on(table.partnerId, table.userId)],
).enableRLS();

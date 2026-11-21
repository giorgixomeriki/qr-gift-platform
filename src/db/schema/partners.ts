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
import {
  partnerInvitationChannelEnum,
  partnerInvitationPurposeEnum,
  partnerInvitationStatusEnum,
  partnerRoleEnum,
  partnerStatusEnum,
} from "./enums";

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
  // Login contact (migrations/0023). Lowercase email / +9955XXXXXXXX, each
  // unique across partners. Empty on partners created before 0023.
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
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

/**
 * How a partner's single login gets linked (migrations/0023). Admin-only
 * under RLS; claimed only through app_accept_partner_invitation(). See
 * lib/partners/login-access.ts.
 */
export const partnerInvitations = pgTable("partner_invitations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partners.id, { onDelete: "cascade" }),
  channel: partnerInvitationChannelEnum("channel").notNull(),
  purpose: partnerInvitationPurposeEnum("purpose").notNull().default("ACTIVATION"),
  contact: text("contact").notNull(),
  tokenHash: text("token_hash").unique(),
  targetUserId: uuid("target_user_id"),
  status: partnerInvitationStatusEnum("status").notNull().default("PENDING"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  acceptedUserId: uuid("accepted_user_id"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}).enableRLS();

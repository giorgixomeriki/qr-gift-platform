import { sql } from "drizzle-orm";
import { pgTable, uuid, text, boolean, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";
import { partners } from "./partners";

/**
 * A physical shop (one branch of a partner) where customers can pick up a
 * QR STARR card. Admin-only table (migrations/0023_partner_locations.sql);
 * the public home page never reads it directly — it calls the SECURITY
 * DEFINER app_public_partner_locations(), which returns only verified,
 * public, non-mock rows of ACTIVE partners and derives availability from
 * qr_codes. The constraints, the verification-reset trigger and the RLS
 * policies live in that migration.
 */
export const partnerLocations = pgTable(
  "partner_locations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    branchName: text("branch_name"),
    category: text("category").notNull().default("GIFTS"),
    addressKa: text("address_ka").notNull(),
    addressEn: text("address_en"),
    cityKa: text("city_ka").notNull(),
    cityEn: text("city_en"),
    districtKa: text("district_ka"),
    districtEn: text("district_en"),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    phone: text("phone"),
    hoursKa: text("hours_ka"),
    hoursEn: text("hours_en"),
    stocksCards: boolean("stocks_cards").notNull().default(true),
    isPublic: boolean("is_public").notNull().default(false),
    isMock: boolean("is_mock").notNull().default(false),
    coordinatesVerifiedAt: timestamp("coordinates_verified_at", { withTimezone: true }),
    coordinatesVerifiedBy: uuid("coordinates_verified_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("partner_locations_partner_id_idx").on(table.partnerId)],
).enableRLS();

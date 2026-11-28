import "server-only";
import { sql } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { logServerError } from "@/lib/log";
import { partnerMapMocksEnabled } from "./flag";
import { LOCATION_CATEGORIES, type LocationAvailability, type LocationCategory, type PublicLocation } from "./shared";

type Row = {
  id: string;
  partner_name: string;
  branch_name: string | null;
  category: string;
  address_ka: string;
  address_en: string | null;
  city_ka: string;
  city_en: string | null;
  district_ka: string | null;
  district_en: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  hours_ka: string | null;
  hours_en: string | null;
  availability: string;
  is_mock: boolean;
};

const AVAILABILITY = new Set<LocationAvailability>(["AVAILABLE", "OUT", "UNKNOWN"]);

/** Pure mapping, exported for verify:partner-locations. English falls back to Georgian, never the reverse. */
export function toPublicLocation(row: Row, locale: string): PublicLocation {
  const en = locale === "en";
  const pick = (ka: string | null, enValue: string | null) => (en ? (enValue ?? ka) : ka);
  return {
    id: row.id,
    partnerName: row.partner_name,
    branchName: row.branch_name,
    category: (LOCATION_CATEGORIES as readonly string[]).includes(row.category) ? (row.category as LocationCategory) : "OTHER",
    address: pick(row.address_ka, row.address_en)!,
    city: pick(row.city_ka, row.city_en)!,
    district: pick(row.district_ka, row.district_en),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    phone: row.phone,
    hours: pick(row.hours_ka, row.hours_en),
    availability: AVAILABILITY.has(row.availability as LocationAvailability) ? (row.availability as LocationAvailability) : "UNKNOWN",
    isMock: row.is_mock,
  };
}

/** Cities with the most shops first (Tbilisi before Batumi), then the SQL order within a city. */
export function sortByCityWeight(list: PublicLocation[]): PublicLocation[] {
  const count = new Map<string, number>();
  for (const l of list) count.set(l.city, (count.get(l.city) ?? 0) + 1);
  return list
    .map((l, i) => ({ l, i }))
    .sort((a, b) => count.get(b.l.city)! - count.get(a.l.city)! || a.i - b.i)
    .map(({ l }) => l);
}

/**
 * The home page's partner locations. The ONLY public read path: a SECURITY
 * DEFINER function that applies every visibility rule in SQL (public +
 * verified + ACTIVE partner + not a mock) — see migrations/0028. A database
 * error hides the section rather than breaking the home page.
 */
export async function listPublicPartnerLocations(locale: string): Promise<PublicLocation[]> {
  try {
    const includeMock = partnerMapMocksEnabled();
    const rows = await withPublicContext((tx) =>
      tx.execute<Row>(sql`select * from app_public_partner_locations(${includeMock})`),
    );
    return sortByCityWeight(Array.from(rows).map((row) => toPublicLocation(row, locale)));
  } catch (err) {
    logServerError("listPublicPartnerLocations", err);
    return [];
  }
}

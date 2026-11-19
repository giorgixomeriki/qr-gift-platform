/**
 * Client-safe vocabulary for partner locations (no server imports).
 * The category list mirrors partner_locations_category_check
 * (migrations/0028_partner_locations.sql) — keep the two in sync.
 */
export const LOCATION_CATEGORIES = ["FLOWERS", "GIFTS", "CONFECTIONERY", "BOOKS", "JEWELRY", "CAFE", "OTHER"] as const;
export type LocationCategory = (typeof LOCATION_CATEGORIES)[number];

/** Derived in SQL from the admin's stock switch + distributed, unsold cards. Never set by hand. */
export type LocationAvailability = "AVAILABLE" | "OUT" | "UNKNOWN";

/** Exactly what the public home page receives — display fields only. */
export type PublicLocation = {
  id: string;
  partnerName: string;
  branchName: string | null;
  category: LocationCategory;
  address: string;
  city: string;
  district: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  hours: string | null;
  availability: LocationAvailability;
  isMock: boolean;
};

/** Georgia's mainland, generously: a pin outside it is almost certainly a typo (lat/lng swapped). */
export const GEORGIA_BOUNDS = { minLat: 41.0, maxLat: 43.7, minLng: 39.9, maxLng: 46.8 } as const;

export function isInGeorgia(lat: number, lng: number): boolean {
  return lat >= GEORGIA_BOUNDS.minLat && lat <= GEORGIA_BOUNDS.maxLat && lng >= GEORGIA_BOUNDS.minLng && lng <= GEORGIA_BOUNDS.maxLng;
}

/**
 * Accepts what an admin pastes from Google Maps ("41.7151, 44.8271") or the
 * two numbers separately. Returns null for anything that is not two finite
 * numbers in range — never guesses.
 */
export function parseCoordinates(input: string): { latitude: number; longitude: number } | null {
  const m = input.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** Google Maps directions to a pin (Maps URLs: no key, opens the app on phones). */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Google Maps at a pin — what the admin uses to cross-check before verifying. */
export function mapsSearchUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Great-circle distance in km (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Lower-case, accent- and punctuation-insensitive text for search (Georgian has no case; Latin does). */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

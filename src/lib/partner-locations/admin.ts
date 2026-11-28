import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { partnerLocations, partners } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import type { LocationInput } from "@/lib/validation/partner-locations";
import { isInGeorgia, type LocationAvailability } from "./shared";

/**
 * Admin management of partner locations. Every mutation re-checks
 * app_is_admin() in its own transaction (on top of requireAdmin and the RLS
 * policies in migrations/0028), is refused if the row changed since the admin
 * loaded it, and writes one audit row in the same transaction.
 *
 * Visibility rules live in the database, not here: inserting always starts
 * hidden + unverified, and moving the shop (address/pin) voids verification
 * and hides it again (trigger partner_locations_guard).
 */

export class LocationServiceError extends Error {}
export class LocationConflictError extends LocationServiceError {}

async function assertAdminTx(tx: Tx) {
  const [row] = await tx.execute<{ is_admin: boolean }>(sql`select app_is_admin() as is_admin`);
  if (!row?.is_admin) throw new LocationServiceError("Only a platform admin may manage partner locations");
}

export type AdminLocation = typeof partnerLocations.$inferSelect & { availability: LocationAvailability };

/** One partner's locations, with the same availability the public page would show. */
export async function listPartnerLocations(tx: Tx, partnerId: string): Promise<AdminLocation[]> {
  const rows = await tx.select().from(partnerLocations).where(eq(partnerLocations.partnerId, partnerId)).orderBy(asc(partnerLocations.createdAt));
  const [stock] = await tx.execute<{ in_stock: boolean }>(sql`
    select exists (
      select 1 from qr_codes where partner_id = ${partnerId}::uuid and status = 'AVAILABLE' and distribution_status = 'DISTRIBUTED'
    ) as in_stock`);
  const inStock = stock?.in_stock ?? false;
  return rows.map((r) => ({ ...r, availability: !r.stocksCards ? "OUT" : inStock ? "AVAILABLE" : "UNKNOWN" }));
}

/** Partner-level inventory facts the admin needs to judge availability. Counts stay admin-only. */
export async function getPartnerCardStock(tx: Tx, partnerId: string): Promise<{ distributedUnsold: number }> {
  const [row] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from qr_codes
    where partner_id = ${partnerId}::uuid and status = 'AVAILABLE' and distribution_status = 'DISTRIBUTED'`);
  return { distributedUnsold: row?.n ?? 0 };
}

async function lockLocation(tx: Tx, partnerId: string, locationId: string, expectedUpdatedAt: string) {
  const [row] = await tx
    .select()
    .from(partnerLocations)
    .where(and(eq(partnerLocations.id, locationId), eq(partnerLocations.partnerId, partnerId)))
    .for("update")
    .limit(1);
  if (!row) throw new LocationServiceError("Location not found");
  if (row.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new LocationConflictError("This location was changed by someone else — reload and try again");
  }
  return row;
}

function snapshot(input: LocationInput) {
  return {
    branchName: input.branchName,
    category: input.category,
    addressKa: input.addressKa,
    addressEn: input.addressEn,
    cityKa: input.cityKa,
    cityEn: input.cityEn,
    districtKa: input.districtKa,
    districtEn: input.districtEn,
    latitude: input.latitude,
    longitude: input.longitude,
    phone: input.phone,
    hoursKa: input.hoursKa,
    hoursEn: input.hoursEn,
    stocksCards: input.stocksCards,
  };
}

export async function createLocation(tx: Tx, adminUserId: string, partnerId: string, input: LocationInput) {
  await assertAdminTx(tx);
  const [partner] = await tx.select({ id: partners.id }).from(partners).where(eq(partners.id, partnerId)).limit(1);
  if (!partner) throw new LocationServiceError("Partner not found");
  const [row] = await tx
    .insert(partnerLocations)
    .values({ partnerId, ...snapshot(input), isPublic: false, isMock: false })
    .returning({ id: partnerLocations.id });
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_LOCATION_CREATED",
    targetType: "partner_location",
    targetId: row!.id,
    metadata: { partnerId, outsideGeorgia: !isInGeorgia(input.latitude, input.longitude) },
  });
  return { id: row!.id };
}

export async function updateLocation(tx: Tx, adminUserId: string, partnerId: string, locationId: string, expectedUpdatedAt: string, input: LocationInput) {
  await assertAdminTx(tx);
  const before = await lockLocation(tx, partnerId, locationId, expectedUpdatedAt);
  const [after] = await tx
    .update(partnerLocations)
    .set(snapshot(input))
    .where(eq(partnerLocations.id, locationId))
    .returning({ coordinatesVerifiedAt: partnerLocations.coordinatesVerifiedAt, isPublic: partnerLocations.isPublic });
  const moved = before.coordinatesVerifiedAt !== null && after!.coordinatesVerifiedAt === null;
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_LOCATION_UPDATED",
    targetType: "partner_location",
    targetId: locationId,
    metadata: { partnerId, verificationCleared: moved, hidden: before.isPublic && !after!.isPublic },
  });
  return { verificationCleared: moved };
}

/** The admin confirms the pin and address match the real shop (after checking it on the map). */
export async function verifyLocation(tx: Tx, adminUserId: string, partnerId: string, locationId: string, expectedUpdatedAt: string) {
  await assertAdminTx(tx);
  await lockLocation(tx, partnerId, locationId, expectedUpdatedAt);
  await tx
    .update(partnerLocations)
    .set({ coordinatesVerifiedAt: sql`now()`, coordinatesVerifiedBy: adminUserId })
    .where(eq(partnerLocations.id, locationId));
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_LOCATION_VERIFIED",
    targetType: "partner_location",
    targetId: locationId,
    metadata: { partnerId },
  });
}

export async function setLocationVisibility(tx: Tx, adminUserId: string, partnerId: string, locationId: string, expectedUpdatedAt: string, isPublic: boolean) {
  await assertAdminTx(tx);
  const row = await lockLocation(tx, partnerId, locationId, expectedUpdatedAt);
  if (isPublic && row.coordinatesVerifiedAt === null) throw new LocationServiceError("Verify the address and map pin before publishing");
  if (isPublic && row.isMock) throw new LocationServiceError("A test location can never be published");
  await tx.update(partnerLocations).set({ isPublic }).where(eq(partnerLocations.id, locationId));
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: isPublic ? "PARTNER_LOCATION_PUBLISHED" : "PARTNER_LOCATION_HIDDEN",
    targetType: "partner_location",
    targetId: locationId,
    metadata: { partnerId },
  });
}

export async function setLocationStock(tx: Tx, adminUserId: string, partnerId: string, locationId: string, expectedUpdatedAt: string, stocksCards: boolean) {
  await assertAdminTx(tx);
  await lockLocation(tx, partnerId, locationId, expectedUpdatedAt);
  await tx.update(partnerLocations).set({ stocksCards }).where(eq(partnerLocations.id, locationId));
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: stocksCards ? "PARTNER_LOCATION_STOCKED" : "PARTNER_LOCATION_OUT_OF_STOCK",
    targetType: "partner_location",
    targetId: locationId,
    metadata: { partnerId },
  });
}

export async function deleteLocation(tx: Tx, adminUserId: string, partnerId: string, locationId: string, expectedUpdatedAt: string) {
  await assertAdminTx(tx);
  const row = await lockLocation(tx, partnerId, locationId, expectedUpdatedAt);
  if (row.isPublic) throw new LocationServiceError("Hide the location before deleting it");
  await tx.delete(partnerLocations).where(eq(partnerLocations.id, locationId));
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_LOCATION_DELETED",
    targetType: "partner_location",
    targetId: locationId,
    metadata: { partnerId, cityKa: row.cityKa },
  });
}

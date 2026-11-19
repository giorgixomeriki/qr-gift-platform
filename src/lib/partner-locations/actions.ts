"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { logServerError } from "@/lib/log";
import { expectedVersionSchema, locationInputSchema } from "@/lib/validation/partner-locations";
import { createLocation, deleteLocation, LocationServiceError, setLocationStock, setLocationVisibility, updateLocation, verifyLocation } from "./admin";

/**
 * Admin endpoints for partner locations. requireAdmin authorizes the session
 * (signed in + admin + MFA); admin.ts re-checks app_is_admin() inside the
 * transaction and the partner_locations RLS policies refuse anyone else at
 * the database (migrations/0028). The home page is revalidated on every
 * change so the public map never lags behind a hide.
 */

export type LocationActionResult = { ok: true } | { ok: false; error: string };

const uuid = z.uuid();

function fail(scope: string, err: unknown, context: Record<string, string | undefined>): LocationActionResult {
  logServerError(scope, err, context);
  if (err instanceof z.ZodError) return { ok: false, error: "Some fields are missing or invalid" };
  if (err instanceof LocationServiceError) return { ok: false, error: err.message };
  if (err instanceof Error && /Not signed in|Not an admin|Multi-factor/.test(err.message)) return { ok: false, error: err.message };
  return { ok: false, error: "Something went wrong — nothing was changed" };
}

function refresh(partnerId: string) {
  revalidatePath(`/admin/partners/${partnerId}`);
  revalidatePath("/");
}

export async function adminCreateLocationAction(partnerId: string, input: unknown): Promise<LocationActionResult> {
  try {
    const pid = uuid.parse(partnerId);
    const parsed = locationInputSchema.parse(input);
    await requireAdmin((tx, adminUserId) => createLocation(tx, adminUserId, pid, parsed));
    refresh(pid);
    return { ok: true };
  } catch (err) {
    return fail("adminCreateLocationAction", err, { partnerId });
  }
}

export async function adminUpdateLocationAction(partnerId: string, locationId: string, expectedUpdatedAt: string, input: unknown): Promise<LocationActionResult> {
  try {
    const pid = uuid.parse(partnerId);
    const lid = uuid.parse(locationId);
    const version = expectedVersionSchema.parse(expectedUpdatedAt);
    const parsed = locationInputSchema.parse(input);
    await requireAdmin((tx, adminUserId) => updateLocation(tx, adminUserId, pid, lid, version, parsed));
    refresh(pid);
    return { ok: true };
  } catch (err) {
    return fail("adminUpdateLocationAction", err, { partnerId, locationId });
  }
}

export async function adminVerifyLocationAction(partnerId: string, locationId: string, expectedUpdatedAt: string): Promise<LocationActionResult> {
  try {
    const pid = uuid.parse(partnerId);
    const lid = uuid.parse(locationId);
    const version = expectedVersionSchema.parse(expectedUpdatedAt);
    await requireAdmin((tx, adminUserId) => verifyLocation(tx, adminUserId, pid, lid, version));
    refresh(pid);
    return { ok: true };
  } catch (err) {
    return fail("adminVerifyLocationAction", err, { partnerId, locationId });
  }
}

export async function adminSetLocationVisibilityAction(partnerId: string, locationId: string, expectedUpdatedAt: string, isPublic: boolean): Promise<LocationActionResult> {
  try {
    const pid = uuid.parse(partnerId);
    const lid = uuid.parse(locationId);
    const version = expectedVersionSchema.parse(expectedUpdatedAt);
    const value = z.boolean().parse(isPublic);
    await requireAdmin((tx, adminUserId) => setLocationVisibility(tx, adminUserId, pid, lid, version, value));
    refresh(pid);
    return { ok: true };
  } catch (err) {
    return fail("adminSetLocationVisibilityAction", err, { partnerId, locationId });
  }
}

export async function adminSetLocationStockAction(partnerId: string, locationId: string, expectedUpdatedAt: string, stocksCards: boolean): Promise<LocationActionResult> {
  try {
    const pid = uuid.parse(partnerId);
    const lid = uuid.parse(locationId);
    const version = expectedVersionSchema.parse(expectedUpdatedAt);
    const value = z.boolean().parse(stocksCards);
    await requireAdmin((tx, adminUserId) => setLocationStock(tx, adminUserId, pid, lid, version, value));
    refresh(pid);
    return { ok: true };
  } catch (err) {
    return fail("adminSetLocationStockAction", err, { partnerId, locationId });
  }
}

export async function adminDeleteLocationAction(partnerId: string, locationId: string, expectedUpdatedAt: string): Promise<LocationActionResult> {
  try {
    const pid = uuid.parse(partnerId);
    const lid = uuid.parse(locationId);
    const version = expectedVersionSchema.parse(expectedUpdatedAt);
    await requireAdmin((tx, adminUserId) => deleteLocation(tx, adminUserId, pid, lid, version));
    refresh(pid);
    return { ok: true };
  } catch (err) {
    return fail("adminDeleteLocationAction", err, { partnerId, locationId });
  }
}

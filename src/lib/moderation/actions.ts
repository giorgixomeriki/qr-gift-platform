"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import {
  findGreetingForModeration,
  listStaleDrafts,
  listOpenReports,
  blockGreeting,
  unblockGreeting,
  type GreetingLookupResult,
} from "./service";
import { logServerError } from "@/lib/log";
import { DRAFT_RELEASE_MIN_IDLE_HOURS, DraftReleaseError, normalizeReleaseReason, releaseAbandonedDraft } from "@/lib/greetings/release";
import { deleteStorageObject } from "@/lib/storage/media";
import { enforceRateLimit } from "@/lib/rate-limit";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function errorResult(scope: string, err: unknown, context: Record<string, string | number | undefined> = {}): ActionResult<never> {
  logServerError(scope, err, context);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

export async function lookupGreetingAction(query: string): Promise<ActionResult<GreetingLookupResult | null>> {
  try {
    const result = await requireAdmin((tx) => findGreetingForModeration(tx, query));
    return { ok: true, data: result };
  } catch (err) {
    return errorResult("lookupGreetingAction", err);
  }
}

export async function listModerationOverviewAction(): Promise<
  ActionResult<{ staleDrafts: Awaited<ReturnType<typeof listStaleDrafts>>; openReports: Awaited<ReturnType<typeof listOpenReports>> }>
> {
  try {
    const data = await requireAdmin(async (tx) => ({
      staleDrafts: await listStaleDrafts(tx, DRAFT_RELEASE_MIN_IDLE_HOURS),
      openReports: await listOpenReports(tx),
    }));
    return { ok: true, data };
  } catch (err) {
    return errorResult("listModerationOverviewAction", err);
  }
}

export async function blockGreetingAction(greetingId: string, reason: string, resolveReportId?: string): Promise<ActionResult> {
  if (!reason.trim()) return { ok: false, error: "A reason is required to block a Greeting" };
  try {
    await requireAdmin((tx, adminUserId) => blockGreeting(tx, adminUserId, greetingId, reason.trim(), resolveReportId));
    revalidatePath("/admin/moderation");
    return { ok: true, data: undefined };
  } catch (err) {
    return errorResult("blockGreetingAction", err, { greetingId });
  }
}

export async function unblockGreetingAction(greetingId: string, reason: string): Promise<ActionResult> {
  if (!reason.trim()) return { ok: false, error: "A reason is required to unblock a Greeting" };
  try {
    await requireAdmin((tx, adminUserId) => unblockGreeting(tx, adminUserId, greetingId, reason.trim()));
    revalidatePath("/admin/moderation");
    return { ok: true, data: undefined };
  } catch (err) {
    return errorResult("unblockGreetingAction", err, { greetingId });
  }
}

/**
 * FA-01: returns an abandoned draft card to inventory (lib/greetings/release.ts).
 * Admin-only (MFA), reason-required, rate-limited, audited; refused for a
 * draft with a live order or one edited in the last 24 hours.
 */
export async function releaseDraftAction(qrCodeId: string, reason: string): Promise<ActionResult<{ removedContent: number }>> {
  try {
    normalizeReleaseReason(reason);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "A reason is required" };
  }
  try {
    const result = await requireAdmin(async (tx, adminUserId) => {
      await enforceRateLimit({ key: `draft-release:${adminUserId}`, limit: 30, windowSeconds: 60 });
      return releaseAbandonedDraft(tx, adminUserId, qrCodeId, reason);
    });
    // After commit: the abandoned sender's media is no longer referenced.
    for (const key of result.storageKeys) {
      await deleteStorageObject(key).catch((err) => console.warn("[media] released draft object not deleted; needs cleanup", { qrCodeId, key, err: String(err) }));
    }
    revalidatePath("/admin/moderation");
    return { ok: true, data: { removedContent: result.removedContent } };
  } catch (err) {
    if (err instanceof DraftReleaseError) return { ok: false, error: err.message };
    return errorResult("releaseDraftAction", err, { qrCodeId });
  }
}

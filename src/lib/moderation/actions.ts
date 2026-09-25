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
      staleDrafts: await listStaleDrafts(tx, 14),
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

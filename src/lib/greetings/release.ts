import "server-only";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { greetingContent, greetings, orders, qrCodes } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";

/**
 * FA-01: returning an abandoned draft card to inventory.
 *
 * A card becomes DRAFT the moment anyone taps Start, and until now nothing
 * could ever undo that. This is the admin-only, audited way back. It is
 * deliberately narrow, so a customer's real draft is never taken away:
 *
 *   - platform admin only (the caller runs inside requireAdmin: MFA, aal2);
 *   - the card and its greeting are both DRAFT;
 *   - no order other than FAILED / CANCELED exists for the card (nothing
 *     paid, nothing waiting at the bank, nothing refunded);
 *   - nobody has touched the draft for DRAFT_RELEASE_MIN_IDLE_HOURS;
 *   - a written reason, recorded in the audit log.
 *
 * The release erases the draft's content (it was the abandoned sender's),
 * clears the edit token hash so the old link stops working, and returns the
 * card to AVAILABLE. The database refuses the DRAFT -> AVAILABLE step for
 * anyone else and for a card with a live order (migrations/0024
 * enforce_qr_status_transition). The next sender who starts the card
 * re-claims the same greeting row with a fresh token (startGreeting).
 *
 * Media files in storage are returned to the caller, which removes them after
 * the transaction commits (best effort, like media replacement).
 */
export const DRAFT_RELEASE_MIN_IDLE_HOURS = 24;
const REASON_MIN = 5;
const REASON_MAX = 500;

export type DraftReleaseErrorCode =
  | "REASON_REQUIRED"
  | "NOT_FOUND"
  | "NOT_DRAFT"
  | "LIVE_ORDER"
  | "RECENTLY_ACTIVE"
  | "NOT_AUTHORIZED";

export class DraftReleaseError extends Error {
  constructor(readonly code: DraftReleaseErrorCode, message: string) {
    super(message);
    this.name = "DraftReleaseError";
  }
}

export type DraftReleaseResult = {
  qrCodeId: string;
  greetingId: string;
  removedContent: number;
  storageKeys: string[];
  idleHours: number;
};

export function normalizeReleaseReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < REASON_MIN) throw new DraftReleaseError("REASON_REQUIRED", `A reason of at least ${REASON_MIN} characters is required`);
  return trimmed.slice(0, REASON_MAX);
}

/** Must run inside requireAdmin's transaction (an admin context). */
export async function releaseAbandonedDraft(
  tx: Tx,
  adminUserId: string,
  qrCodeId: string,
  rawReason: string,
  now: Date = new Date(),
): Promise<DraftReleaseResult> {
  const reason = normalizeReleaseReason(rawReason);

  const [qr] = await tx
    .select({ id: qrCodes.id, status: qrCodes.status, partnerId: qrCodes.partnerId })
    .from(qrCodes)
    .where(eq(qrCodes.id, qrCodeId))
    .for("update")
    .limit(1);
  if (!qr) throw new DraftReleaseError("NOT_FOUND", "Card not found");

  const [greeting] = await tx
    .select({ id: greetings.id, status: greetings.status, updatedAt: greetings.updatedAt })
    .from(greetings)
    .where(eq(greetings.qrCodeId, qr.id))
    .for("update")
    .limit(1);
  if (!greeting) throw new DraftReleaseError("NOT_FOUND", "This card has no draft");
  if (qr.status !== "DRAFT" || greeting.status !== "DRAFT") {
    throw new DraftReleaseError("NOT_DRAFT", `Only a draft card can be released (card ${qr.status}, greeting ${greeting.status})`);
  }

  const [live] = await tx
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(eq(orders.qrCodeId, qr.id), notInArray(orders.status, ["FAILED", "CANCELED"])))
    .limit(1);
  if (live) throw new DraftReleaseError("LIVE_ORDER", `The card has a ${live.status} order; it cannot be released`);

  const content = await tx
    .select({ id: greetingContent.id, storageKey: greetingContent.storageKey, updatedAt: greetingContent.updatedAt })
    .from(greetingContent)
    .where(eq(greetingContent.greetingId, greeting.id));
  const lastActivity = Math.max(greeting.updatedAt.getTime(), ...content.map((c) => c.updatedAt.getTime()));
  const idleHours = Math.floor((now.getTime() - lastActivity) / 3_600_000);
  if (idleHours < DRAFT_RELEASE_MIN_IDLE_HOURS) {
    throw new DraftReleaseError("RECENTLY_ACTIVE", `The draft was edited ${idleHours} h ago; it can be released after ${DRAFT_RELEASE_MIN_IDLE_HOURS} h without activity`);
  }

  if (content.length > 0) {
    await tx.delete(greetingContent).where(inArray(greetingContent.id, content.map((c) => c.id)));
  }
  // RLS answers an unauthorized UPDATE with 0 rows, not an error.
  const reset = await tx
    .update(greetings)
    .set({ editTokenHash: null, updatedAt: sql`now()` })
    .where(and(eq(greetings.id, greeting.id), eq(greetings.status, "DRAFT")))
    .returning({ id: greetings.id });
  if (reset.length === 0) throw new DraftReleaseError("NOT_AUTHORIZED", "Not authorized to release this draft");

  await tx.execute(sql`select set_config('app.draft_release_qr_id', ${qr.id}, true)`);
  const released = await tx
    .update(qrCodes)
    .set({ status: "AVAILABLE" })
    .where(and(eq(qrCodes.id, qr.id), eq(qrCodes.status, "DRAFT")))
    .returning({ id: qrCodes.id });
  if (released.length === 0) throw new DraftReleaseError("NOT_AUTHORIZED", "Not authorized to release this card");

  const failedOrders = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.qrCodeId, qr.id));

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "QR_DRAFT_RELEASED",
    targetType: "qr_code",
    targetId: qr.id,
    metadata: {
      greetingId: greeting.id,
      partnerId: qr.partnerId,
      reason,
      idleHours,
      removedContent: content.length,
      closedOrders: failedOrders[0]?.n ?? 0,
    },
  });

  return {
    qrCodeId: qr.id,
    greetingId: greeting.id,
    removedContent: content.length,
    storageKeys: content.map((c) => c.storageKey).filter((k): k is string => !!k),
    idleHours,
  };
}

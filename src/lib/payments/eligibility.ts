import "server-only";
import { sql } from "drizzle-orm";
import { withPublicContext, type Tx } from "@/db/client";

/**
 * Why a greeting can't be bought right now — the reason codes returned by the
 * app_greeting_purchase_blocker() SQL function (migrations/0011), which is
 * the single definition of "purchasable" shared by this module and by RLS
 * (orders_insert_by_token). A greeting is purchasable only while:
 *   - the greeting and its QR are both still DRAFT (not blocked, not active)
 *   - the QR's partner is ACTIVE (not suspended)
 *   - it has a non-empty message (the one required part of a greeting)
 */
export type PurchaseBlocker = "GREETING_NOT_FOUND" | "GREETING_NOT_DRAFT" | "QR_NOT_DRAFT" | "PARTNER_SUSPENDED" | "MISSING_MESSAGE";

export class PurchaseNotAllowedError extends Error {
  constructor(readonly reason: PurchaseBlocker) {
    super(`Greeting is not purchasable: ${reason}`);
    this.name = "PurchaseNotAllowedError";
  }
}

/**
 * Evaluates purchasability inside `tx`. With `lock`, the greeting row stays
 * locked until `tx` ends, so a concurrent moderation block can't interleave
 * with a payment decision made in the same transaction.
 */
export async function getPurchaseBlocker(tx: Tx, greetingId: string, opts: { lock?: boolean } = {}): Promise<PurchaseBlocker | null> {
  const rows = await tx.execute<{ blocker: PurchaseBlocker | null }>(
    sql`select app_greeting_purchase_blocker(${greetingId}::uuid, ${opts.lock ?? false}) as blocker`,
  );
  return rows[0]?.blocker ?? null;
}

/** Throws PurchaseNotAllowedError unless the greeting can be bought right now. */
export async function assertGreetingPurchasable(greetingId: string): Promise<void> {
  const blocker = await withPublicContext((tx) => getPurchaseBlocker(tx, greetingId));
  if (blocker) throw new PurchaseNotAllowedError(blocker);
}

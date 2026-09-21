import { and, eq, isNull, or, sql } from "drizzle-orm";
import { prices } from "@/db/schema";
import type { Tx } from "@/db/client";

/**
 * Server-authoritative pricing resolution (Phase 0.5 §6). The client may
 * display a price but never dictates it — this is the only place a checkout
 * amount is decided, and its result is snapshotted into the order, never
 * re-derived from live prices afterward.
 */
export async function resolveActivePrice(tx: Tx, productId: string, partnerId: string) {
  // A partner-specific override (partner_id = this partner) wins over the
  // platform default (partner_id IS NULL) when both exist.
  const rows = await tx
    .select()
    .from(prices)
    .where(
      and(
        eq(prices.productId, productId),
        eq(prices.active, true),
        or(eq(prices.partnerId, partnerId), isNull(prices.partnerId)),
      ),
    )
    .orderBy(sql`${prices.partnerId} is null`) // false (partner-specific) sorts before true (platform default)
    .limit(1);

  const price = rows[0];
  if (!price) {
    throw new Error(`No active price found for product ${productId} (partner ${partnerId})`);
  }
  return price;
}

export function splitCommission(grossAmountMinor: number, commissionRateBps: number) {
  const partnerCommissionMinor = Math.floor((grossAmountMinor * commissionRateBps) / 10000);
  const platformShareMinor = grossAmountMinor - partnerCommissionMinor;
  return { partnerCommissionMinor, platformShareMinor };
}

/**
 * Reads via the SECURITY DEFINER app_partner_commission_rate_bps() function
 * (migrations/0004_checkout_helpers.sql) rather than selecting from
 * `partners` directly — that table isn't publicly readable, and an
 * unauthenticated checkout request has no partner/admin RLS context.
 */
export async function getPartnerCommissionRateBps(tx: Tx, partnerId: string): Promise<number> {
  const [row] = await tx.execute<{ app_partner_commission_rate_bps: number | null }>(
    sql`select app_partner_commission_rate_bps(${partnerId}::uuid)`,
  );
  if (!row || row.app_partner_commission_rate_bps === null) {
    throw new Error(`Partner ${partnerId} not found`);
  }
  return row.app_partner_commission_rate_bps;
}

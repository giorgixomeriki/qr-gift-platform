import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { auditLogs, partners, prices, products } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import { DEFAULT_PRODUCT_KEY } from "@/lib/greetings/constants";
import { splitCommission } from "./split";

/**
 * Super Admin pricing management: the platform-default activation price, a
 * per-partner price override, and each partner's commission rate. The ONLY
 * write path for pricing — checkout (service.ts startCheckout) only ever
 * reads, through resolveActivePrice + the partner's rate, and snapshots the
 * result into the order, so nothing here can reach an existing order.
 *
 * Every mutation:
 *   - re-checks app_is_admin() inside its own transaction (on top of the
 *     caller's requireAdmin, and the prices/partners RLS + trigger backstops
 *     from migrations/0001 and 0018);
 *   - locks the row it changes (partner, or product for the default price),
 *     so concurrent edits are serialized;
 *   - is optimistic: the caller passes the value it last saw, and a change
 *     made in between by someone else is refused (PricingConflictError)
 *     instead of being silently overwritten;
 *   - never edits a price row in place: the old row is deactivated and a new
 *     one inserted, so orders.price_id keeps pointing at what was charged;
 *   - writes one audit log row (actor, old value, new value; created_at is
 *     the timestamp) in the same transaction — no audit row without the
 *     change, no change without the audit row.
 */

export class PricingServiceError extends Error {}
/** Someone else changed this value since the caller loaded it. */
export class PricingConflictError extends PricingServiceError {}

export const PRICING_AUDIT_ACTIONS = [
  "PRICING_DEFAULT_PRICE_UPDATED",
  "PRICING_PARTNER_PRICE_SET",
  "PRICING_PARTNER_PRICE_CLEARED",
  "PRICING_PARTNER_COMMISSION_UPDATED",
] as const;
export type PricingAuditAction = (typeof PRICING_AUDIT_ACTIONS)[number];

async function assertAdminTx(tx: Tx) {
  const [row] = await tx.execute<{ is_admin: boolean }>(sql`select app_is_admin() as is_admin`);
  if (!row?.is_admin) throw new PricingServiceError("Only a platform admin may manage pricing");
}

async function getDefaultProduct(tx: Tx, { lock = false } = {}) {
  const query = tx.select({ id: products.id, key: products.key }).from(products).where(eq(products.key, DEFAULT_PRODUCT_KEY)).limit(1);
  const [product] = lock ? await query.for("update") : await query;
  if (!product) throw new PricingServiceError(`Product ${DEFAULT_PRODUCT_KEY} not found`);
  return product;
}

async function lockPartner(tx: Tx, partnerId: string) {
  const [partner] = await tx
    .select({ id: partners.id, currency: partners.currency, commissionRateBps: partners.commissionRateBps })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .for("update")
    .limit(1);
  if (!partner) throw new PricingServiceError("Partner not found");
  return partner;
}

async function activeDefaultPrice(tx: Tx, productId: string) {
  const [row] = await tx
    .select()
    .from(prices)
    .where(and(eq(prices.productId, productId), isNull(prices.partnerId), eq(prices.active, true)))
    .limit(1);
  return row ?? null;
}

async function activePartnerPrice(tx: Tx, productId: string, partnerId: string) {
  const [row] = await tx
    .select()
    .from(prices)
    .where(and(eq(prices.productId, productId), eq(prices.partnerId, partnerId), eq(prices.active, true)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type PartnerPricing = {
  currency: string;
  defaultPriceMinor: number | null;
  overridePriceMinor: number | null;
  /** What a checkout for this partner would charge right now (override, else default). */
  effectivePriceMinor: number | null;
  source: "PARTNER" | "DEFAULT" | "NONE";
  commissionRateBps: number;
  partnerAmountMinor: number | null;
  platformAmountMinor: number | null;
};

export async function getDefaultPricing(tx: Tx): Promise<{ amountMinor: number | null; currency: string }> {
  await assertAdminTx(tx);
  const product = await getDefaultProduct(tx);
  const price = await activeDefaultPrice(tx, product.id);
  return { amountMinor: price?.amountMinor ?? null, currency: price?.currency ?? "GEL" };
}

export async function getPartnerPricing(tx: Tx, partnerId: string): Promise<PartnerPricing> {
  await assertAdminTx(tx);
  const [partner] = await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
  if (!partner) throw new PricingServiceError("Partner not found");
  const product = await getDefaultProduct(tx);
  const defaultPrice = await activeDefaultPrice(tx, product.id);
  const override = await activePartnerPrice(tx, product.id, partnerId);
  const effective = override ?? defaultPrice;
  const split = effective ? splitCommission(effective.amountMinor, partner.commissionRateBps) : null;
  return {
    currency: effective?.currency ?? partner.currency,
    defaultPriceMinor: defaultPrice?.amountMinor ?? null,
    overridePriceMinor: override?.amountMinor ?? null,
    effectivePriceMinor: effective?.amountMinor ?? null,
    source: override ? "PARTNER" : defaultPrice ? "DEFAULT" : "NONE",
    commissionRateBps: partner.commissionRateBps,
    partnerAmountMinor: split?.partnerCommissionMinor ?? null,
    platformAmountMinor: split?.platformShareMinor ?? null,
  };
}

/** Active overrides keyed by partner id — for the partners list. */
export async function listPartnerPriceOverrides(tx: Tx): Promise<Map<string, number>> {
  await assertAdminTx(tx);
  const product = await getDefaultProduct(tx);
  const rows = await tx
    .select({ partnerId: prices.partnerId, amountMinor: prices.amountMinor })
    .from(prices)
    .where(and(eq(prices.productId, product.id), eq(prices.active, true), sql`${prices.partnerId} is not null`));
  return new Map(rows.map((r) => [r.partnerId!, r.amountMinor]));
}

export type PricingAuditEntry = {
  id: string;
  action: PricingAuditAction;
  actorId: string | null;
  createdAt: Date;
  oldValue: number | null;
  newValue: number | null;
};

/** Pricing history for one partner (or, with no partner, the platform default) — newest first. */
export async function listPricingAuditLog(tx: Tx, partnerId: string | null, limit = 20): Promise<PricingAuditEntry[]> {
  await assertAdminTx(tx);
  const target = partnerId
    ? and(eq(auditLogs.targetType, "partner"), eq(auditLogs.targetId, partnerId))
    : eq(auditLogs.targetType, "product");
  const rows = await tx
    .select()
    .from(auditLogs)
    .where(and(target, inArray(auditLogs.action, [...PRICING_AUDIT_ACTIONS])))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const m = r.metadata as { oldValue?: number | null; newValue?: number | null };
    return { id: r.id, action: r.action as PricingAuditAction, actorId: r.actorId, createdAt: r.createdAt, oldValue: m.oldValue ?? null, newValue: m.newValue ?? null };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type PricingChangeResult = { changed: boolean };

/** The platform-default activation price — what every partner without an override charges. */
export async function setDefaultPrice(
  tx: Tx,
  adminUserId: string,
  input: { amountMinor: number; expectedAmountMinor: number | null },
): Promise<PricingChangeResult> {
  await assertAdminTx(tx);
  const product = await getDefaultProduct(tx, { lock: true });
  const current = await activeDefaultPrice(tx, product.id);
  const oldValue = current?.amountMinor ?? null;
  if (oldValue !== input.expectedAmountMinor) {
    throw new PricingConflictError("The default price was changed by someone else — reload and try again");
  }
  if (oldValue === input.amountMinor) return { changed: false };

  const currency = current?.currency ?? "GEL";
  if (current) await tx.update(prices).set({ active: false }).where(eq(prices.id, current.id));
  const [created] = await tx
    .insert(prices)
    .values({ productId: product.id, partnerId: null, currency, amountMinor: input.amountMinor })
    .returning({ id: prices.id });

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PRICING_DEFAULT_PRICE_UPDATED",
    targetType: "product",
    targetId: product.id,
    metadata: { productKey: product.key, currency, oldValue, newValue: input.amountMinor, oldPriceId: current?.id ?? null, newPriceId: created!.id },
  });
  return { changed: true };
}

/**
 * Sets (amountMinor) or clears (null — back to the platform default) one
 * partner's activation price. expectedAmountMinor is the override the caller
 * last saw, null meaning "no override".
 */
export async function setPartnerPrice(
  tx: Tx,
  adminUserId: string,
  partnerId: string,
  input: { amountMinor: number | null; expectedAmountMinor: number | null },
): Promise<PricingChangeResult> {
  await assertAdminTx(tx);
  const partner = await lockPartner(tx, partnerId);
  const product = await getDefaultProduct(tx);
  const current = await activePartnerPrice(tx, product.id, partnerId);
  const oldValue = current?.amountMinor ?? null;
  if (oldValue !== input.expectedAmountMinor) {
    throw new PricingConflictError("This partner's price was changed by someone else — reload and try again");
  }
  if (oldValue === input.amountMinor) return { changed: false };

  if (current) await tx.update(prices).set({ active: false }).where(eq(prices.id, current.id));
  let newPriceId: string | null = null;
  if (input.amountMinor !== null) {
    const [created] = await tx
      .insert(prices)
      .values({ productId: product.id, partnerId, currency: partner.currency, amountMinor: input.amountMinor })
      .returning({ id: prices.id });
    newPriceId = created!.id;
  }

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: input.amountMinor === null ? "PRICING_PARTNER_PRICE_CLEARED" : "PRICING_PARTNER_PRICE_SET",
    targetType: "partner",
    targetId: partnerId,
    metadata: { productKey: product.key, currency: partner.currency, oldValue, newValue: input.amountMinor, oldPriceId: current?.id ?? null, newPriceId },
  });
  return { changed: true };
}

export async function setPartnerCommission(
  tx: Tx,
  adminUserId: string,
  partnerId: string,
  input: { commissionRateBps: number; expectedCommissionRateBps: number },
): Promise<PricingChangeResult> {
  await assertAdminTx(tx);
  const partner = await lockPartner(tx, partnerId);
  const oldValue = partner.commissionRateBps;
  if (oldValue !== input.expectedCommissionRateBps) {
    throw new PricingConflictError("This partner's commission was changed by someone else — reload and try again");
  }
  if (oldValue === input.commissionRateBps) return { changed: false };

  await tx.update(partners).set({ commissionRateBps: input.commissionRateBps, updatedAt: new Date() }).where(eq(partners.id, partnerId));

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PRICING_PARTNER_COMMISSION_UPDATED",
    targetType: "partner",
    targetId: partnerId,
    metadata: { oldValue, newValue: input.commissionRateBps },
  });
  return { changed: true };
}

import "server-only";
import { cache } from "react";
import { and, eq, isNull } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { prices, products } from "@/db/schema";
import { DEFAULT_PRODUCT_KEY } from "@/lib/greetings/constants";
import { logServerError } from "@/lib/log";
import { pickStandardPrice, type StandardPrice } from "./standard-price";

export type { StandardPrice };

/**
 * The standard price of one greeting activation, for the public pricing
 * page: the same `prices` rows checkout resolves (lib/payments/pricing.ts),
 * limited to the platform default (partner_id IS NULL). A partner-specific
 * price, where one exists, is shown on that partner's card and at checkout.
 * Display only: checkout always re-resolves and snapshots its own price.
 * Never falls back to a hard-coded amount. Cached per request, so a page
 * and its components share one query.
 */
export const getStandardPrice = cache(async (): Promise<StandardPrice | null> => {
  try {
    const rows = await withPublicContext((tx) =>
      tx
        .select({ amountMinor: prices.amountMinor, currency: prices.currency })
        .from(prices)
        .innerJoin(products, eq(products.id, prices.productId))
        .where(and(eq(products.key, DEFAULT_PRODUCT_KEY), eq(products.active, true), eq(prices.active, true), isNull(prices.partnerId)))
        .limit(2),
    );
    const price = pickStandardPrice(rows);
    if (!price && rows.length > 1) logServerError("getStandardPrice", new Error("More than one active platform-default price"));
    return price;
  } catch (err) {
    logServerError("getStandardPrice", err);
    return null;
  }
});

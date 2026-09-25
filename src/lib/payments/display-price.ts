import "server-only";
import { eq } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { products } from "@/db/schema";
import { resolveActivePrice } from "./pricing";
import { DEFAULT_PRODUCT_KEY } from "@/lib/greetings/constants";

/**
 * Server-authoritative price for display only (Sender Entry / Preview CTA) —
 * NEVER snapshotted or trusted as a checkout amount; startCheckout
 * (lib/payments/service.ts) re-resolves and snapshots its own price
 * independently. Returns null if no active price exists, so callers can fail
 * safely — never invent or fall back to a hardcoded amount (Phase 2 §14).
 */
export async function getDisplayPrice(
  partnerId: string,
  productId: string,
): Promise<{ amountMinor: number; currency: string } | null> {
  try {
    return await withPublicContext(async (tx) => {
      const price = await resolveActivePrice(tx, productId, partnerId);
      return { amountMinor: price.amountMinor, currency: price.currency };
    });
  } catch {
    return null;
  }
}

/** Convenience for the Sender Entry / Preview paths, which only ever price the one default product. */
export async function getDefaultProductPrice(partnerId: string): Promise<{ amountMinor: number; currency: string } | null> {
  const [product] = await withPublicContext((tx) => tx.select({ id: products.id }).from(products).where(eq(products.key, DEFAULT_PRODUCT_KEY)).limit(1));
  if (!product) return null;
  return getDisplayPrice(partnerId, product.id);
}

/** Re-exported from the client-safe module so server and client format identically. */
export { formatMinorAmount } from "@/lib/format/money";

import "server-only";
import { eq } from "drizzle-orm";
import { withPaymentActivation } from "@/db/client";
import { orders } from "@/db/schema";
import { env } from "@/lib/env";

/**
 * Payment ownership fence (PAYMENTS_SCOPE_PARTNER_ID).
 *
 * A staging deployment that holds real provider credentials may share its
 * database with simulator-made orders and payments. With the fence set,
 * every path that would contact the provider about an existing order
 * (payment creation, status verification, refund requests, refund
 * reconciliation) first proves the order belongs to the fenced partner.
 * Fail-closed: an order that cannot be read, or belongs to anyone else, is
 * refused BEFORE any provider call and before any database write.
 *
 * Unset (production): no fence, no extra query.
 */
export class PaymentScopeError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} is outside this deployment's payment scope`);
    this.name = "PaymentScopeError";
  }
}

export function paymentScopePartnerId(): string | undefined {
  return env.PAYMENTS_SCOPE_PARTNER_ID || undefined;
}

export async function assertOrderInPaymentScope(orderId: string): Promise<void> {
  const scope = paymentScopePartnerId();
  if (!scope) return;
  let owner: string | undefined;
  try {
    const [row] = await withPaymentActivation(orderId, (tx) => tx.select({ partnerId: orders.partnerId }).from(orders).where(eq(orders.id, orderId)).limit(1));
    owner = row?.partnerId;
  } catch {
    owner = undefined; // unreadable → refused, never assumed in scope
  }
  if (owner !== scope) throw new PaymentScopeError(orderId);
}

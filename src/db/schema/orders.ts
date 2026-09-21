import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { orderStatusEnum } from "./enums";
import { greetings } from "./greetings";
import { qrCodes } from "./qr";
import { partners } from "./partners";
import { products, prices } from "./products";

/**
 * A checkout attempt. Created when the sender starts checkout on their own
 * DRAFT greeting (server-authoritative pricing/attribution — see
 * lib/payments/service.ts). One greeting may have several orders over time
 * (an abandoned/failed attempt followed by a retry), but at most one may ever
 * be PAID — enforced by the partial unique index below, not just app logic.
 *
 * gross/commission/platform-share are a SNAPSHOT taken at checkout time.
 * Changing `prices` or a partner's `commissionRateBps` later must never alter
 * an existing order's numbers — that's the whole point of storing them here
 * instead of joining out to the live price/partner rows.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    greetingId: uuid("greeting_id")
      .notNull()
      .references(() => greetings.id, { onDelete: "restrict" }),
    qrCodeId: uuid("qr_code_id")
      .notNull()
      .references(() => qrCodes.id, { onDelete: "restrict" }),
    // Attribution comes from the QR/greeting chain only, resolved server-side
    // at order-creation time — never accepted as client input. See RLS policy
    // orders_insert_by_token, which cross-checks this against the greeting's
    // actual QR rather than trusting the inserted value.
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    priceId: uuid("price_id").references(() => prices.id, { onDelete: "set null" }),
    currency: text("currency").notNull(),
    grossAmountMinor: integer("gross_amount_minor").notNull(),
    partnerCommissionMinor: integer("partner_commission_minor").notNull(),
    platformShareMinor: integer("platform_share_minor").notNull(),
    status: orderStatusEnum("status").notNull().default("PENDING_PAYMENT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    index("orders_partner_id_idx").on(table.partnerId),
    index("orders_greeting_id_idx").on(table.greetingId),
    // At most one PAID order per greeting — a hard backstop against ever
    // double-activating or double-crediting commission for the same greeting.
    uniqueIndex("orders_one_paid_per_greeting")
      .on(table.greetingId)
      .where(sql`${table.status} = 'PAID'`),
    check(
      "orders_amounts_reconcile",
      sql`${table.grossAmountMinor} = ${table.partnerCommissionMinor} + ${table.platformShareMinor}`,
    ),
    check("orders_amounts_non_negative", sql`${table.grossAmountMinor} >= 0 and ${table.partnerCommissionMinor} >= 0 and ${table.platformShareMinor} >= 0`),
  ],
).enableRLS();

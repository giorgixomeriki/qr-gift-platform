import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { paymentStatusEnum } from "./enums";
import { orders } from "./orders";

/**
 * One row per payment attempt against an order (a retry after a failed
 * attempt creates a new payment row, not a new order). `provider` is free
 * text rather than an enum — no production provider is selected yet (Phase
 * 0.5 scope), and like content_types, adding a provider should never require
 * a schema migration. Validated against lib/payments/types.ts's provider
 * union at the application layer.
 *
 * `provider_metadata` must NEVER contain card numbers, CVVs, or raw
 * provider auth tokens — only safe references (masked card suffix, payment
 * method type, provider's own public reference id). Each provider adapter is
 * responsible for sanitizing before this is persisted — see
 * lib/payments/types.ts's `sanitizeMetadata`.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    providerMetadata: jsonb("provider_metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    index("payments_order_id_idx").on(table.orderId),
    // Idempotency backstop: the same provider can never be recorded twice for
    // the same provider-assigned payment id, so a duplicate webhook delivery
    // that tries to INSERT a second row fails at the DB level even if the
    // app-level "already processed" check were ever bypassed.
    uniqueIndex("payments_provider_payment_id_unique")
      .on(table.provider, table.providerPaymentId)
      .where(sql`${table.providerPaymentId} is not null`),
  ],
).enableRLS();

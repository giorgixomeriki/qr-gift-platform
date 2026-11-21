import { sql } from "drizzle-orm";
import { pgTable, uuid, text, date, timestamp, index, check } from "drizzle-orm/pg-core";
import { orders } from "./orders";
import { greetings } from "./greetings";

/**
 * Evidence that the buyer agreed to the Terms and the Delivery and Refunds
 * policy and acknowledged the Privacy Policy before paying (migrations/0023_checkout_consents).
 * Append-only: app_runtime may insert and select, never update or delete.
 * A row is written by acceptCheckoutTerms (lib/payments/checkout.ts) for the
 * greeting's own PENDING_PAYMENT order, and only then is a real provider
 * payment created: no bank payment exists without a consent row before it.
 *
 * No personal data: which order, when, in which language, the SHA-256 of the
 * exact consent sentence shown, and the policies' effective date at that
 * moment (null only on TEST/dev deployments without one).
 */
export const checkoutConsents = pgTable(
  "checkout_consents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    greetingId: uuid("greeting_id")
      .notNull()
      .references(() => greetings.id, { onDelete: "restrict" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().default(sql`now()`),
    locale: text("locale").notNull(),
    consentTextSha256: text("consent_text_sha256").notNull(),
    policiesEffectiveDate: date("policies_effective_date"),
  },
  (table) => [
    index("checkout_consents_order_id_idx").on(table.orderId),
    check("checkout_consents_locale", sql`${table.locale} in ('ka', 'en')`),
    check("checkout_consents_sha256", sql`${table.consentTextSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

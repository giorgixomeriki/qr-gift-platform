import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex, unique, check, foreignKey } from "drizzle-orm/pg-core";
import { ledgerEntryTypeEnum, payoutStatusEnum } from "./enums";
import { partners } from "./partners";
import { orders } from "./orders";

/**
 * A partner's commission balance is a running total, not a single mutable
 * column — every earning, reversal, payout and manual adjustment is its own
 * immutable row (no UPDATE/DELETE policy exists on this table — see
 * migrations/0002). Balance for a partner+currency = SUM(amount_minor).
 *
 * Sign convention (amount_minor):
 *   COMMISSION_EARNED      positive  (money now owed to the partner)
 *   COMMISSION_REVERSAL    negative  (a prior earning clawed back, e.g. refund)
 *   PAYOUT                 negative  (money paid out, leaving the owed balance)
 *   ADJUSTMENT              either   (manual admin correction)
 *
 * `payoutId` is set on a PAYOUT debit row itself (pointing at its own
 * partner_payouts row), so `WHERE payout_id = X` finds that payout's own
 * ledger entry. It is deliberately NOT set on the COMMISSION_EARNED/
 * ADJUSTMENT rows a payout "sweeps up" — this table has no UPDATE policy at
 * all (append-only, for anyone, including admin), so nothing could ever
 * retroactively mark an existing row that way. Balance (paid or unpaid) is
 * always just the plain running SUM(amount_minor) — see
 * lib/payments/payouts.ts's getPartnerUnpaidBalance for the one place that
 * computation lives.
 *
 * DB-enforced on insert (migrations/0013, trg_partner_ledger_entries_integrity):
 * COMMISSION_EARNED must match its PAID order's partner/currency/commission
 * snapshot exactly; COMMISSION_REVERSAL must be the exact negation for a
 * REFUNDED order that has an earning; a PAYOUT can never take the
 * partner+currency balance below zero (serialized by an advisory lock).
 */
export const partnerLedgerEntries = pgTable(
  "partner_ledger_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
    payoutId: uuid("payout_id").references((): typeof partnerPayouts.id => partnerPayouts.id, {
      onDelete: "set null",
    }),
    type: ledgerEntryTypeEnum("type").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("partner_ledger_entries_partner_id_idx").on(table.partnerId),
    // Not currently used by any query (balance is a plain SUM, not filtered
    // by payout_id — see this table's doc comment above) — kept rather than
    // migrated away purely to avoid schema churn at pilot scale; harmless.
    index("partner_ledger_entries_unpaid_idx").on(table.partnerId, table.currency).where(sql`${table.payoutId} is null`),
    // At most one COMMISSION_EARNED entry per order — the hard DB-level
    // guarantee behind "duplicate payment-success processing does not
    // duplicate commission," independent of the app-level idempotency checks.
    uniqueIndex("partner_ledger_one_commission_per_order")
      .on(table.orderId)
      .where(sql`${table.type} = 'COMMISSION_EARNED'`),
    // At most one reversal per order (migrations/0013) — a refund replayed
    // twice can't claw the same commission back twice.
    uniqueIndex("partner_ledger_one_reversal_per_order")
      .on(table.orderId)
      .where(sql`${table.type} = 'COMMISSION_REVERSAL'`),
    check(
      "partner_ledger_entries_sign",
      sql`(${table.type} = 'COMMISSION_EARNED' and ${table.amountMinor} >= 0) or (${table.type} = 'COMMISSION_REVERSAL' and ${table.amountMinor} <= 0) or (${table.type} = 'PAYOUT' and ${table.amountMinor} < 0) or ${table.type} = 'ADJUSTMENT'`,
    ),
    // One PAYOUT ledger row per payout (migrations/0014).
    uniqueIndex("partner_ledger_one_payout_row_per_payout")
      .on(table.payoutId)
      .where(sql`${table.type} = 'PAYOUT'`),
    // Composite-FK target for partner_payout_items (same partner + currency).
    unique("partner_ledger_entries_id_partner_currency_unique").on(table.id, table.partnerId, table.currency),
    check(
      "partner_ledger_entries_commission_has_order",
      sql`${table.type} not in ('COMMISSION_EARNED', 'COMMISSION_REVERSAL') or ${table.orderId} is not null`,
    ),
  ],
).enableRLS();

/**
 * A batch payout to a partner for a period. Automated bank transfer is out of
 * scope for Phase 0.5 — this row records that a payout was decided/made,
 * reconciled against partner_ledger_entries via payoutId above.
 */
export const partnerPayouts = pgTable(
  "partner_payouts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    status: payoutStatusEnum("status").notNull().default("PENDING"),
    periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
    periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
    // Free-text operational note (Phase 5 §16) — "sent via bank transfer
    // ref #1234", "cash, handed over in person 2026-01-15", etc. Never
    // parsed/relied on by app logic, purely a human record of how the
    // out-of-platform transfer actually happened.
    reference: text("reference"),
    // false = legacy balance-based payout recorded before migrations/0014:
    // valid, but with no sale-level item breakdown (none is fabricated).
    itemized: boolean("itemized").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    index("partner_payouts_partner_id_idx").on(table.partnerId),
    check("partner_payouts_amount_positive", sql`${table.amountMinor} > 0`),
    unique("partner_payouts_id_partner_currency_unique").on(table.id, table.partnerId, table.currency),
  ],
).enableRLS();

/**
 * Which ledger rows a payout settled (migrations/0014). A pure link — the
 * money lives on the immutable partner_ledger_entries rows; the payout's
 * amount must equal the SUM of its items (deferred check at COMMIT).
 *
 * ledgerEntryId is the primary key: a commission can be in at most one
 * payout, ever. partnerId/currency exist only so the two composite foreign
 * keys can force payout and ledger row to belong to the same partner and
 * currency. Append-only (no update/delete policy; updates also blocked by
 * trigger). Eligibility rules live in trg_partner_payout_items_eligibility.
 */
export const partnerPayoutItems = pgTable(
  "partner_payout_items",
  {
    ledgerEntryId: uuid("ledger_entry_id").primaryKey(),
    payoutId: uuid("payout_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "partner_payout_items_payout_fk",
      columns: [table.payoutId, table.partnerId, table.currency],
      foreignColumns: [partnerPayouts.id, partnerPayouts.partnerId, partnerPayouts.currency],
    }).onDelete("restrict"),
    foreignKey({
      name: "partner_payout_items_ledger_fk",
      columns: [table.ledgerEntryId, table.partnerId, table.currency],
      foreignColumns: [partnerLedgerEntries.id, partnerLedgerEntries.partnerId, partnerLedgerEntries.currency],
    }).onDelete("restrict"),
    index("partner_payout_items_payout_id_idx").on(table.payoutId),
    index("partner_payout_items_partner_id_idx").on(table.partnerId),
  ],
).enableRLS();

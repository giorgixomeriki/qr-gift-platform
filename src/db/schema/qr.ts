import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { qrStatusEnum, qrDistributionStatusEnum } from "./enums";
import { partners } from "./partners";

export const qrBatches = pgTable(
  "qr_batches",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    quantity: integer("quantity").notNull(),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    // Hard backstop behind the app-layer quantity validation in
    // lib/validation/qr.ts — a batch's declared quantity must always match
    // how many qr_codes rows were actually generated for it.
    check("qr_batches_quantity_range", sql`${table.quantity} > 0 and ${table.quantity} <= 2000`),
  ],
).enableRLS();

/**
 * publicToken is the QR's permanent identity — the only thing ever printed on the
 * physical card (see architecture plan section 5). Generated with nanoid(24) at
 * batch-creation time: not sequential, not practically enumerable.
 *
 * No `greeting_id` column here on purpose: `greetings.qr_code_id` is the single
 * FK direction, so QR<->greeting state can't desync into two disagreeing rows.
 */
export const qrCodes = pgTable(
  "qr_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    publicToken: text("public_token").notNull().unique(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => qrBatches.id, { onDelete: "restrict" }),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    status: qrStatusEnum("status").notNull().default("AVAILABLE"),
    // Physical distribution — independent of `status` above (see
    // qrDistributionStatusEnum). A QR can be ACTIVE (scanned, paid, live) while
    // still NOT_DISTRIBUTED if it was never actually printed/shipped by the
    // partner — that's a data-quality signal worth keeping visible, not
    // something to auto-correct.
    distributionStatus: qrDistributionStatusEnum("distribution_status").notNull().default("NOT_DISTRIBUTED"),
    distributedAt: timestamp("distributed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
  (table) => [
    index("qr_codes_partner_id_idx").on(table.partnerId),
    index("qr_codes_batch_id_idx").on(table.batchId),
    index("qr_codes_distribution_status_idx").on(table.distributionStatus),
  ],
).enableRLS();

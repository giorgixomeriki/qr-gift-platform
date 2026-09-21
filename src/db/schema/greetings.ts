import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { greetingStatusEnum, contentStatusEnum } from "./enums";
import { qrCodes } from "./qr";
import { themes } from "./themes";
import { products } from "./products";
import { contentTypes } from "./content-types";

export const greetings = pgTable("greetings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  qrCodeId: uuid("qr_code_id")
    .notNull()
    .unique()
    .references(() => qrCodes.id, { onDelete: "restrict" }),
  themeId: uuid("theme_id")
    .notNull()
    .references(() => themes.id, { onDelete: "restrict" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),
  status: greetingStatusEnum("status").notNull().default("DRAFT"),
  locale: text("locale").notNull().default("ka"),
  version: integer("version").notNull().default(1),
  /**
   * SHA-256 hash of the sender's edit token. Never the plaintext token — see
   * lib/security/edit-token.ts. Set to NULL once the greeting leaves DRAFT so a
   * leaked/cached token can no longer authorize mutation (belt-and-suspenders on
   * top of the app-layer status check).
   */
  editTokenHash: text("edit_token_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
}).enableRLS();

/**
 * `type` is a free-text FK into contentTypes rather than a Postgres enum, so new
 * content types are additive (INSERT), never a schema migration. See
 * content-types.ts and lib/validation/content-types.ts for the validated subset.
 */
export const greetingContent = pgTable(
  "greeting_content",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    greetingId: uuid("greeting_id")
      .notNull()
      .references(() => greetings.id, { onDelete: "cascade" }),
    type: text("type")
      .notNull()
      .references(() => contentTypes.key, { onDelete: "restrict" }),
    slot: integer("slot").notNull().default(0),
    textValue: text("text_value"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationMs: integer("duration_ms"),
    status: contentStatusEnum("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("greeting_content_greeting_id_idx").on(table.greetingId)],
).enableRLS();

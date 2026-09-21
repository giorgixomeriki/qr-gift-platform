import { sql } from "drizzle-orm";
import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { qrCodes } from "./qr";
import { greetings } from "./greetings";
import { partners } from "./partners";

/**
 * `metadata` must never contain greeting text, media URLs/keys, or anything
 * identifying — enforced in code by lib/validation/analytics-events.ts, which
 * defines a closed Zod union of event types and their allowed metadata shape
 * rather than accepting arbitrary jsonb from callers.
 *
 * `anonSessionId` is a random client-generated id (crypto.randomUUID, stored in a
 * short-lived non-httpOnly cookie) used only to distinguish "unique-ish" sessions
 * for scan/open counts — never tied to a real identity, never cross-referenced
 * with auth users.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    eventType: text("event_type").notNull(),
    qrCodeId: uuid("qr_code_id").references(() => qrCodes.id, { onDelete: "set null" }),
    greetingId: uuid("greeting_id").references(() => greetings.id, { onDelete: "set null" }),
    partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
    anonSessionId: uuid("anon_session_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("analytics_events_qr_code_id_idx").on(table.qrCodeId),
    index("analytics_events_event_type_idx").on(table.eventType),
  ],
).enableRLS();

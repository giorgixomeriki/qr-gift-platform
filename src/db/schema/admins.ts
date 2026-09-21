import { sql } from "drizzle-orm";
import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";

/**
 * Platform admins. Deliberately separate from partnerMembers — admin status is never
 * inferable from any partner role, per the security model in the architecture plan.
 */
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}).enableRLS();

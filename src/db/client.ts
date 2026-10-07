import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import * as schema from "./schema";

// One pooled connection, reused across requests (Next.js server runtime keeps
// this module-level singleton alive between invocations in the same process).
const queryClient = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(queryClient, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `fn` inside a transaction with Postgres session variables set via
 * SET LOCAL, which RLS policies read via current_setting(...). SET LOCAL is
 * transaction-scoped, so these values can never leak into another request that
 * happens to reuse the same pooled connection afterwards.
 *
 * These are a *second* layer, not the only layer: every caller must also check
 * authorization in application code before calling in. RLS is the backstop for
 * when app code has a bug, not a replacement for the app-code check.
 */
async function withContext<T>(
  vars: Record<string, string>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(vars)) {
      // set_config's 3rd arg (is_local=true) scopes the setting to this transaction.
      await tx.execute(sql`select set_config(${key}, ${value}, true)`);
    }
    return fn(tx);
  });
}

/**
 * Scopes a transaction to a verified partner membership. `partnerId` must already
 * have been checked against the caller's memberships in app code — this does not
 * perform that check, it only makes the verified values visible to RLS policies
 * (which independently re-verify membership via app_is_partner_member()).
 */
export function withPartnerContext<T>(
  userId: string,
  partnerId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext({ "app.user_id": userId, "app.partner_id": partnerId }, fn);
}

/**
 * Scopes a transaction to a verified authenticated user with no specific
 * partner selected yet — e.g. listing which partners a user belongs to. Also
 * the basis for withAdminContext, since "admin" is just this plus a check the
 * caller already performed (requireAdmin) before calling in.
 */
export function withUserContext<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext({ "app.user_id": userId }, fn);
}

/** Scopes a transaction to a verified admin user. */
export function withAdminContext<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUserContext(userId, fn);
}

/**
 * Scopes a transaction to a single greeting the caller has already unlocked by
 * presenting a valid sender edit token (hash-verified in app code beforehand).
 * RLS only allows mutating this one greeting row, and only while it's DRAFT.
 */
export function withEditableGreeting<T>(
  greetingId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext({ "app.editable_greeting_id": greetingId }, fn);
}

/**
 * Scopes a transaction to a single QR code the caller has already verified is
 * legitimate to claim — either it's AVAILABLE (starting a new draft) or its
 * DRAFT greeting's edit token hash matched (activating). This is what lets an
 * identity-less anonymous sender flip qr_codes.status without partner/admin
 * membership: a narrow capability over one row, not a role-based grant.
 */
export function withClaimableQr<T>(qrId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext({ "app.claimable_qr_id": qrId }, fn);
}

/**
 * Phase 0.5: activation is payment-driven only. `orderId` must already be a
 * genuinely PAID order (checked again by RLS itself via
 * greetings_activate_by_payment / qr_codes_activate_by_payment — see
 * migrations/0003_commercial_rls.sql) — this only makes the id visible to
 * those policies, it does not grant activation by itself. Called exclusively
 * from lib/payments/service.ts, never from a route handler directly.
 *
 * App code MUST update greetings first, then qr_codes — the qr_codes
 * activation-invariant trigger checks for an already-ACTIVE greeting, which
 * is only visible mid-transaction if greetings was updated first.
 */
export function withPaymentActivation<T>(orderId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext({ "app.payment_activation_order_id": orderId }, fn);
}

/**
 * An admin acting on one order's payment records: refunding a PAID order
 * (lib/payments/service.ts refundPaidOrder). The admin half authorizes the
 * order update and the COMMISSION_REVERSAL ledger insert (app_is_admin()
 * policies); the order half is what payments_update_by_payment_service keys
 * off, scoped to this one order. Callers must have run requireAdmin first.
 */
export function withAdminPaymentContext<T>(adminUserId: string, orderId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext({ "app.user_id": adminUserId, "app.payment_activation_order_id": orderId }, fn);
}

/**
 * No elevated context. Relies solely on the public-read RLS policies (e.g.
 * ACTIVE greetings, AVAILABLE/ACTIVE QR status) — this is what the recipient
 * experience and QR state lookup use.
 */
export function withPublicContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx));
}

/**
 * Bootstrap check: is this authenticated user an admin? Calls the SECURITY
 * DEFINER `app_is_admin()` SQL function (see migrations/0001) rather than
 * selecting from admin_users directly — that table's own SELECT policy
 * requires app_is_admin() to already be true, which would be circular.
 */
export async function checkIsAdmin(userId: string): Promise<boolean> {
  return withContext({ "app.user_id": userId }, async (tx) => {
    const [row] = await tx.execute<{ is_admin: boolean }>(sql`select app_is_admin() as is_admin`);
    return row?.is_admin ?? false;
  });
}

/**
 * Bootstrap check: what role (if any) does this user hold on this partner?
 * Same rationale as checkIsAdmin — goes through the SECURITY DEFINER function
 * rather than querying partner_members directly.
 */
export async function getPartnerRole(userId: string, partnerId: string): Promise<string | null> {
  return withContext({ "app.user_id": userId }, async (tx) => {
    const [row] = await tx.execute<{ app_partner_role: string | null }>(
      sql`select app_partner_role(${partnerId}::uuid)`,
    );
    return row?.app_partner_role ?? null;
  });
}

import { pgEnum } from "drizzle-orm/pg-core";

/**
 * QR identity lifecycle. Separate from greeting lifecycle — see greetingStatusEnum.
 * Invariant: qr_codes.status = 'ACTIVE' iff its referencing greeting has status = 'ACTIVE'.
 * Enforced by a DB trigger (see migrations/0001_rls_and_functions.sql), not by the app alone.
 */
export const qrStatusEnum = pgEnum("qr_status", [
  "AVAILABLE",
  "DRAFT",
  "ACTIVE",
  "BLOCKED",
]);

/**
 * Physical distribution state — deliberately separate from qrStatusEnum
 * (Phase 1). A QR can be generated but still sitting in a box (NOT_DISTRIBUTED)
 * regardless of its lifecycle status; distribution is a partner/admin-confirmed
 * fact about the physical card, never inferred from batch creation or from any
 * lifecycle transition.
 */
export const qrDistributionStatusEnum = pgEnum("qr_distribution_status", [
  "NOT_DISTRIBUTED",
  "DISTRIBUTED",
]);

/** Greeting content lifecycle. Authoritative for moderation/content state. */
export const greetingStatusEnum = pgEnum("greeting_status", [
  "DRAFT",
  "ACTIVE",
  "BLOCKED",
  "DELETED",
]);

/** Role of a user within one specific partner (many-to-many via partnerMembers). */
export const partnerRoleEnum = pgEnum("partner_role", [
  "OWNER",
  "ADMIN",
  "STAFF",
  "VIEWER",
]);

export const partnerStatusEnum = pgEnum("partner_status", [
  "ACTIVE",
  "SUSPENDED",
]);

export const contentStatusEnum = pgEnum("content_status", [
  "PENDING",
  "READY",
  "FAILED",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "OPEN",
  "DISMISSED",
  "BLOCKED",
]);

export const actorTypeEnum = pgEnum("actor_type", [
  "ADMIN",
  "PARTNER",
  "SYSTEM",
]);

/**
 * Commercial order lifecycle (Phase 0.5). Deliberately separate from
 * greetingStatusEnum: a greeting stays DRAFT through PREVIEW/CHECKOUT/
 * PAYMENT_PENDING — only a PAID order can ever flip it to ACTIVE. See
 * migrations/0002_commercial_entities.sql for the activation invariant.
 */
export const orderStatusEnum = pgEnum("order_status", [
  "PENDING_PAYMENT",
  "PAID",
  "FAILED",
  "CANCELED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  // Captured for a greeting that was no longer purchasable when the payment
  // arrived (migrations/0011) — never activated, no commission; awaits refund.
  "REFUND_REQUIRED",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
]);

/**
 * Signed ledger entry types — see partner-ledger.ts for the sign convention.
 * COMMISSION_EARNED/ADJUSTMENT(credit) are positive, PAYOUT/COMMISSION_REVERSAL/
 * ADJUSTMENT(debit) are negative. Balance is always SUM(amount_minor).
 */
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "COMMISSION_EARNED",
  "COMMISSION_REVERSAL",
  "PAYOUT",
  "ADJUSTMENT",
]);

export const payoutStatusEnum = pgEnum("payout_status", [
  "PENDING",
  "PROCESSING",
  "PAID",
  "FAILED",
]);

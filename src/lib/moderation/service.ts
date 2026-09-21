import "server-only";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { greetings, qrCodes, partners, themes, orders, reports } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";

export class ModerationError extends Error {}

/**
 * Safe operational metadata only — Phase 4 §12's hard line: "Do not casually
 * expose private Greeting content to normal Admin/Partner dashboards."
 * Deliberately selects specific columns rather than `select *`, so adding a
 * content-shaped column to `greetings` later can never silently leak through
 * here.
 */
export type GreetingLookupResult = {
  greetingId: string;
  status: string;
  themeKey: string;
  qrPublicToken: string;
  qrStatus: string;
  qrDistributionStatus: string;
  partnerName: string;
  partnerSlug: string;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  hasPaidOrder: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin operational lookup (Phase 4 §12) — accepts either the printed public
 * QR token or an internal Greeting id, and returns only metadata a support
 * operator needs (status, theme, partner attribution, timestamps). Never
 * touches greeting_content.
 */
export async function findGreetingForModeration(tx: Tx, query: string): Promise<GreetingLookupResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const whereClause = UUID_RE.test(trimmed) ? eq(greetings.id, trimmed) : eq(qrCodes.publicToken, trimmed.toUpperCase());

  const [row] = await tx
    .select({
      greetingId: greetings.id,
      status: greetings.status,
      themeKey: themes.key,
      qrPublicToken: qrCodes.publicToken,
      qrStatus: qrCodes.status,
      qrDistributionStatus: qrCodes.distributionStatus,
      partnerName: partners.name,
      partnerSlug: partners.slug,
      createdAt: greetings.createdAt,
      updatedAt: greetings.updatedAt,
      activatedAt: greetings.activatedAt,
    })
    .from(greetings)
    .innerJoin(qrCodes, eq(qrCodes.id, greetings.qrCodeId))
    .innerJoin(partners, eq(partners.id, qrCodes.partnerId))
    .innerJoin(themes, eq(themes.id, greetings.themeId))
    .where(whereClause)
    .limit(1);
  if (!row) return null;

  const [paidOrder] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.greetingId, row.greetingId), eq(orders.status, "PAID"))).limit(1);

  return { ...row, hasPaidOrder: !!paidOrder };
}

/** DRAFT greetings nobody has touched in a while — visibility only (Phase 4 §13), never auto-recycled. */
export async function listStaleDrafts(tx: Tx, olderThanDays: number, limit = 25) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return tx
    .select({
      greetingId: greetings.id,
      qrPublicToken: qrCodes.publicToken,
      partnerName: partners.name,
      createdAt: greetings.createdAt,
      updatedAt: greetings.updatedAt,
    })
    .from(greetings)
    .innerJoin(qrCodes, eq(qrCodes.id, greetings.qrCodeId))
    .innerJoin(partners, eq(partners.id, qrCodes.partnerId))
    .where(and(eq(greetings.status, "DRAFT"), lt(greetings.updatedAt, cutoff)))
    .orderBy(greetings.updatedAt)
    .limit(limit);
}

export async function listOpenReports(tx: Tx, limit = 25) {
  return tx
    .select({
      id: reports.id,
      greetingId: reports.greetingId,
      reason: reports.reason,
      details: reports.details,
      createdAt: reports.createdAt,
    })
    .from(reports)
    .where(eq(reports.status, "OPEN"))
    .orderBy(desc(reports.createdAt))
    .limit(limit);
}

/**
 * Blocks a Greeting AND its QR uniformly, regardless of prior lifecycle
 * status (Phase 4 §12/§13) — the public dispatcher then shows the same
 * BLOCKED placeholder either way, rather than leaking "was this a draft or
 * was it live" through different failure modes. Every call is audit logged
 * with the operator-supplied reason (Phase 4 §12's "record moderation
 * reason").
 */
export async function blockGreeting(tx: Tx, adminUserId: string, greetingId: string, reason: string, resolveReportId?: string) {
  const [greeting] = await tx.select({ qrCodeId: greetings.qrCodeId, status: greetings.status }).from(greetings).where(eq(greetings.id, greetingId)).limit(1);
  if (!greeting) throw new ModerationError("Greeting not found");
  if (greeting.status === "BLOCKED") throw new ModerationError("Already blocked");

  // RLS silently matches 0 rows for an unauthorized UPDATE rather than
  // raising — .returning() + a length check is what turns "quietly did
  // nothing" into a real error, so a non-admin caller can never produce a
  // false-success audit log entry (Phase 4 §21: "moderation actions require
  // real Admin").
  const updated = await tx.update(greetings).set({ status: "BLOCKED", updatedAt: new Date() }).where(eq(greetings.id, greetingId)).returning({ id: greetings.id });
  if (updated.length === 0) throw new ModerationError("Not authorized to block this Greeting");
  await tx.update(qrCodes).set({ status: "BLOCKED" }).where(and(eq(qrCodes.id, greeting.qrCodeId), or(eq(qrCodes.status, "ACTIVE"), eq(qrCodes.status, "DRAFT"))));

  if (resolveReportId) {
    await tx.update(reports).set({ status: "BLOCKED", reviewedAt: new Date(), reviewedBy: adminUserId }).where(eq(reports.id, resolveReportId));
  }

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "GREETING_BLOCKED",
    targetType: "greeting",
    targetId: greetingId,
    metadata: { reason, previousStatus: greeting.status, resolvedReportId: resolveReportId },
  });
}

/**
 * Restores a BLOCKED Greeting to the lifecycle state its own commercial
 * history implies (Phase 4 §12's "optionally UNBLOCK where lifecycle rules
 * safely permit it") — a PAID order means it was legitimately ACTIVE before
 * moderation, so it goes back to ACTIVE; otherwise it returns to DRAFT.
 * Never invented state, never a guess: derived from the Order table itself.
 */
export async function unblockGreeting(tx: Tx, adminUserId: string, greetingId: string, reason: string) {
  const [greeting] = await tx.select({ qrCodeId: greetings.qrCodeId, status: greetings.status }).from(greetings).where(eq(greetings.id, greetingId)).limit(1);
  if (!greeting) throw new ModerationError("Greeting not found");
  if (greeting.status !== "BLOCKED") throw new ModerationError("Greeting is not blocked");

  const [paidOrder] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.greetingId, greetingId), eq(orders.status, "PAID"))).limit(1);
  const restoredStatus = paidOrder ? "ACTIVE" : "DRAFT";

  const updated = await tx.update(greetings).set({ status: restoredStatus, updatedAt: new Date() }).where(eq(greetings.id, greetingId)).returning({ id: greetings.id });
  if (updated.length === 0) throw new ModerationError("Not authorized to unblock this Greeting");
  await tx.update(qrCodes).set({ status: restoredStatus }).where(eq(qrCodes.id, greeting.qrCodeId));

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "GREETING_UNBLOCKED",
    targetType: "greeting",
    targetId: greetingId,
    metadata: { reason, restoredStatus },
  });

  return restoredStatus;
}

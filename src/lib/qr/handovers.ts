import "server-only";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db/client";
import { greetings, orders, partners, qrBatches, qrCodes, qrHandoverItems, qrHandoverReports, qrHandovers } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import { tokenHint } from "./scan-parse";

/**
 * Scan-to-Assign (migrations/0026 + 0027). An admin scans (or selects)
 * physical cards and transfers them to one partner. The admin is the sole
 * authority over inventory: the transfer completes at once, atomically, in
 * app_admin_transfer_qr_cards() — there is no partner acceptance step.
 *
 *   scan ≠ transfer ≠ sale
 *
 * Nothing here touches qr_codes.status, greetings, orders, payments, the
 * partner ledger or analytics. Every rule is re-checked by the database
 * (RLS, triggers, app_admin_transfer_qr_cards), so this module is the
 * friendly first layer, not the enforcement boundary.
 */

export class HandoverError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HandoverError";
  }
}

export const HANDOVER_MAX_CARDS = 500;
export const CENTRAL_STOCK_SLUG = "qr-starr-central-stock";

export type IneligibleReason =
  | "not_found"
  | "draft"
  | "active"
  | "blocked"
  | "has_history"
  | "reserved"
  | "other_source"
  | "same_as_destination";

/** Who holds the card now. Admin-only data (partners never see this view). */
export type CardHolder = { holderId: string; holderName: string; holderIsCentral: boolean };

export type CardEligibility =
  | ({ token: string; hint: string; eligible: true } & CardHolder)
  | ({ token: string; hint: string; eligible: false; reason: IneligibleReason; partnerName?: string } & Partial<CardHolder>);

export async function getCentralStockPartner(tx: Tx) {
  const [row] = await tx
    .select({ id: partners.id, name: partners.name, status: partners.status })
    .from(partners)
    .where(eq(partners.isCentralStock, true))
    .limit(1);
  return row ?? null;
}

/**
 * Creates the central-stock partner the first time it is needed. Always
 * SUSPENDED with 0% commission and never a login (enforced by the database,
 * migrations/0026): a card still in central stock resolves as unavailable on
 * /g/{token}, so it can't be started or sold before a store accepts it.
 */
export async function ensureCentralStockPartner(tx: Tx, adminUserId: string) {
  const existing = await getCentralStockPartner(tx);
  if (existing) return existing;
  const [created] = await tx
    .insert(partners)
    .values({
      slug: CENTRAL_STOCK_SLUG,
      name: "QR STARR — ცენტრალური საწყობი",
      commissionRateBps: 0,
      status: "SUSPENDED",
      isCentralStock: true,
    })
    .returning({ id: partners.id, name: partners.name, status: partners.status });
  if (!created) throw new HandoverError("central_stock_failed");
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "CENTRAL_STOCK_CREATED",
    targetType: "partner",
    targetId: created.id,
    metadata: { slug: CENTRAL_STOCK_SLUG },
  });
  return created;
}

/**
 * Eligibility of each token for a NEW admin handover. A card is eligible when
 * it is AVAILABLE, never had a greeting, order or payment, and is not in an
 * open handover. With `sourcePartnerId`, it must also be held by that source
 * (one handover = one source); with `destinationPartnerId`, it must not
 * already be the destination's. With `lock`, the card rows are locked FOR
 * UPDATE first (id order — no deadlock between concurrent submissions), which
 * makes the check authoritative at submission.
 */
export async function evaluateCards(
  tx: Tx,
  tokens: string[],
  opts: { lock?: boolean; sourcePartnerId?: string; destinationPartnerId?: string } = {},
): Promise<CardEligibility[]> {
  if (tokens.length === 0) return [];

  if (opts.lock) {
    await tx.execute(sql`select id from qr_codes where public_token in ${tokens} order by id for update`);
  }

  const cards = await tx
    .select({
      id: qrCodes.id,
      token: qrCodes.publicToken,
      status: qrCodes.status,
      holderId: qrCodes.partnerId,
      holderName: partners.name,
      holderIsCentral: partners.isCentralStock,
    })
    .from(qrCodes)
    .innerJoin(partners, eq(partners.id, qrCodes.partnerId))
    .where(inArray(qrCodes.publicToken, tokens));
  const byToken = new Map(cards.map((c) => [c.token, c]));
  const ids = cards.map((c) => c.id);

  const withGreeting = new Set(
    ids.length ? (await tx.select({ id: greetings.qrCodeId }).from(greetings).where(inArray(greetings.qrCodeId, ids))).map((r) => r.id) : [],
  );
  const withOrder = new Set(
    ids.length ? (await tx.select({ id: orders.qrCodeId }).from(orders).where(inArray(orders.qrCodeId, ids))).map((r) => r.id) : [],
  );
  const reservations = new Map(
    ids.length
      ? (
          await tx
            .select({ qrCodeId: qrHandoverItems.qrCodeId, partnerName: partners.name })
            .from(qrHandoverItems)
            .innerJoin(qrHandovers, eq(qrHandovers.id, qrHandoverItems.handoverId))
            .innerJoin(partners, eq(partners.id, qrHandovers.toPartnerId))
            .where(and(inArray(qrHandoverItems.qrCodeId, ids), eq(qrHandoverItems.reserved, true)))
        ).map((r) => [r.qrCodeId, r.partnerName])
      : [],
  );

  return tokens.map((token): CardEligibility => {
    const hint = tokenHint(token);
    const card = byToken.get(token);
    if (!card) return { token, hint, eligible: false, reason: "not_found" };
    const holder: CardHolder = { holderId: card.holderId, holderName: card.holderName, holderIsCentral: card.holderIsCentral };
    const no = (reason: IneligibleReason, partnerName?: string): CardEligibility => ({ token, hint, eligible: false, reason, partnerName, ...holder });
    if (card.status === "BLOCKED") return no("blocked");
    if (card.status === "ACTIVE") return no("active");
    if (card.status === "DRAFT") return no("draft");
    if (withGreeting.has(card.id) || withOrder.has(card.id)) return no("has_history");
    const reservedFor = reservations.get(card.id);
    if (reservedFor !== undefined) return no("reserved", reservedFor);
    if (opts.sourcePartnerId && card.holderId !== opts.sourcePartnerId) return no("other_source", card.holderName);
    if (opts.destinationPartnerId && card.holderId === opts.destinationPartnerId) return no("same_as_destination", card.holderName);
    return { token, hint, eligible: true, ...holder };
  });
}

export type CreateHandoverInput = {
  idempotencyKey: string;
  fromPartnerId: string;
  toPartnerId: string;
  tokens: string[];
  note?: string;
};

export type CreateHandoverResult =
  | { ok: true; handoverId: string; quantity: number; duplicate: boolean; totals: TransferTotals }
  | { ok: false; code: "ineligible"; cards: CardEligibility[] };

/** Cards each side holds right after the transfer (any status / AVAILABLE only). */
export type TransferTotals = { destinationHeld: number; destinationAvailable: number; sourceHeld: number; sourceAvailable: number };

async function transferTotals(tx: Tx, sourceId: string, destinationId: string): Promise<TransferTotals> {
  const rows = await tx
    .select({
      partnerId: qrCodes.partnerId,
      held: sql<number>`count(*)::int`,
      available: sql<number>`(count(*) filter (where ${qrCodes.status} = 'AVAILABLE'))::int`,
    })
    .from(qrCodes)
    .where(inArray(qrCodes.partnerId, [sourceId, destinationId]))
    .groupBy(qrCodes.partnerId);
  const of = (id: string) => rows.find((r) => r.partnerId === id) ?? { held: 0, available: 0 };
  return { destinationHeld: of(destinationId).held, destinationAvailable: of(destinationId).available, sourceHeld: of(sourceId).held, sourceAvailable: of(sourceId).available };
}

/**
 * Admin only: transfers exactly these cards, all held by `fromPartnerId`
 * (central stock or a partner), to `toPartnerId` — immediately. The database
 * function records the handover and moves ownership in one transaction
 * (status ACCEPTED, resolved by the admin). All-or-nothing: one ineligible
 * card refuses the whole request and nothing is written. A repeat with the
 * same idempotency key returns the first result (duplicate: true).
 */
export async function createHandover(tx: Tx, adminUserId: string, input: CreateHandoverInput): Promise<CreateHandoverResult> {
  const tokens = [...new Set(input.tokens)];
  if (tokens.length === 0) throw new HandoverError("no_cards");
  if (tokens.length > HANDOVER_MAX_CARDS) throw new HandoverError("too_many_cards");

  // Same-key submissions (double tap, retry after a dropped response) are
  // serialized here (the DB function takes the same lock), so the second one
  // always sees the first one's result.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`qr_handover:${input.idempotencyKey}`}, 0))`);
  const [previous] = await tx
    .select({ id: qrHandovers.id, quantity: qrHandovers.quantity, toPartnerId: qrHandovers.toPartnerId, fromPartnerId: qrHandovers.fromPartnerId })
    .from(qrHandovers)
    .where(eq(qrHandovers.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (previous) {
    if (previous.toPartnerId !== input.toPartnerId || previous.fromPartnerId !== input.fromPartnerId || previous.quantity !== tokens.length) {
      throw new HandoverError("idempotency_conflict");
    }
    const totals = await transferTotals(tx, previous.fromPartnerId, previous.toPartnerId);
    return { ok: true, handoverId: previous.id, quantity: previous.quantity, duplicate: true, totals };
  }

  if (input.fromPartnerId === input.toPartnerId) throw new HandoverError("same_partner");
  const pair = await tx
    .select({ id: partners.id, status: partners.status, isCentralStock: partners.isCentralStock })
    .from(partners)
    .where(inArray(partners.id, [input.fromPartnerId, input.toPartnerId]));
  const source = pair.find((p) => p.id === input.fromPartnerId);
  const destination = pair.find((p) => p.id === input.toPartnerId);
  if (!source || !destination) throw new HandoverError("partner_not_found");
  if (destination.isCentralStock) throw new HandoverError("partner_is_central_stock");
  if (destination.status !== "ACTIVE") throw new HandoverError("partner_inactive");

  // Friendly per-card answer first (locks the rows in id order); the DB
  // function re-checks every card under the same locks.
  const cards = await evaluateCards(tx, tokens, { lock: true, sourcePartnerId: source.id, destinationPartnerId: destination.id });
  if (cards.some((c) => !c.eligible)) return { ok: false, code: "ineligible", cards };

  const idRows = await tx.select({ id: qrCodes.id }).from(qrCodes).where(inArray(qrCodes.publicToken, tokens));
  const ids = idRows.map((r) => r.id);

  let handoverId: string;
  try {
    const rows = await tx.execute<{ id: string }>(
      sql`select app_admin_transfer_qr_cards(${input.idempotencyKey}::uuid, ${source.id}::uuid, ${destination.id}::uuid, ${`{${ids.join(",")}}`}::uuid[], ${input.note?.trim() || null}) as id`,
    );
    const id = (rows as unknown as { id: string }[])[0]?.id;
    if (!id) throw new HandoverError("create_failed");
    handoverId = id;
  } catch (err) {
    const code = dbErrorCode(err);
    if (code) throw new HandoverError(code);
    throw err;
  }

  return { ok: true, handoverId, quantity: ids.length, duplicate: false, totals: await transferTotals(tx, source.id, destination.id) };
}

/**
 * "Select a batch" instead of scanning: every currently eligible card of one
 * batch (admin only). The handover is still re-checked card by card on submit.
 */
export async function listEligibleBatchTokens(tx: Tx, batchId: string): Promise<string[]> {
  const rows = await tx.execute<{ public_token: string }>(sql`
    select q.public_token from qr_codes q
     where q.batch_id = ${batchId} and q.status = 'AVAILABLE'
       and not exists (select 1 from greetings g where g.qr_code_id = q.id)
       and not exists (select 1 from orders o where o.qr_code_id = q.id)
       and not exists (select 1 from qr_handover_items i where i.qr_code_id = q.id and i.reserved)
     order by q.public_token`);
  return (rows as unknown as { public_token: string }[]).map((r) => r.public_token);
}

/** Batches the admin can pick from, with how many cards are eligible right now. */
export async function listSelectableBatches(tx: Tx) {
  const rows = await tx.execute<{ id: string; label: string; partner_id: string; partner_name: string; is_central: boolean; eligible: number }>(sql`
    select b.id, b.label, b.partner_id, p.name partner_name, p.is_central_stock is_central,
           count(q.id) filter (where q.status = 'AVAILABLE'
             and not exists (select 1 from greetings g where g.qr_code_id = q.id)
             and not exists (select 1 from orders o where o.qr_code_id = q.id)
             and not exists (select 1 from qr_handover_items i where i.qr_code_id = q.id and i.reserved))::int eligible
      from qr_batches b join partners p on p.id = b.partner_id
      left join qr_codes q on q.batch_id = b.id
     group by b.id, p.id
    having count(q.id) > 0
     order by p.is_central_stock desc, p.name, b.created_at`);
  return (rows as unknown as { id: string; label: string; partner_id: string; partner_name: string; is_central: boolean; eligible: number }[]).map((r) => ({
    id: r.id,
    label: r.label,
    partnerId: r.partner_id,
    partnerName: r.partner_name,
    isCentral: r.is_central,
    eligible: r.eligible,
  }));
}

/**
 * Closing a handover left open by the earlier two-step flow (0026). Since
 * 0027 nothing new can be PENDING or DISPUTED, and "send back for
 * confirmation" no longer exists; cancel / reject remain so a legacy
 * handover can be closed explicitly (never auto-accepted).
 */
type AdminTransition = "cancel" | "reject";
const ADMIN_TRANSITIONS: Record<AdminTransition, { from: "PENDING" | "DISPUTED"; to: "CANCELLED" | "REJECTED"; action: string }> = {
  cancel: { from: "PENDING", to: "CANCELLED", action: "QR_HANDOVER_CANCELLED" },
  reject: { from: "DISPUTED", to: "REJECTED", action: "QR_HANDOVER_REJECTED" },
};

/** Admin resolution of a legacy handover. Cancel / reject release the reservations (DB trigger). Idempotent. */
export async function adminTransitionHandover(tx: Tx, adminUserId: string, handoverId: string, transition: AdminTransition, note?: string) {
  const rule = ADMIN_TRANSITIONS[transition];
  const [current] = await tx.select().from(qrHandovers).where(eq(qrHandovers.id, handoverId)).for("update").limit(1);
  if (!current) throw new HandoverError("handover_not_found");
  if (current.status === rule.to) return current;
  if (current.status !== rule.from) throw new HandoverError("handover_wrong_state");

  const [updated] = await tx
    .update(qrHandovers)
    .set({ status: rule.to, resolvedAt: new Date(), resolvedBy: adminUserId, resolvedActorType: "ADMIN" as const, resolutionNote: note?.trim() || null })
    .where(eq(qrHandovers.id, handoverId))
    .returning();

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: rule.action,
    targetType: "qr_handover",
    targetId: handoverId,
    metadata: { toPartnerId: current.toPartnerId, quantity: current.quantity, from: current.status, to: rule.to },
  });
  return updated!;
}

/** The P0001 code raised by the handover functions (the whole PG message), or null. */
function dbErrorCode(err: unknown): string | null {
  const e = err as { message?: string; cause?: { message?: string } };
  for (const message of [e?.cause?.message, e?.message]) {
    const m =
      /^(handover_[a-z_]+(?::\d+)?|partner_inactive|partner_not_found|partner_is_central_stock|same_partner|idempotency_conflict|no_cards|too_many_cards|report_limit|dispute_[a-z_]+)$/.exec(
        message?.trim() ?? "",
      );
    if (m) return m[1]!;
  }
  return null;
}

/**
 * Partner: report that the physical count of a completed transfer does not
 * match. Support only — the cards stay where the admin put them; QR STARR
 * follows up. At most 5 reports per transfer.
 */
export async function partnerReportDiscrepancy(tx: Tx, handoverId: string, receivedCount: number | null, note: string): Promise<{ reportId: string }> {
  try {
    const rows = await tx.execute<{ id: string }>(sql`select app_report_qr_handover_discrepancy(${handoverId}::uuid, ${receivedCount}::int, ${note}) as id`);
    const id = (rows as unknown as { id: string }[])[0]?.id;
    if (!id) throw new HandoverError("report_failed");
    return { reportId: id };
  } catch (err) {
    const code = dbErrorCode(err);
    if (code) throw new HandoverError(code);
    throw err;
  }
}

export type HandoverReportRow = { id: string; handoverId: string; receivedCount: number | null; note: string; createdAt: Date };

/** Discrepancy reports, newest first (RLS: admins see all, a partner its own). */
export async function listHandoverReports(tx: Tx, handoverIds: string[]): Promise<HandoverReportRow[]> {
  if (handoverIds.length === 0) return [];
  return tx
    .select({
      id: qrHandoverReports.id,
      handoverId: qrHandoverReports.handoverId,
      receivedCount: qrHandoverReports.receivedCount,
      note: qrHandoverReports.note,
      createdAt: qrHandoverReports.createdAt,
    })
    .from(qrHandoverReports)
    .where(inArray(qrHandoverReports.handoverId, handoverIds))
    .orderBy(desc(qrHandoverReports.createdAt));
}

export type HandoverStatus = "PENDING" | "DISPUTED" | "ACCEPTED" | "REJECTED" | "CANCELLED";

export type HandoverListRow = {
  id: string;
  toPartnerId: string;
  toPartnerName: string;
  quantity: number;
  status: HandoverStatus;
  createdAt: Date;
  createdBy: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolvedActorType: "ADMIN" | "PARTNER" | "SYSTEM" | null;
  disputeNote: string | null;
  disputeReceivedCount: number | null;
  note: string | null;
};

const listColumns = {
  id: qrHandovers.id,
  toPartnerId: qrHandovers.toPartnerId,
  toPartnerName: partners.name,
  quantity: qrHandovers.quantity,
  status: qrHandovers.status,
  createdAt: qrHandovers.createdAt,
  createdBy: qrHandovers.createdBy,
  resolvedAt: qrHandovers.resolvedAt,
  resolvedBy: qrHandovers.resolvedBy,
  resolvedActorType: qrHandovers.resolvedActorType,
  disputeNote: qrHandovers.disputeNote,
  disputeReceivedCount: qrHandovers.disputeReceivedCount,
  note: qrHandovers.note,
};

const fromPartner = alias(partners, "from_partner");

export type AdminHandoverRow = HandoverListRow & { fromPartnerName: string; fromIsCentral: boolean };
const adminColumns = { ...listColumns, fromPartnerName: fromPartner.name, fromIsCentral: fromPartner.isCentralStock };

/** Admin history, newest first. `q` matches the source or destination partner; `status` filters. */
export async function listHandovers(tx: Tx, filters: { q?: string; status?: HandoverStatus } = {}, limit = 100): Promise<AdminHandoverRow[]> {
  const conditions = [];
  if (filters.status) conditions.push(eq(qrHandovers.status, filters.status));
  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(partners.name, pattern), ilike(partners.slug, pattern), ilike(fromPartner.name, pattern), ilike(fromPartner.slug, pattern))!);
  }
  return tx
    .select(adminColumns)
    .from(qrHandovers)
    .innerJoin(partners, eq(partners.id, qrHandovers.toPartnerId))
    .innerJoin(fromPartner, eq(fromPartner.id, qrHandovers.fromPartnerId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(qrHandovers.createdAt))
    .limit(limit);
}

/**
 * The receiving partner's own handovers (explicitly scoped; RLS enforces it
 * too). Deliberately WITHOUT the source: a partner never learns which other
 * partner the cards came from — the sender is always "QR STARR".
 */
export async function listPartnerHandovers(tx: Tx, partnerId: string, limit = 20): Promise<HandoverListRow[]> {
  return tx
    .select(listColumns)
    .from(qrHandovers)
    .innerJoin(partners, eq(partners.id, qrHandovers.toPartnerId))
    .where(eq(qrHandovers.toPartnerId, partnerId))
    .orderBy(desc(qrHandovers.createdAt))
    .limit(limit);
}

export type HandoverDetail = AdminHandoverRow & {
  disputedAt: Date | null;
  resolutionNote: string | null;
  resultBatchId: string | null;
  items: { hint: string; status: string; ownerName: string; fromBatchLabel: string; reserved: boolean }[];
};

/** Admin detail: the exact cards (token hint only), their current status and holder. No greeting content. */
export async function getHandoverDetail(tx: Tx, handoverId: string): Promise<HandoverDetail | null> {
  const [row] = await tx
    .select({ ...adminColumns, disputedAt: qrHandovers.disputedAt, resolutionNote: qrHandovers.resolutionNote, resultBatchId: qrHandovers.resultBatchId })
    .from(qrHandovers)
    .innerJoin(partners, eq(partners.id, qrHandovers.toPartnerId))
    .innerJoin(fromPartner, eq(fromPartner.id, qrHandovers.fromPartnerId))
    .where(eq(qrHandovers.id, handoverId))
    .limit(1);
  if (!row) return null;
  const items = await tx
    .select({ token: qrCodes.publicToken, status: qrCodes.status, ownerName: partners.name, fromBatchLabel: qrBatches.label, reserved: qrHandoverItems.reserved })
    .from(qrHandoverItems)
    .innerJoin(qrCodes, eq(qrCodes.id, qrHandoverItems.qrCodeId))
    .innerJoin(partners, eq(partners.id, qrCodes.partnerId))
    .innerJoin(qrBatches, eq(qrBatches.id, qrHandoverItems.fromBatchId))
    .where(eq(qrHandoverItems.handoverId, handoverId))
    .orderBy(qrCodes.publicToken);
  return { ...row, items: items.map((i) => ({ hint: tokenHint(i.token), status: i.status, ownerName: i.ownerName, fromBatchLabel: i.fromBatchLabel, reserved: i.reserved })) };
}

/**
 * Platform-wide physical inventory for the admin dashboard. Ownership state
 * (where the card is) and lifecycle status (what the customer did) are
 * reported side by side and never summed into one figure.
 */
export type PhysicalInventorySummary = {
  centralConfigured: boolean;
  generated: number;
  inCentralStock: number;
  centralFree: number;
  reserved: number;
  receivedByPartners: number;
  heldByPartners: number;
  available: number;
  draft: number;
  active: number;
  blocked: number;
  /** Legacy (pre-0027) handovers still open; always 0 once 0027 is applied. */
  pendingHandovers: number;
  disputedHandovers: number;
  /** Partner count-mismatch reports on completed transfers (support only). */
  discrepancyReports: number;
};

export async function getPhysicalInventorySummary(tx: Tx): Promise<PhysicalInventorySummary> {
  const central = await getCentralStockPartner(tx);
  const centralId = central?.id ?? "00000000-0000-0000-0000-000000000000";

  const [cards] = await tx
    .select({
      generated: sql<number>`count(*)::int`,
      inCentral: sql<number>`count(*) filter (where ${qrCodes.partnerId} = ${centralId})::int`,
      available: sql<number>`count(*) filter (where ${qrCodes.status} = 'AVAILABLE')::int`,
      draft: sql<number>`count(*) filter (where ${qrCodes.status} = 'DRAFT')::int`,
      active: sql<number>`count(*) filter (where ${qrCodes.status} = 'ACTIVE')::int`,
      blocked: sql<number>`count(*) filter (where ${qrCodes.status} = 'BLOCKED')::int`,
    })
    .from(qrCodes);

  const [reserved] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(qrHandoverItems)
    .where(eq(qrHandoverItems.reserved, true));

  const [received] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(qrHandoverItems)
    .innerJoin(qrHandovers, eq(qrHandovers.id, qrHandoverItems.handoverId))
    .where(eq(qrHandovers.status, "ACCEPTED"));

  const [open] = await tx
    .select({
      pending: sql<number>`count(*) filter (where ${qrHandovers.status} = 'PENDING')::int`,
      disputed: sql<number>`count(*) filter (where ${qrHandovers.status} = 'DISPUTED')::int`,
    })
    .from(qrHandovers);

  const [reports] = await tx.select({ count: sql<number>`count(*)::int` }).from(qrHandoverReports);

  const generated = cards?.generated ?? 0;
  const inCentralStock = cards?.inCentral ?? 0;
  const reservedCount = reserved?.count ?? 0;
  return {
    centralConfigured: central !== null,
    generated,
    inCentralStock,
    centralFree: Math.max(0, inCentralStock - reservedCount),
    reserved: reservedCount,
    receivedByPartners: received?.count ?? 0,
    heldByPartners: generated - inCentralStock,
    available: cards?.available ?? 0,
    draft: cards?.draft ?? 0,
    active: cards?.active ?? 0,
    blocked: cards?.blocked ?? 0,
    pendingHandovers: open?.pending ?? 0,
    disputedHandovers: open?.disputed ?? 0,
    discrepancyReports: reports?.count ?? 0,
  };
}

/** For the partner picker: active partners other than central stock. */
export async function listAssignablePartners(tx: Tx) {
  return tx
    .select({ id: partners.id, name: partners.name, slug: partners.slug })
    .from(partners)
    .where(and(eq(partners.status, "ACTIVE"), eq(partners.isCentralStock, false)))
    .orderBy(partners.name);
}

/** Batch label lookup for a handover's resulting batch (admin detail link). */
export async function getBatchPartner(tx: Tx, batchId: string) {
  const [row] = await tx.select({ partnerId: qrBatches.partnerId }).from(qrBatches).where(eq(qrBatches.id, batchId)).limit(1);
  return row ?? null;
}

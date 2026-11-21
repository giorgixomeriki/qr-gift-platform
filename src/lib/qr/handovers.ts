import "server-only";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { greetings, orders, partners, qrBatches, qrCodes, qrHandoverItems, qrHandovers } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import { tokenHint } from "./scan-parse";

/**
 * Scan-to-Assign (migrations/0026). Physical cards printed for QR STARR's
 * central stock are scanned by an admin into a handover for one partner;
 * the partner confirms receipt and only then do the cards change owner.
 *
 *   scan ≠ handover ≠ receipt ≠ sale
 *
 * Nothing here touches qr_codes.status, greetings, orders, payments, the
 * partner ledger or analytics. Every rule is re-checked by the database
 * (RLS, triggers, app_accept_qr_handover), so this module is the friendly
 * first layer, not the enforcement boundary.
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
  | "no_central_stock"
  | "assigned_to_partner"
  | "draft"
  | "active"
  | "blocked"
  | "has_history"
  | "reserved";

export type CardEligibility =
  | { token: string; hint: string; eligible: true }
  | { token: string; hint: string; eligible: false; reason: IneligibleReason; partnerName?: string };

export async function getCentralStockPartner(tx: Tx) {
  const [row] = await tx
    .select({ id: partners.id, name: partners.name, status: partners.status })
    .from(partners)
    .where(eq(partners.isCentralStock, true))
    .limit(1);
  return row ?? null;
}

/**
 * Creates the central-stock partner the first time it is needed. SUSPENDED by
 * design: a card still in central stock resolves as unavailable on /g/{token}
 * (lib/qr/resolve-state.ts), so a card lost before handover can't be started
 * or sold. The owner can reactivate it from the partner page if ever wanted.
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
 * Eligibility of each token for a NEW handover. With `lock`, the card rows are
 * locked FOR UPDATE first (in id order, so two concurrent submissions can't
 * deadlock), which is what makes the check authoritative at submission.
 */
export async function evaluateCards(tx: Tx, tokens: string[], opts: { lock?: boolean } = {}): Promise<CardEligibility[]> {
  if (tokens.length === 0) return [];
  const central = await getCentralStockPartner(tx);

  if (opts.lock) {
    await tx.execute(
      sql`select id from qr_codes where public_token in ${tokens} order by id for update`,
    );
  }

  const cards = await tx
    .select({ id: qrCodes.id, token: qrCodes.publicToken, partnerId: qrCodes.partnerId, status: qrCodes.status, partnerName: partners.name })
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
    if (card.status === "BLOCKED") return { token, hint, eligible: false, reason: "blocked" };
    if (card.status === "ACTIVE") return { token, hint, eligible: false, reason: "active" };
    if (card.status === "DRAFT") return { token, hint, eligible: false, reason: "draft" };
    if (!central) return { token, hint, eligible: false, reason: "no_central_stock" };
    if (card.partnerId !== central.id) return { token, hint, eligible: false, reason: "assigned_to_partner", partnerName: card.partnerName };
    if (withGreeting.has(card.id) || withOrder.has(card.id)) return { token, hint, eligible: false, reason: "has_history" };
    const reservedFor = reservations.get(card.id);
    if (reservedFor !== undefined) return { token, hint, eligible: false, reason: "reserved", partnerName: reservedFor };
    return { token, hint, eligible: true };
  });
}

export type CreateHandoverInput = {
  idempotencyKey: string;
  toPartnerId: string;
  tokens: string[];
  note?: string;
};

export type CreateHandoverResult =
  | { ok: true; handoverId: string; quantity: number; duplicate: boolean }
  | { ok: false; code: "ineligible"; cards: CardEligibility[] };

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/**
 * Creates a PENDING handover that reserves exactly these cards. All-or-
 * nothing: one ineligible card refuses the whole request and nothing is
 * written. A repeat with the same idempotency key returns the first result.
 */
export async function createHandover(tx: Tx, adminUserId: string, input: CreateHandoverInput): Promise<CreateHandoverResult> {
  const tokens = [...new Set(input.tokens)];
  if (tokens.length === 0) throw new HandoverError("no_cards");
  if (tokens.length > HANDOVER_MAX_CARDS) throw new HandoverError("too_many_cards");

  // Same-key submissions (double tap, retry after a dropped response) are
  // serialized here, so the second one always sees the first one's result.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`qr_handover:${input.idempotencyKey}`}, 0))`);
  const [previous] = await tx
    .select({ id: qrHandovers.id, quantity: qrHandovers.quantity, toPartnerId: qrHandovers.toPartnerId })
    .from(qrHandovers)
    .where(eq(qrHandovers.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (previous) {
    if (previous.toPartnerId !== input.toPartnerId) throw new HandoverError("idempotency_conflict");
    return { ok: true, handoverId: previous.id, quantity: previous.quantity, duplicate: true };
  }

  const central = await getCentralStockPartner(tx);
  if (!central) throw new HandoverError("no_central_stock");

  const [destination] = await tx
    .select({ id: partners.id, status: partners.status, isCentralStock: partners.isCentralStock })
    .from(partners)
    .where(eq(partners.id, input.toPartnerId))
    .limit(1);
  if (!destination) throw new HandoverError("partner_not_found");
  if (destination.isCentralStock) throw new HandoverError("partner_is_central_stock");
  if (destination.status !== "ACTIVE") throw new HandoverError("partner_inactive");

  const cards = await evaluateCards(tx, tokens, { lock: true });
  if (cards.some((c) => !c.eligible)) return { ok: false, code: "ineligible", cards };

  const idRows = await tx.select({ id: qrCodes.id }).from(qrCodes).where(inArray(qrCodes.publicToken, tokens));

  let handoverId: string;
  try {
    // A savepoint, so a lost race on the idempotency key or a reservation
    // leaves the outer transaction usable for the friendly answer below.
    handoverId = await tx.transaction(async (sp) => {
      const [created] = await sp
        .insert(qrHandovers)
        .values({
          fromPartnerId: central.id,
          toPartnerId: destination.id,
          quantity: idRows.length,
          idempotencyKey: input.idempotencyKey,
          note: input.note?.trim() || null,
          createdBy: adminUserId,
        })
        .returning({ id: qrHandovers.id });
      if (!created) throw new HandoverError("create_failed");
      await sp.insert(qrHandoverItems).values(idRows.map((r) => ({ handoverId: created.id, qrCodeId: r.id })));
      return created.id;
    });
  } catch (err) {
    if (pgCode(err) === "23505") {
      const [raced] = await tx
        .select({ id: qrHandovers.id, quantity: qrHandovers.quantity })
        .from(qrHandovers)
        .where(eq(qrHandovers.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (raced) return { ok: true, handoverId: raced.id, quantity: raced.quantity, duplicate: true };
      return { ok: false, code: "ineligible", cards: await evaluateCards(tx, tokens) };
    }
    throw err;
  }

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "QR_HANDOVER_CREATED",
    targetType: "qr_handover",
    targetId: handoverId,
    metadata: { fromPartnerId: central.id, toPartnerId: destination.id, quantity: idRows.length, qrCodeIds: idRows.map((r) => r.id) },
  });

  return { ok: true, handoverId, quantity: idRows.length, duplicate: false };
}

type AdminTransition = "cancel" | "reopen" | "reject";
const ADMIN_TRANSITIONS: Record<AdminTransition, { from: "PENDING" | "DISPUTED"; to: "CANCELLED" | "PENDING" | "REJECTED"; action: string }> = {
  cancel: { from: "PENDING", to: "CANCELLED", action: "QR_HANDOVER_CANCELLED" },
  reopen: { from: "DISPUTED", to: "PENDING", action: "QR_HANDOVER_REOPENED" },
  reject: { from: "DISPUTED", to: "REJECTED", action: "QR_HANDOVER_REJECTED" },
};

/** Admin resolution. Cancel / reject release the reservations (DB trigger). Idempotent. */
export async function adminTransitionHandover(tx: Tx, adminUserId: string, handoverId: string, transition: AdminTransition, note?: string) {
  const rule = ADMIN_TRANSITIONS[transition];
  const [current] = await tx.select().from(qrHandovers).where(eq(qrHandovers.id, handoverId)).for("update").limit(1);
  if (!current) throw new HandoverError("handover_not_found");
  if (current.status === rule.to) return current;
  if (current.status !== rule.from) throw new HandoverError("handover_wrong_state");

  const terminal = rule.to !== "PENDING";
  const [updated] = await tx
    .update(qrHandovers)
    .set({
      status: rule.to,
      ...(terminal
        ? { resolvedAt: new Date(), resolvedBy: adminUserId, resolvedActorType: "ADMIN" as const, resolutionNote: note?.trim() || null }
        : {}),
    })
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

/** The P0001 code raised by app_accept_qr_handover / app_dispute_qr_handover (the whole PG message), or null. */
function dbErrorCode(err: unknown): string | null {
  const e = err as { message?: string; cause?: { message?: string } };
  for (const message of [e?.cause?.message, e?.message]) {
    const m = /^(handover_[a-z_]+(?::\d+)?|partner_inactive|dispute_[a-z_]+)$/.exec(message?.trim() ?? "");
    if (m) return m[1]!;
  }
  return null;
}

/** Partner: confirm receipt (atomic ownership change in the database). */
export async function partnerAcceptHandover(tx: Tx, handoverId: string): Promise<{ batchId: string }> {
  try {
    const rows = await tx.execute<{ batch_id: string }>(sql`select app_accept_qr_handover(${handoverId}::uuid) as batch_id`);
    const batchId = (rows as unknown as { batch_id: string }[])[0]?.batch_id;
    if (!batchId) throw new HandoverError("accept_failed");
    return { batchId };
  } catch (err) {
    const code = dbErrorCode(err);
    if (code) throw new HandoverError(code);
    throw err;
  }
}

/** Partner: report a discrepancy (keeps the reservation for the admin). */
export async function partnerDisputeHandover(tx: Tx, handoverId: string, receivedCount: number | null, note: string) {
  try {
    await tx.execute(sql`select app_dispute_qr_handover(${handoverId}::uuid, ${receivedCount}::int, ${note})`);
  } catch (err) {
    const code = dbErrorCode(err);
    if (code) throw new HandoverError(code);
    throw err;
  }
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

/** Admin history, newest first. `q` matches the partner name; `status` filters. */
export async function listHandovers(tx: Tx, filters: { q?: string; status?: HandoverStatus } = {}, limit = 100): Promise<HandoverListRow[]> {
  const conditions = [];
  if (filters.status) conditions.push(eq(qrHandovers.status, filters.status));
  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(partners.name, pattern), ilike(partners.slug, pattern))!);
  }
  return tx
    .select(listColumns)
    .from(qrHandovers)
    .innerJoin(partners, eq(partners.id, qrHandovers.toPartnerId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(qrHandovers.createdAt))
    .limit(limit);
}

/** The receiving partner's own handovers (explicitly scoped; RLS enforces it too). */
export async function listPartnerHandovers(tx: Tx, partnerId: string, limit = 20): Promise<HandoverListRow[]> {
  return tx
    .select(listColumns)
    .from(qrHandovers)
    .innerJoin(partners, eq(partners.id, qrHandovers.toPartnerId))
    .where(eq(qrHandovers.toPartnerId, partnerId))
    .orderBy(desc(qrHandovers.createdAt))
    .limit(limit);
}

export type HandoverDetail = HandoverListRow & {
  disputedAt: Date | null;
  resolutionNote: string | null;
  resultBatchId: string | null;
  items: { hint: string; status: string; ownerName: string; reserved: boolean }[];
};

/** Admin detail: the exact cards (token hint only), their current status and holder. No greeting content. */
export async function getHandoverDetail(tx: Tx, handoverId: string): Promise<HandoverDetail | null> {
  const [row] = await tx
    .select({ ...listColumns, disputedAt: qrHandovers.disputedAt, resolutionNote: qrHandovers.resolutionNote, resultBatchId: qrHandovers.resultBatchId })
    .from(qrHandovers)
    .innerJoin(partners, eq(partners.id, qrHandovers.toPartnerId))
    .where(eq(qrHandovers.id, handoverId))
    .limit(1);
  if (!row) return null;
  const items = await tx
    .select({ token: qrCodes.publicToken, status: qrCodes.status, ownerName: partners.name, reserved: qrHandoverItems.reserved })
    .from(qrHandoverItems)
    .innerJoin(qrCodes, eq(qrCodes.id, qrHandoverItems.qrCodeId))
    .innerJoin(partners, eq(partners.id, qrCodes.partnerId))
    .where(eq(qrHandoverItems.handoverId, handoverId))
    .orderBy(qrCodes.publicToken);
  return { ...row, items: items.map((i) => ({ hint: tokenHint(i.token), status: i.status, ownerName: i.ownerName, reserved: i.reserved })) };
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
  pendingHandovers: number;
  disputedHandovers: number;
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

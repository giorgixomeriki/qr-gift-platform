import "server-only";
import { and, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { orders, partnerLedgerEntries, partnerPayouts, partnerPayoutItems } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import { BUSINESS_TIME_ZONE, isPeriodClosed } from "@/lib/business-calendar";

export class PayoutError extends Error {}

/**
 * Unpaid balance for one partner+currency = plain SUM(amount_minor) — the
 * ledger's own top-level invariant (see partner-ledger.ts's schema doc
 * comment). Still the hard cap on any payout. Since migrations/0014 every new
 * payout also records exactly which ledger rows it settled
 * (partner_payout_items), so for itemized history the balance equals the sum
 * of unsettled rows; legacy (pre-0014) payouts are the only part of the
 * balance without a row-level breakdown.
 */
export async function getPartnerUnpaidBalance(tx: Tx, partnerId: string, currency: string): Promise<number> {
  const [row] = await tx
    .select({
      unpaid: sql<number>`coalesce(sum(${partnerLedgerEntries.amountMinor}), 0)::int`,
    })
    .from(partnerLedgerEntries)
    .where(and(eq(partnerLedgerEntries.partnerId, partnerId), eq(partnerLedgerEntries.currency, currency)));
  return row?.unpaid ?? 0;
}

/**
 * Where a ledger row stands for a payout covering the requested period:
 *   ELIGIBLE  unpaid commission / adjustment booked in the period — will be paid
 *   CLAWBACK  reversal of a commission an earlier payout already paid
 *             (refund after payout) — netted into this payout, negative
 *   REVERSED  commission refunded before it was paid, or that refund's own
 *             reversal — the pair nets to zero, neither is ever paid
 *   PAID      already settled by payout `paidByPayoutId`
 */
export type PayoutCandidateState = "ELIGIBLE" | "CLAWBACK" | "REVERSED" | "PAID";

export type PayoutCandidate = {
  ledgerEntryId: string;
  type: "COMMISSION_EARNED" | "COMMISSION_REVERSAL" | "ADJUSTMENT";
  amountMinor: number;
  bookedAt: Date;
  orderId: string | null;
  orderPaidAt: Date | null;
  grossAmountMinor: number | null;
  qrPublicToken: string | null;
  batchLabel: string | null;
  state: PayoutCandidateState;
  paidByPayoutId: string | null;
};

/** Why a payout for this period can't be created right now (null = it can). */
export type PayoutBlocker = "PERIOD_INVALID" | "PERIOD_NOT_CLOSED" | "PERIOD_OVERLAPS_PAYOUT" | "NOTHING_PAYABLE" | "EXCEEDS_BALANCE";

export type PayoutStatement = {
  partnerId: string;
  currency: string;
  periodFrom: Date;
  periodTo: Date;
  /** Orders paid in the period that are still PAID (refunded ones are excluded). */
  paidActivations: number;
  grossSalesMinor: number;
  /** COMMISSION_EARNED booked in the period. */
  commissionEarnedMinor: number;
  /** COMMISSION_REVERSAL booked in the period, as a positive number. */
  commissionReversedMinor: number;
  /** Earned minus reversed in the period. */
  netCommissionMinor: number;
  /** All-time unpaid balance right now — the hard cap on any payout. */
  unpaidBalanceMinor: number;
  /** Exact amount a payout for this period would be: SUM of the ELIGIBLE + CLAWBACK rows. */
  payableMinor: number;
  /** The exact ledger rows that payout would settle. */
  eligibleLedgerEntryIds: string[];
  /** Rows excluded because the sale was refunded before payout. */
  reversedCount: number;
  /** Rows in the period already settled by an earlier payout. */
  alreadyPaidCount: number;
  candidates: PayoutCandidate[];
  /** Existing payouts whose period overlaps this one (legacy ones included). */
  overlappingPayoutIds: string[];
  blocker: PayoutBlocker | null;
};

type CandidateRow = {
  ledger_entry_id: string;
  type: PayoutCandidate["type"];
  amount_minor: number;
  booked_at: Date;
  order_id: string | null;
  order_paid_at: Date | null;
  gross_amount_minor: number | null;
  public_token: string | null;
  batch_label: string | null;
  paid_by_payout_id: string | null;
  order_reversed: boolean;
  earning_paid_by_payout_id: string | null;
};

/**
 * "Why do we owe this partner this amount for this period?" — and the exact
 * ledger rows a payout would settle. The period is a HALF-OPEN range of UTC
 * instants [periodFrom, periodTo); the admin action builds it from whole
 * business days in the business timezone (lib/business-calendar.ts), so
 * consecutive periods tile time exactly — every booking belongs to one.
 * Built only from stored ledger rows and order snapshots, never recomputed
 * from today's prices or rates. Commissions are selected whole — a payout
 * never pays part of a commission.
 */
export async function getPartnerPayoutStatement(
  tx: Tx,
  input: { partnerId: string; currency: string; periodFrom: Date; periodTo: Date },
): Promise<PayoutStatement> {
  const { partnerId, currency, periodFrom, periodTo } = input;

  const [sales] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      gross: sql<number>`coalesce(sum(${orders.grossAmountMinor}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.partnerId, partnerId),
        eq(orders.currency, currency),
        eq(orders.status, "PAID"),
        gte(orders.paidAt, periodFrom),
        lt(orders.paidAt, periodTo),
      ),
    );

  // Rows booked in the period, plus any still-unsettled reversal booked
  // before the period end (a claw-back is never skipped just because the refund
  // happened before this period started).
  const rows = await tx.execute<CandidateRow>(sql`
    select l.id as ledger_entry_id, l.type, l.amount_minor, l.created_at as booked_at,
           o.id as order_id, o.paid_at as order_paid_at, o.gross_amount_minor,
           q.public_token, b.label as batch_label,
           i.payout_id as paid_by_payout_id,
           exists (
             select 1 from partner_ledger_entries r
              where r.order_id = l.order_id and r.type = 'COMMISSION_REVERSAL'
           ) as order_reversed,
           (select ei.payout_id from partner_ledger_entries e
              join partner_payout_items ei on ei.ledger_entry_id = e.id
             where e.order_id = l.order_id and e.type = 'COMMISSION_EARNED') as earning_paid_by_payout_id
      from partner_ledger_entries l
      left join partner_payout_items i on i.ledger_entry_id = l.id
      left join orders o on o.id = l.order_id
      left join qr_codes q on q.id = o.qr_code_id
      left join qr_batches b on b.id = q.batch_id
     where l.partner_id = ${partnerId}::uuid and l.currency = ${currency} and l.type <> 'PAYOUT'
       and (
         (l.created_at >= ${periodFrom.toISOString()}::timestamptz and l.created_at < ${periodTo.toISOString()}::timestamptz)
         or (l.type = 'COMMISSION_REVERSAL' and i.payout_id is null and l.created_at < ${periodTo.toISOString()}::timestamptz)
       )
     order by l.created_at, l.id
  `);

  const candidates: PayoutCandidate[] = rows.map((r) => {
    let state: PayoutCandidateState;
    if (r.paid_by_payout_id) state = "PAID";
    else if (r.type === "COMMISSION_EARNED") state = r.order_reversed ? "REVERSED" : "ELIGIBLE";
    else if (r.type === "COMMISSION_REVERSAL") state = r.earning_paid_by_payout_id ? "CLAWBACK" : "REVERSED";
    else state = "ELIGIBLE";
    return {
      ledgerEntryId: r.ledger_entry_id,
      type: r.type,
      amountMinor: r.amount_minor,
      bookedAt: new Date(r.booked_at),
      orderId: r.order_id,
      orderPaidAt: r.order_paid_at ? new Date(r.order_paid_at) : null,
      grossAmountMinor: r.gross_amount_minor,
      qrPublicToken: r.public_token,
      batchLabel: r.batch_label,
      state,
      paidByPayoutId: r.paid_by_payout_id,
    };
  });

  const inPeriod = (c: PayoutCandidate) => c.bookedAt >= periodFrom && c.bookedAt < periodTo;
  const commissionEarnedMinor = candidates
    .filter((c) => c.type === "COMMISSION_EARNED" && inPeriod(c))
    .reduce((sum, c) => sum + c.amountMinor, 0);
  // `|| 0` normalizes -0 (negating an empty sum) so it never renders as "-0.00".
  const commissionReversedMinor =
    -candidates.filter((c) => c.type === "COMMISSION_REVERSAL" && inPeriod(c)).reduce((sum, c) => sum + c.amountMinor, 0) || 0;

  const payable = candidates.filter((c) => c.state === "ELIGIBLE" || c.state === "CLAWBACK");
  const payableMinor = payable.reduce((sum, c) => sum + c.amountMinor, 0);

  const overlapping = await tx
    .select({ id: partnerPayouts.id })
    .from(partnerPayouts)
    .where(
      and(
        eq(partnerPayouts.partnerId, partnerId),
        eq(partnerPayouts.currency, currency),
        // Half-open overlap, matching the '[)' exclusion constraint (migrations/0015).
        lt(partnerPayouts.periodFrom, periodTo),
        gt(partnerPayouts.periodTo, periodFrom),
      ),
    );

  const unpaidBalanceMinor = await getPartnerUnpaidBalance(tx, partnerId, currency);

  let blocker: PayoutBlocker | null = null;
  if (periodFrom >= periodTo) blocker = "PERIOD_INVALID";
  else if (!isPeriodClosed(periodTo)) blocker = "PERIOD_NOT_CLOSED";
  else if (overlapping.length > 0) blocker = "PERIOD_OVERLAPS_PAYOUT";
  else if (payable.length === 0 || payableMinor <= 0) blocker = "NOTHING_PAYABLE";
  else if (payableMinor > unpaidBalanceMinor) blocker = "EXCEEDS_BALANCE";

  return {
    partnerId,
    currency,
    periodFrom,
    periodTo,
    paidActivations: sales?.count ?? 0,
    grossSalesMinor: sales?.gross ?? 0,
    commissionEarnedMinor,
    commissionReversedMinor,
    netCommissionMinor: commissionEarnedMinor - commissionReversedMinor,
    unpaidBalanceMinor,
    payableMinor,
    eligibleLedgerEntryIds: payable.map((c) => c.ledgerEntryId),
    reversedCount: candidates.filter((c) => c.state === "REVERSED").length,
    alreadyPaidCount: candidates.filter((c) => c.state === "PAID").length,
    candidates,
    overlappingPayoutIds: overlapping.map((p) => p.id),
    blocker,
  };
}

const BLOCKER_MESSAGES: Record<PayoutBlocker, string> = {
  PERIOD_INVALID: "periodFrom must be before periodTo",
  PERIOD_NOT_CLOSED: `The payout period must have ended (business days end at midnight ${BUSINESS_TIME_ZONE}) — commissions can still arrive in a period that hasn't closed`,
  PERIOD_OVERLAPS_PAYOUT: "A payout already exists for an overlapping period — this looks like a duplicate",
  NOTHING_PAYABLE: "Nothing is payable for this period",
  EXCEEDS_BALANCE: "Payable commissions exceed the partner's unpaid balance (legacy payouts without item breakdown) — resolve manually",
};

/**
 * Manual payout (Phase 5 §16, itemized since migrations/0014) — records that
 * an admin ALREADY paid a partner outside the platform; bookkeeping, never a
 * real money movement. Runs inside the caller's admin transaction (RLS:
 * app_is_admin() on partner_payouts, partner_payout_items and the PAYOUT
 * ledger insert).
 *
 * The amount is NEVER taken from the client. Under the per-partner balance
 * lock the server recomputes the period statement and pays exactly its
 * eligible rows (whole commissions only); the admin's `expectedAmountMinor`
 * and `expectedLedgerEntryIds` — what the confirmed statement showed — must
 * match it exactly, otherwise nothing is written ("statement changed",
 * e.g. a concurrent payout claimed those rows or a refund landed). One
 * transaction writes payout + items + PAYOUT ledger row; the deferred DB
 * check rejects the COMMIT unless amount = SUM(items) = -PAYOUT row.
 *
 * Guarantees behind "never paid twice": partner_payout_items' primary key on
 * ledger_entry_id (one payout per ledger row, ever), the overlap exclusion
 * constraint (migrations/0008), the balance trigger (0013), and the
 * advisory lock serializing concurrent payouts for the same partner.
 */
export async function recordManualPayout(
  tx: Tx,
  adminUserId: string,
  input: {
    partnerId: string;
    currency: string;
    periodFrom: Date;
    periodTo: Date;
    expectedAmountMinor: number;
    expectedLedgerEntryIds: string[];
    reference?: string;
  },
) {
  // Serializes every payout for this partner+currency until commit, so a
  // concurrent payout can't claim the same rows between our read and write.
  await tx.execute(sql`select app_lock_partner_balance(${input.partnerId}::uuid, ${input.currency})`);

  const statement = await getPartnerPayoutStatement(tx, input);
  if (statement.blocker) throw new PayoutError(BLOCKER_MESSAGES[statement.blocker]);

  const expectedIds = [...new Set(input.expectedLedgerEntryIds)].sort();
  const actualIds = [...statement.eligibleLedgerEntryIds].sort();
  if (
    input.expectedAmountMinor !== statement.payableMinor ||
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, i) => id !== actualIds[i])
  ) {
    throw new PayoutError(
      `The payout statement changed (server: ${statement.payableMinor} across ${actualIds.length} items; requested: ${input.expectedAmountMinor} across ${expectedIds.length}) — refresh and confirm again`,
    );
  }

  let payout: typeof partnerPayouts.$inferSelect | undefined;
  try {
    [payout] = await tx
      .insert(partnerPayouts)
      .values({
        partnerId: input.partnerId,
        currency: input.currency,
        amountMinor: statement.payableMinor,
        status: "PAID",
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        reference: input.reference,
        itemized: true,
        paidAt: sql`now()`,
      })
      .returning();
  } catch (err) {
    // 23P01 = exclusion_violation (migrations/0008) — surfaced as the same
    // friendly error as the statement's overlap pre-check.
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23P01") {
      throw new PayoutError(BLOCKER_MESSAGES.PERIOD_OVERLAPS_PAYOUT);
    }
    throw err;
  }
  if (!payout) throw new PayoutError("Failed to record payout — not authorized");

  await tx.insert(partnerPayoutItems).values(
    actualIds.map((ledgerEntryId) => ({ ledgerEntryId, payoutId: payout.id, partnerId: input.partnerId, currency: input.currency })),
  );

  await tx.insert(partnerLedgerEntries).values({
    partnerId: input.partnerId,
    payoutId: payout.id,
    type: "PAYOUT",
    amountMinor: -statement.payableMinor,
    currency: input.currency,
  });

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_PAYOUT_RECORDED",
    targetType: "partner_payout",
    targetId: payout.id,
    metadata: { partnerId: input.partnerId, amountMinor: statement.payableMinor, currency: input.currency, itemCount: actualIds.length, reference: input.reference },
  });

  return payout;
}

export async function listPartnerPayouts(tx: Tx, partnerId: string) {
  return tx
    .select()
    .from(partnerPayouts)
    .where(eq(partnerPayouts.partnerId, partnerId))
    .orderBy(sql`${partnerPayouts.periodFrom} desc`);
}

export type PayoutItemDetail = {
  ledgerEntryId: string;
  type: "COMMISSION_EARNED" | "COMMISSION_REVERSAL" | "ADJUSTMENT";
  amountMinor: number;
  bookedAt: Date;
  orderId: string | null;
  orderPaidAt: Date | null;
  grossAmountMinor: number | null;
  qrPublicToken: string | null;
  batchLabel: string | null;
  /** For a paid commission: the refund reversal booked AFTER this payout, if any (history is never rewritten). */
  laterReversalMinor: number | null;
  /** ...and the later payout that netted that reversal, if it has been settled. */
  laterReversalSettledByPayoutId: string | null;
};

export type PayoutDetail = typeof partnerPayouts.$inferSelect & {
  items: PayoutItemDetail[];
  /** COMMISSION_EARNED items = sales paid by this payout. */
  paidSalesCount: number;
};

/**
 * Payouts with their exact settled ledger rows (newest first). Read inside an
 * admin or partner transaction; RLS scopes everything to rows the caller may
 * see. Never selects greeting content. Legacy payouts come back with
 * itemized = false and no items.
 */
export async function listPartnerPayoutsWithItems(tx: Tx, partnerId: string): Promise<PayoutDetail[]> {
  const payouts = await tx
    .select()
    .from(partnerPayouts)
    .where(eq(partnerPayouts.partnerId, partnerId))
    .orderBy(desc(partnerPayouts.periodFrom));
  if (payouts.length === 0) return [];

  const payoutIds = payouts.map((p) => p.id);
  const itemRows = await tx.execute<{
    payout_id: string;
    ledger_entry_id: string;
    type: PayoutItemDetail["type"];
    amount_minor: number;
    booked_at: Date;
    order_id: string | null;
    order_paid_at: Date | null;
    gross_amount_minor: number | null;
    public_token: string | null;
    batch_label: string | null;
    later_reversal_minor: number | null;
    later_reversal_payout_id: string | null;
  }>(sql`
    select i.payout_id, l.id as ledger_entry_id, l.type, l.amount_minor, l.created_at as booked_at,
           o.id as order_id, o.paid_at as order_paid_at, o.gross_amount_minor,
           q.public_token, b.label as batch_label,
           r.amount_minor as later_reversal_minor, ri.payout_id as later_reversal_payout_id
      from partner_payout_items i
      join partner_ledger_entries l on l.id = i.ledger_entry_id
      left join orders o on o.id = l.order_id
      left join qr_codes q on q.id = o.qr_code_id
      left join qr_batches b on b.id = q.batch_id
      left join partner_ledger_entries r on l.type = 'COMMISSION_EARNED' and r.order_id = l.order_id and r.type = 'COMMISSION_REVERSAL'
      left join partner_payout_items ri on ri.ledger_entry_id = r.id
     where i.payout_id in ${payoutIds}
     order by l.created_at, l.id
  `);

  return payouts.map((p) => {
    const items: PayoutItemDetail[] = itemRows
      .filter((r) => r.payout_id === p.id)
      .map((r) => ({
        ledgerEntryId: r.ledger_entry_id,
        type: r.type,
        amountMinor: r.amount_minor,
        bookedAt: new Date(r.booked_at),
        orderId: r.order_id,
        orderPaidAt: r.order_paid_at ? new Date(r.order_paid_at) : null,
        grossAmountMinor: r.gross_amount_minor,
        qrPublicToken: r.public_token,
        batchLabel: r.batch_label,
        laterReversalMinor: r.later_reversal_minor,
        laterReversalSettledByPayoutId: r.later_reversal_payout_id,
      }));
    return { ...p, items, paidSalesCount: items.filter((i) => i.type === "COMMISSION_EARNED").length };
  });
}

/** Which payout settled this ledger row, if any — the reverse lookup ("which payout paid commission C?"). */
export async function findPayoutForLedgerEntry(tx: Tx, ledgerEntryId: string): Promise<string | null> {
  const [row] = await tx
    .select({ payoutId: partnerPayoutItems.payoutId })
    .from(partnerPayoutItems)
    .where(eq(partnerPayoutItems.ledgerEntryId, ledgerEntryId))
    .limit(1);
  return row?.payoutId ?? null;
}

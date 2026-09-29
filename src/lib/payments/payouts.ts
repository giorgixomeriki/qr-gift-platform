import "server-only";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { partnerLedgerEntries, partnerPayouts } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";

export class PayoutError extends Error {}

/**
 * Unpaid balance for one partner+currency = plain SUM(amount_minor) — the
 * ledger's own top-level invariant (see partner-ledger.ts's schema doc
 * comment: "Balance for a partner+currency = SUM(amount_minor)"),
 * deliberately NOT "WHERE payout_id IS NULL".
 *
 * That filtered form would require UPDATEing payout_id onto the original
 * COMMISSION_EARNED rows a payout sweeps up — but partner_ledger_entries has
 * no UPDATE RLS policy at all, for anyone, by design (append-only; see
 * verify-phase5-security.ts's "ledger is append-only even for an admin"
 * check). Given that, a plain signed-sum is not just simpler but the only
 * formula that's actually consistent with what recordManualPayout can
 * legally do: insert a negative PAYOUT row and nothing else. payoutId on the
 * PAYOUT row itself remains useful for "show me everything recorded
 * alongside payout X", just not for computing balance.
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
 * Manual payout V1 (Phase 5 §16) — records that an admin ALREADY paid a
 * partner outside the platform (bank transfer, cash, whatever); this is
 * bookkeeping, never a real money movement. Runs inside the caller's
 * admin-scoped transaction (requireAdmin), which is also what
 * partner_payouts_insert/partner_ledger_entries_insert's RLS policies key
 * off (app_is_admin()) — see migrations/0003_commercial_rls.sql.
 *
 * Duplicate protection: rather than a client-supplied idempotency key (a new
 * concept this schema doesn't have), a payout's periodFrom/periodTo — which
 * the schema already carries — may never overlap another payout for the
 * same partner+currency. Two payouts both claiming "commission earned in
 * January" for the same partner is exactly what "duplicate payout" means in
 * this ledger model, and this makes it structurally impossible, not just
 * discouraged. This check-then-insert happens inside one transaction, which
 * is safe against a single admin double-submitting but not against two
 * admins racing the exact same period simultaneously — a real DB exclusion
 * constraint would close that gap too; not added here as one admin console
 * with low write concurrency doesn't yet justify it (see the `db:generate`
 * follow-up idea in the launch checklist if pilot payout volume grows).
 */
export async function recordManualPayout(
  tx: Tx,
  adminUserId: string,
  input: {
    partnerId: string;
    currency: string;
    amountMinor: number;
    periodFrom: Date;
    periodTo: Date;
    reference?: string;
  },
) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new PayoutError("Payout amount must be a positive integer (minor units)");
  }
  if (input.periodFrom >= input.periodTo) {
    throw new PayoutError("periodFrom must be before periodTo");
  }

  const overlapping = await tx
    .select({ id: partnerPayouts.id })
    .from(partnerPayouts)
    .where(
      and(
        eq(partnerPayouts.partnerId, input.partnerId),
        eq(partnerPayouts.currency, input.currency),
        lt(partnerPayouts.periodFrom, input.periodTo),
        gt(partnerPayouts.periodTo, input.periodFrom),
      ),
    )
    .limit(1);
  if (overlapping.length > 0) {
    throw new PayoutError("A payout already exists for an overlapping period — this looks like a duplicate");
  }

  const unpaidBalance = await getPartnerUnpaidBalance(tx, input.partnerId, input.currency);
  if (input.amountMinor > unpaidBalance) {
    throw new PayoutError(`Payout amount (${input.amountMinor}) exceeds unpaid balance (${unpaidBalance})`);
  }

  let payout: typeof partnerPayouts.$inferSelect | undefined;
  try {
    [payout] = await tx
      .insert(partnerPayouts)
      .values({
        partnerId: input.partnerId,
        currency: input.currency,
        amountMinor: input.amountMinor,
        status: "PAID",
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        reference: input.reference,
        paidAt: sql`now()`,
      })
      .returning();
  } catch (err) {
    // 23P01 = exclusion_violation — the real backstop behind the overlap
    // check above (migrations/0008_payout_period_exclusion.sql): two
    // concurrent calls can both pass that SELECT-based pre-check before
    // either commits, but only one of their INSERTs can satisfy the DB
    // constraint. Surfaced as the same friendly error either way.
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23P01") {
      throw new PayoutError("A payout already exists for an overlapping period — this looks like a duplicate");
    }
    throw err;
  }
  if (!payout) throw new PayoutError("Failed to record payout — not authorized");

  // Negative PAYOUT entry — this is what reduces the balance (see
  // getPartnerUnpaidBalance's doc comment for why this is a plain signed
  // sum, not a payout_id-filtered one). payoutId here just lets a later
  // query reconstruct "what was recorded for payout X"; it does not mark
  // any other row as consumed, since nothing else can ever be UPDATEd.
  await tx.insert(partnerLedgerEntries).values({
    partnerId: input.partnerId,
    payoutId: payout.id,
    type: "PAYOUT",
    amountMinor: -input.amountMinor,
    currency: input.currency,
  });

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_PAYOUT_RECORDED",
    targetType: "partner_payout",
    targetId: payout.id,
    metadata: { partnerId: input.partnerId, amountMinor: input.amountMinor, currency: input.currency, reference: input.reference },
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

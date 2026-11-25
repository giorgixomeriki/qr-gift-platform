"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, UnauthorizedError } from "@/lib/auth/admin";
import { requirePartnerContext } from "@/lib/auth/partner-context";
import { publicEnv } from "@/lib/env.public";
import { enforceRateLimit, RateLimitedError } from "@/lib/rate-limit";
import { logServerError } from "@/lib/log";
import {
  adminTransitionSchema,
  createHandoverSchema,
  reportDiscrepancySchema,
  batchIdSchema,
  resolveScanSchema,
} from "@/lib/validation/handovers";
import {
  adminTransitionHandover,
  createHandover,
  ensureCentralStockPartner,
  evaluateCards,
  HandoverError,
  HANDOVER_MAX_CARDS,
  listEligibleBatchTokens,
  partnerReportDiscrepancy,
  type CardEligibility,
  type TransferTotals,
} from "./handovers";
import { parseScannedQr } from "./scan-parse";

/**
 * Server actions for Scan-to-Assign. Every action re-authorizes (requireAdmin
 * / requirePartnerContext) and returns stable error CODES that the UI maps to
 * Georgian/English copy; raw database messages never reach the browser.
 */

export type HandoverActionError =
  | "unauthorized"
  | "rate_limited"
  | "invalid_input"
  | "foreign"
  | "malformed"
  | "empty"
  | "no_central_stock"
  | "partner_not_found"
  | "partner_inactive"
  | "partner_is_central_stock"
  | "same_partner"
  | "batch_empty"
  | "idempotency_conflict"
  | "too_many_cards"
  | "no_cards"
  | "handover_not_found"
  | "handover_forbidden"
  | "handover_not_pending"
  | "handover_wrong_state"
  | "handover_cards_ineligible"
  | "handover_not_completed"
  | "report_limit"
  | "dispute_note_invalid"
  | "dispute_count_invalid"
  | "unknown";

export type Failure = { ok: false; error: HandoverActionError; ineligibleCount?: number };

const KNOWN: readonly string[] = [
  "no_central_stock", "partner_not_found", "partner_inactive", "partner_is_central_stock", "same_partner", "idempotency_conflict",
  "too_many_cards", "no_cards", "handover_not_found", "handover_forbidden", "handover_not_pending",
  "handover_wrong_state", "handover_not_completed", "report_limit", "dispute_note_invalid", "dispute_count_invalid",
];

function failure(scope: string, err: unknown): Failure {
  if (err instanceof UnauthorizedError) return { ok: false, error: "unauthorized" };
  if (err instanceof RateLimitedError) return { ok: false, error: "rate_limited" };
  if (err instanceof HandoverError) {
    const m = /^handover_cards_ineligible:(\d+)$/.exec(err.code);
    if (m) return { ok: false, error: "handover_cards_ineligible", ineligibleCount: Number(m[1]) };
    if (KNOWN.includes(err.code)) return { ok: false, error: err.code as HandoverActionError };
  }
  if ((err as { name?: string })?.name === "ZodError") return { ok: false, error: "invalid_input" };
  logServerError(scope, err);
  return { ok: false, error: "unknown" };
}

/** One scanned/typed value → the card's eligibility. Read-only; no customer scan event, no navigation. */
export async function adminResolveScannedCardAction(raw: unknown): Promise<{ ok: true; card: CardEligibility } | Failure> {
  try {
    const value = resolveScanSchema.parse(raw);
    const parsed = parseScannedQr(value, publicEnv.NEXT_PUBLIC_APP_URL);
    if (!parsed.ok) return { ok: false, error: parsed.reason };
    const [card] = await requireAdmin(async (tx, adminUserId) => {
      // Generous: a fast operator scans ~1 card/second; this stops a runaway loop.
      await enforceRateLimit({ key: `qr-scan-resolve:${adminUserId}`, limit: 240, windowSeconds: 60 });
      return evaluateCards(tx, [parsed.token]);
    });
    return { ok: true, card: card! };
  } catch (err) {
    return failure("adminResolveScannedCardAction", err);
  }
}

/**
 * "Select a batch" instead of scanning: the currently eligible cards of one
 * batch, with holder info (admin only, at most HANDOVER_MAX_CARDS).
 */
export async function adminBatchCardsAction(batchId: unknown): Promise<{ ok: true; cards: CardEligibility[]; truncated: boolean } | Failure> {
  try {
    const id = batchIdSchema.parse(batchId);
    const result = await requireAdmin(async (tx, adminUserId) => {
      await enforceRateLimit({ key: `qr-batch-select:${adminUserId}`, limit: 60, windowSeconds: 60 });
      const tokens = await listEligibleBatchTokens(tx, id);
      const picked = tokens.slice(0, HANDOVER_MAX_CARDS);
      return { cards: await evaluateCards(tx, picked), truncated: tokens.length > picked.length };
    });
    if (result.cards.length === 0) return { ok: false, error: "batch_empty" };
    return { ok: true, cards: result.cards.filter((c) => c.eligible), truncated: result.truncated };
  } catch (err) {
    return failure("adminBatchCardsAction", err);
  }
}

export async function adminEnsureCentralStockAction(): Promise<{ ok: true; partnerId: string } | Failure> {
  try {
    const partner = await requireAdmin((tx, adminUserId) => ensureCentralStockPartner(tx, adminUserId));
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/partners");
    return { ok: true, partnerId: partner.id };
  } catch (err) {
    return failure("adminEnsureCentralStockAction", err);
  }
}

export async function adminCreateHandoverAction(
  input: unknown,
): Promise<{ ok: true; handoverId: string; quantity: number; duplicate: boolean; totals: TransferTotals } | { ok: false; error: "ineligible"; cards: CardEligibility[] } | Failure> {
  try {
    const parsed = createHandoverSchema.parse(input);
    const result = await requireAdmin(async (tx, adminUserId) => {
      await enforceRateLimit({ key: `qr-handover-create:${adminUserId}`, limit: 30, windowSeconds: 60 });
      return createHandover(tx, adminUserId, parsed);
    });
    if (!result.ok) return { ok: false, error: "ineligible", cards: result.cards.filter((c) => !c.eligible) };
    // Ownership has already moved: refresh both sides' inventory views.
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/partners", "layout");
    revalidatePath("/partner/dashboard");
    return result;
  } catch (err) {
    return failure("adminCreateHandoverAction", err);
  }
}

export async function adminTransitionHandoverAction(input: unknown): Promise<{ ok: true } | Failure> {
  try {
    const parsed = adminTransitionSchema.parse(input);
    await requireAdmin((tx, adminUserId) => adminTransitionHandover(tx, adminUserId, parsed.handoverId, parsed.transition, parsed.note));
    revalidatePath("/admin/inventory");
    revalidatePath(`/admin/inventory/handovers/${parsed.handoverId}`);
    revalidatePath("/admin/dashboard");
    return { ok: true };
  } catch (err) {
    return failure("adminTransitionHandoverAction", err);
  }
}

const RECEIVE_ROLES = ["OWNER", "ADMIN", "STAFF"] as const;

/**
 * Partner: report a physical-count mismatch on a completed transfer. Support
 * only — it never moves or reverses cards. Partners have no action that
 * accepts, approves, sends or reassigns inventory.
 */
export async function partnerReportDiscrepancyAction(input: unknown): Promise<{ ok: true } | Failure> {
  try {
    const parsed = reportDiscrepancySchema.parse(input);
    await requirePartnerContext(async (tx, ctx) => {
      if (!(RECEIVE_ROLES as readonly string[]).includes(ctx.role)) throw new HandoverError("handover_forbidden");
      await enforceRateLimit({ key: `qr-handover-report:${ctx.userId}`, limit: 10, windowSeconds: 60 });
      return partnerReportDiscrepancy(tx, parsed.handoverId, parsed.receivedCount, parsed.note);
    });
    revalidatePath("/partner/dashboard");
    return { ok: true };
  } catch (err) {
    return failure("partnerReportDiscrepancyAction", err);
  }
}

import { z } from "zod";

/**
 * Manual payout input (Phase 5 §16/§17). amountMinor is bounded well above
 * any plausible single pilot payout as a sanity ceiling, not a real business
 * limit — the actual "can't exceed balance" check happens server-side in
 * lib/payments/payouts.ts against the live ledger, never here.
 */
export const recordPayoutSchema = z
  .object({
    currency: z.string().trim().length(3),
    amountMinor: z.number().int().positive().max(100_000_000),
    periodFrom: z.coerce.date(),
    periodTo: z.coerce.date(),
    reference: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.periodFrom < v.periodTo, { message: "periodFrom must be before periodTo", path: ["periodTo"] });

export type RecordPayoutInput = z.infer<typeof recordPayoutSchema>;

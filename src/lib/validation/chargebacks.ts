import { z } from "zod";

/**
 * Admin input for recording a bank chargeback. The reference is the bank's
 * dispute/case number (kept as the refund row's provider_action_id and in the
 * audit log); the date is when the bank executed it, never in the future.
 */
export const recordChargebackSchema = z.object({
  reference: z.string().trim().min(1).max(100),
  disputedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "Not a date")
    .refine((d) => Date.parse(`${d}T00:00:00Z`) <= Date.now() + 24 * 60 * 60 * 1000, "The date can't be in the future"),
  note: z.string().trim().max(500).optional(),
});
export type RecordChargebackInput = z.infer<typeof recordChargebackSchema>;

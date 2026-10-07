import { z } from "zod";
import { isBusinessDate } from "@/lib/business-calendar";

const businessDate = z.string().refine(isBusinessDate, { message: "Expected a calendar date YYYY-MM-DD" });

/**
 * Manual payout input (itemized, migrations/0014). There is no amount field
 * the server trusts: expectedAmountMinor / expectedLedgerEntryIds are what
 * the admin's confirmed statement showed, and the server rejects the payout
 * unless its own recomputation under lock matches them exactly.
 *
 * periodFrom/periodTo are BUSINESS CALENDAR DATES (both inclusive), never
 * instants: the server turns them into a half-open UTC range in the business
 * timezone (lib/business-calendar.ts businessDayRange). Parsing them as
 * Date here would silently mean UTC midnight.
 */
export const recordPayoutSchema = z
  .object({
    currency: z.string().trim().length(3),
    periodFrom: businessDate,
    periodTo: businessDate,
    expectedAmountMinor: z.number().int().positive().max(100_000_000),
    expectedLedgerEntryIds: z.array(z.uuid()).min(1).max(5000),
    reference: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.periodFrom <= v.periodTo, { message: "periodFrom must not be after periodTo", path: ["periodTo"] });

export type RecordPayoutInput = z.infer<typeof recordPayoutSchema>;

/** Payout period statement query — business calendar dates, both inclusive. */
export const payoutStatementSchema = z
  .object({
    currency: z.string().trim().length(3),
    periodFrom: businessDate,
    periodTo: businessDate,
  })
  .refine((v) => v.periodFrom <= v.periodTo, { message: "periodFrom must not be after periodTo", path: ["periodTo"] });

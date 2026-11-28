import { z } from "zod";
import { LOCATION_CATEGORIES } from "@/lib/partner-locations/shared";

/**
 * Admin inputs for partner locations. Lengths mirror the DB checks in
 * migrations/0023 so a bad value is refused with a clear message before it
 * reaches Postgres. Blank optional strings become null.
 */
const optional = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().min(min).max(max).nullable())
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const locationInputSchema = z.object({
  branchName: optional(2, 80),
  category: z.enum(LOCATION_CATEGORIES),
  addressKa: z.string().trim().min(3).max(200),
  addressEn: optional(3, 200),
  cityKa: z.string().trim().min(2).max(80),
  cityEn: optional(2, 80),
  districtKa: optional(2, 80),
  districtEn: optional(2, 80),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  phone: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().regex(/^\+?[0-9 ()-]{6,20}$/).nullable())
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  hoursKa: optional(2, 120),
  hoursEn: optional(2, 120),
  stocksCards: z.boolean(),
});
export type LocationInput = z.infer<typeof locationInputSchema>;

/** Every state-changing call carries the updatedAt the admin last saw (optimistic concurrency). */
export const expectedVersionSchema = z.iso.datetime({ offset: true });

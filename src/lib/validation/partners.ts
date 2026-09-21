import { z } from "zod";

/**
 * Server-side validation for Partner CRUD and membership mutations (Phase 1).
 * Every admin/partner route handler and server action must parse input
 * through these before touching the DB — never trust a client-supplied shape.
 */

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase letters, digits and hyphens only");

export const createPartnerSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(200),
  defaultLocale: z.enum(["ka", "en"]).default("ka"),
  country: z.string().trim().length(2).default("GE"),
  currency: z.string().trim().length(3).default("GEL"),
  // Basis points (1/100 of a percent): 3000 = 30%. Bounded well inside
  // [0, 10000] — a commission rate above 100% of gross is never legitimate.
  commissionRateBps: z.number().int().min(0).max(10000).default(0),
});
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

export const updatePartnerSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  defaultLocale: z.enum(["ka", "en"]).optional(),
  commissionRateBps: z.number().int().min(0).max(10000).optional(),
});
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;

export const partnerStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);

export const partnerRoleSchema = z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]);

export const addPartnerMemberSchema = z.object({
  // The Supabase auth user id of the person being granted membership.
  // Superseded for the UI by addPartnerMemberByEmailSchema below (Phase 5
  // §13) — kept for any caller that already has a real, verified user id in
  // hand, since requiring an email round-trip in that case would be pure
  // friction, not more correct.
  userId: z.uuid(),
  role: partnerRoleSchema.default("STAFF"),
});
export type AddPartnerMemberInput = z.infer<typeof addPartnerMemberSchema>;

export const addPartnerMemberByEmailSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: partnerRoleSchema.default("STAFF"),
});
export type AddPartnerMemberByEmailInput = z.infer<typeof addPartnerMemberByEmailSchema>;

export const updatePartnerMemberRoleSchema = z.object({
  role: partnerRoleSchema,
});

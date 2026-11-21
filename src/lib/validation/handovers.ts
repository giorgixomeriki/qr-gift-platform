import { z } from "zod";
import { isPublicToken } from "@/lib/qr/scan-parse";

/**
 * Server-side validation for Scan-to-Assign (migrations/0026). The client
 * sends public tokens (what the camera read), never card ids; the server
 * resolves and re-checks every one of them at submission.
 */
const token = z.string().refine(isPublicToken, "invalid token");

export const createHandoverSchema = z.object({
  idempotencyKey: z.uuid(),
  fromPartnerId: z.uuid(),
  toPartnerId: z.uuid(),
  tokens: z.array(token).min(1).max(500),
  note: z.string().trim().max(500).optional(),
});
export type CreateHandoverActionInput = z.infer<typeof createHandoverSchema>;

export const resolveScanSchema = z.string().max(512);

export const handoverIdSchema = z.uuid();

export const batchIdSchema = z.uuid();

export const adminTransitionSchema = z.object({
  handoverId: z.uuid(),
  transition: z.enum(["cancel", "reopen", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export const disputeHandoverSchema = z.object({
  handoverId: z.uuid(),
  receivedCount: z.number().int().min(0).max(10000).nullable(),
  note: z.string().trim().min(1).max(1000),
});

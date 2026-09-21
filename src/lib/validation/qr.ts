import { z } from "zod";

/**
 * Server-side validation for QR batch/distribution mutations (Phase 1). The
 * quantity bound here must stay <= the DB check constraint
 * qr_batches_quantity_range (migrations/0005) — this is the friendly
 * app-layer rejection, that's the hard backstop.
 */
export const createBatchSchema = z.object({
  label: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(2000),
});
export type CreateBatchInput = z.infer<typeof createBatchSchema>;

export const markDistributedSchema = z.object({
  qrCodeIds: z.array(z.uuid()).min(1).max(2000),
});
export type MarkDistributedInput = z.infer<typeof markDistributedSchema>;

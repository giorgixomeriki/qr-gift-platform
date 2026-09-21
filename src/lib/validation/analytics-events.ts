import { z } from "zod";

/**
 * Closed set of analytics events with a typed metadata shape per event, so it
 * is structurally impossible for a caller to accidentally pass greeting text,
 * a storage key/URL, payment provider details, or any other private content
 * into analytics — the union only has fields for counts/ids/durations, never
 * free-text content fields.
 *
 * This is the authoritative V1 commercial funnel (Phase 0.5 §8):
 *
 *   QR_GENERATED    -> QR_DISTRIBUTED  -> QR_SCANNED -> CREATION_STARTED
 *   -> MEDIA_UPLOADED -> PREVIEW_VIEWED -> CHECKOUT_STARTED
 *   -> PAYMENT_SUCCEEDED -> QR_ACTIVATED -> RECIPIENT_VIEWED -> CONTENT_PLAYED
 *
 * QR_GENERATED and QR_DISTRIBUTED are NOT the same event: a QR batch being
 * created (QR_GENERATED) does not mean the physical cards have left the
 * building yet. QR_DISTRIBUTED is a separate, later, partner/admin-confirmed
 * event — never inferred automatically from batch creation.
 */
export const analyticsEventSchema = z.discriminatedUnion("eventType", [
  z.object({ eventType: z.literal("QR_GENERATED"), qrBatchId: z.uuid(), quantity: z.number().int().positive() }),
  z.object({ eventType: z.literal("QR_DISTRIBUTED"), qrCodeId: z.uuid() }),
  z.object({ eventType: z.literal("QR_SCANNED"), qrCodeId: z.uuid() }),
  z.object({ eventType: z.literal("CREATION_STARTED"), qrCodeId: z.uuid(), greetingId: z.uuid() }),
  z.object({
    eventType: z.literal("MEDIA_UPLOADED"),
    greetingId: z.uuid(),
    contentType: z.enum(["photo", "video", "audio"]),
  }),
  z.object({ eventType: z.literal("PREVIEW_VIEWED"), greetingId: z.uuid() }),
  z.object({ eventType: z.literal("CHECKOUT_STARTED"), greetingId: z.uuid(), orderId: z.uuid() }),
  z.object({ eventType: z.literal("PAYMENT_SUCCEEDED"), orderId: z.uuid(), greetingId: z.uuid() }),
  z.object({ eventType: z.literal("QR_ACTIVATED"), qrCodeId: z.uuid(), greetingId: z.uuid() }),
  z.object({ eventType: z.literal("RECIPIENT_VIEWED"), qrCodeId: z.uuid(), greetingId: z.uuid() }),
  z.object({
    eventType: z.literal("CONTENT_PLAYED"),
    greetingId: z.uuid(),
    contentType: z.enum(["photo", "video", "audio"]),
  }),
  z.object({ eventType: z.literal("GREETING_REPORTED"), greetingId: z.uuid() }),
]);

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

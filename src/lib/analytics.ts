import "server-only";
import { db } from "@/db/client";
import { analyticsEvents } from "@/db/schema";
import { analyticsEventSchema, type AnalyticsEventInput } from "@/lib/validation/analytics-events";

/**
 * The only entry point for writing analytics — routes must never insert into
 * analyticsEvents directly, so the closed event/metadata shape in
 * validation/analytics-events.ts is the sole gate on what can be recorded.
 */
export async function recordAnalyticsEvent(
  input: AnalyticsEventInput,
  extra: { partnerId?: string; anonSessionId?: string } = {},
): Promise<void> {
  const event = analyticsEventSchema.parse(input);
  const { eventType, qrCodeId, greetingId, ...rest } = event as typeof event & {
    qrCodeId?: string;
    greetingId?: string;
  };

  // Everything besides eventType/qrCodeId/greetingId is a non-content id or
  // count (orderId, qrBatchId, quantity, contentType) — safe to store as-is,
  // since the closed schema above structurally excludes free-text content.
  await db.insert(analyticsEvents).values({
    eventType,
    qrCodeId,
    greetingId,
    partnerId: extra.partnerId,
    anonSessionId: extra.anonSessionId,
    metadata: rest,
  });
}

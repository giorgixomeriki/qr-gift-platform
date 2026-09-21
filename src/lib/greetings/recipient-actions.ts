"use server";

import { eq } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { greetings, qrCodes } from "@/db/schema";
import { recordAnalyticsEvent } from "@/lib/analytics";

/**
 * Public — no edit token, no session — exactly like QR_SCANNED/RECIPIENT_VIEWED
 * already are (see lib/analytics.ts's trust model comment). Still re-verifies
 * the Greeting is genuinely ACTIVE before recording, so this can't be used to
 * write arbitrary analytics rows against a nonexistent or non-public Greeting.
 */
export async function recordContentPlayedAction(greetingId: string, contentType: "photo" | "video" | "audio"): Promise<void> {
  const [greeting] = await withPublicContext((tx) =>
    tx.select({ status: greetings.status, qrCodeId: greetings.qrCodeId }).from(greetings).where(eq(greetings.id, greetingId)).limit(1),
  );
  if (!greeting || greeting.status !== "ACTIVE") return;

  const [qr] = await withPublicContext((tx) => tx.select({ partnerId: qrCodes.partnerId }).from(qrCodes).where(eq(qrCodes.id, greeting.qrCodeId)).limit(1));

  await recordAnalyticsEvent({ eventType: "CONTENT_PLAYED", greetingId, contentType }, { partnerId: qr?.partnerId });
}

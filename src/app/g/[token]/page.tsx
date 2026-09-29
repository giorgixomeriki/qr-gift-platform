import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { env } from "@/lib/env";
import { resolveQrState } from "@/lib/qr/resolve-state";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getDefaultProductPrice, formatMinorAmount } from "@/lib/payments/display-price";
import { editTokenCookieName } from "@/lib/security/edit-token";
import { loadDraftForEdit, InvalidEditTokenError } from "@/lib/greetings/content";
import { loadActiveGreetingForRecipient, isOriginalSender, RecipientAccessError } from "@/lib/greetings/recipient";
import { SenderEntry } from "@/components/greeting/sender-entry";
import { CreationWizard, type WizardInitialState } from "@/components/greeting/creation-wizard";
import { RecipientView } from "@/components/greeting/recipient-view";
import { BlockedPlaceholder, DraftNoAccessPlaceholder } from "@/components/qr/placeholders";

/**
 * The permanent public entry point printed on every physical card
 * (architecture plan §2, §5). Deliberately has no layout chrome of its own —
 * the root layout is already bare, so this renders truly fullscreen with
 * nothing SaaS-shaped around it.
 *
 * Forced dynamic (Phase 2 hardening pass): the "draft"/"active" branches
 * already call cookies(), which opts them out of caching on their own — but
 * the "available" branch (a never-before-scanned QR) calls neither cookies()
 * nor any other dynamic API, so without this it could be picked up by the
 * Full Route Cache and served stale to the next scan of the same physical
 * code after its state has already moved on (e.g. after someone else starts
 * filling it in). This is a staleness/correctness guarantee, not a
 * cross-tenant leak — the token is already part of the path, so any cache
 * would be scoped per-token, never shared across different Greetings.
 */
export const dynamic = "force-dynamic";

export default async function QrEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ step?: string | string[] }>;
}) {
  const { token } = await params;
  const { step } = await searchParams;
  const resolution = await resolveQrState(token);
  const locale = await getLocale();

  switch (resolution.kind) {
    case "not_found":
      notFound();

    case "blocked":
      return <BlockedPlaceholder />;

    case "available": {
      await recordAnalyticsEvent({ eventType: "QR_SCANNED", qrCodeId: resolution.qrId }, { partnerId: resolution.partnerId });
      const price = await getDefaultProductPrice(resolution.partnerId);
      const priceLabel = price ? formatMinorAmount(price.amountMinor, price.currency, locale) : null;
      return <SenderEntry publicToken={token} priceLabel={priceLabel} />;
    }

    case "draft": {
      await recordAnalyticsEvent({ eventType: "QR_SCANNED", qrCodeId: resolution.qrId }, { partnerId: resolution.partnerId });

      const cookieStore = await cookies();
      const editToken = cookieStore.get(editTokenCookieName(resolution.greetingId))?.value;
      if (!editToken) return <DraftNoAccessPlaceholder />;

      try {
        const draft = await loadDraftForEdit(resolution.greetingId, editToken);
        const price = await getDefaultProductPrice(resolution.partnerId);
        const priceLabel = price ? formatMinorAmount(price.amountMinor, price.currency, locale) : null;

        const photoBySlot = [0, 1, 2].map((slot) => {
          const row = draft.content.find((c) => c.type === "photo" && c.slot === slot && c.signedUrl);
          return row ? { contentId: row.id, url: row.signedUrl! } : null;
        });
        const videoRow = draft.content.find((c) => c.type === "video" && c.signedUrl);
        const audioRow = draft.content.find((c) => c.type === "audio" && c.signedUrl);
        const textRow = draft.content.find((c) => c.type === "text");

        // A message is required before preview/checkout. The server refuses
        // to create an order without one anyway (lib/payments/eligibility.ts);
        // this just sends a direct link to those steps back to the message
        // step instead of showing a checkout that can only fail.
        if ((step === "preview" || step === "checkout") && !textRow?.textValue?.trim()) {
          redirect(`/g/${encodeURIComponent(token)}?step=message`);
        }

        const initial: WizardInitialState = {
          greetingId: resolution.greetingId,
          themeKey: draft.themeKey,
          message: textRow?.textValue ?? "",
          photos: photoBySlot,
          video: videoRow ? { contentId: videoRow.id, url: videoRow.signedUrl! } : null,
          audio: audioRow ? { contentId: audioRow.id, url: audioRow.signedUrl! } : null,
          priceLabel,
          isTestPayments: env.PAYMENTS_PROVIDER === "TEST",
        };

        return (
          <Suspense>
            <CreationWizard initial={initial} />
          </Suspense>
        );
      } catch (err) {
        if (err instanceof InvalidEditTokenError) return <DraftNoAccessPlaceholder />;
        throw err;
      }
    }

    case "active": {
      const cookieStore = await cookies();
      const editToken = cookieStore.get(editTokenCookieName(resolution.greetingId))?.value;
      const isSender = await isOriginalSender(resolution.greetingId, editToken);

      // The sender viewing their own freshly-activated Greeting is not a
      // genuine recipient visit — only count RECIPIENT_VIEWED for someone
      // else (Phase 3 §14: "RECIPIENT_VIEWED occurs when ACTIVE recipient
      // experience genuinely opens").
      if (!isSender) {
        await recordAnalyticsEvent(
          { eventType: "RECIPIENT_VIEWED", qrCodeId: resolution.qrId, greetingId: resolution.greetingId },
          { partnerId: resolution.partnerId },
        );
      }

      try {
        const data = await loadActiveGreetingForRecipient(resolution.greetingId);
        const photos = data.content.filter((c) => c.type === "photo" && c.signedUrl).map((c) => ({ id: c.id, url: c.signedUrl! }));
        const videoRow = data.content.find((c) => c.type === "video" && c.signedUrl);
        const audioRow = data.content.find((c) => c.type === "audio" && c.signedUrl);
        const textRow = data.content.find((c) => c.type === "text");

        return (
          <RecipientView
            greetingId={resolution.greetingId}
            themeKey={data.themeKey}
            isOriginalSender={isSender}
            content={{
              message: textRow?.textValue ?? null,
              photos,
              video: videoRow ? { url: videoRow.signedUrl! } : null,
              audio: audioRow ? { url: audioRow.signedUrl! } : null,
            }}
          />
        );
      } catch (err) {
        if (err instanceof RecipientAccessError) return <BlockedPlaceholder />;
        throw err;
      }
    }
  }
}

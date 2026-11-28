"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ConfirmationLink } from "./confirmation-link";
import { WaxSeal } from "@/components/customer/wax-seal";
import { GreetingRenderer, type GreetingRenderContent } from "./greeting-renderer";
import type { ThemeKey } from "@/lib/themes/registry";
import { recordContentPlayedAction, refreshRecipientVoiceUrlAction } from "@/lib/greetings/recipient-actions";
import { prefetchCinematic } from "@/components/cinematic/prefetch";

/** The approved cinematic opening (C3 · Luxury Film Reveal): loaded on demand, never before the envelope paints. */
const CinematicInterlude = lazy(() => import("@/components/cinematic/cinematic-interlude"));

export function RecipientView({
  greetingId,
  themeKey,
  themeVersion,
  content,
  isOriginalSender,
  spotifyEmbed = false,
  serverNow,
  arrivedFromLock = false,
}: {
  greetingId: string;
  themeKey: ThemeKey;
  /** The template version the greeting was made with (greetings.theme_version). */
  themeVersion?: number;
  content: GreetingRenderContent;
  isOriginalSender: boolean;
  spotifyEmbed?: boolean;
  /** The database clock when the page rendered (the countdown beat counts from it). */
  serverNow?: number;
  /** Came from the Scheduled Reveal lock screen at its moment (?from=lock). */
  arrivedFromLock?: boolean;
}) {
  const t = useTranslations("success");
  const tg = useTranslations("greeting");
  // Warm the opening (code + petal atlas) in idle time while the envelope is sealed.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 600));
    const h = idle(() => prefetchCinematic("C3"));
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(h as number);
  }, []);
  // The galaxy shows the greeting's own photographs (the same signed URLs as the photo beats), never repeated.
  const galleryPhotos = useMemo(
    () => content.photos.map((p, i) => ({ url: p.url, alt: tg("photoAlt", { n: i + 1, total: content.photos.length }) })),
    [content.photos, tg],
  );
  const handlePlayed = useCallback(
    (type: "video" | "audio") => {
      void recordContentPlayedAction(greetingId, type);
    },
    [greetingId],
  );
  // The voice is signed when the page renders; the player re-signs it when it is reached later (voice-player.tsx).
  const withRefresh = useMemo<GreetingRenderContent>(
    () => (content.audio ? { ...content, audio: { ...content.audio, refresh: () => refreshRecipientVoiceUrlAction(greetingId) } } : content),
    [content, greetingId],
  );

  return (
    <GreetingRenderer
      themeKey={themeKey}
      themeVersion={themeVersion}
      content={withRefresh}
      mode="recipient"
      spotifyEmbed={spotifyEmbed}
      serverNow={serverNow}
      continuation={arrivedFromLock}
      onContentPlayed={handlePlayed}
      openingInterlude={({ reveal, done }) => (
        <Suspense fallback={null}>
          <CinematicInterlude
            variant="C3"
            themeKey={themeKey}
            photos={galleryPhotos}
            phrases={[]}
            galaxy={galleryPhotos.length > 0}
            // The whole automatic opening stays within 5 s (petals 2.3 s + galaxy 1.5 s + exit 1.1 s); the recipient can go on sooner.
            galaxyHoldMs={1500}
            labels={{ skip: tg("cinematicSkip"), openLetter: tg("cinematicOpenLetter") }}
            reveal={reveal}
            done={done}
          />
        </Suspense>
      )}
      senderBanner={
        isOriginalSender ? (
          // The sender's own first look: a paper note with the seal, never a system toast.
          <div className="sx-banner" data-testid="sender-success-banner" role="status">
            <WaxSeal className="sx-banner__seal" />
            <div className="min-w-0">
              <p className="sx-banner__kicker">{t("kicker")}</p>
              <p className="sx-banner__title">{t("title")}</p>
              <p className="sx-banner__body">{t("banner")}</p>
              <ConfirmationLink greetingId={greetingId} label={t("confirmation")} />
            </div>
          </div>
        ) : undefined
      }
    />
  );
}

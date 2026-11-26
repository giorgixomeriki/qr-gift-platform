"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ConfirmationLink } from "./confirmation-link";
import { WaxSeal } from "@/components/customer/wax-seal";
import { GreetingRenderer, type GreetingRenderContent } from "./greeting-renderer";
import type { ThemeKey } from "@/lib/themes/registry";
import { recordContentPlayedAction, refreshRecipientVoiceUrlAction } from "@/lib/greetings/recipient-actions";

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

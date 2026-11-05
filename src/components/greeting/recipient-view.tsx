"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { WaxSeal } from "@/components/customer/wax-seal";
import { GreetingRenderer, type GreetingRenderContent } from "./greeting-renderer";
import type { ThemeKey } from "@/lib/themes/registry";
import { recordContentPlayedAction } from "@/lib/greetings/recipient-actions";

export function RecipientView({
  greetingId,
  themeKey,
  themeVersion,
  content,
  isOriginalSender,
}: {
  greetingId: string;
  themeKey: ThemeKey;
  /** The template version the greeting was made with (greetings.theme_version). */
  themeVersion?: number;
  content: GreetingRenderContent;
  isOriginalSender: boolean;
}) {
  const t = useTranslations("success");
  const handlePlayed = useCallback(
    (type: "video" | "audio") => {
      void recordContentPlayedAction(greetingId, type);
    },
    [greetingId],
  );

  return (
    <GreetingRenderer
      themeKey={themeKey}
      themeVersion={themeVersion}
      content={content}
      mode="recipient"
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
            </div>
          </div>
        ) : undefined
      }
    />
  );
}

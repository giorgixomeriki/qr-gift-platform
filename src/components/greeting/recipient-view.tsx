"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { GreetingRenderer, type GreetingRenderContent } from "./greeting-renderer";
import { getThemeConfig, type ThemeKey } from "@/lib/themes/registry";
import { recordContentPlayedAction } from "@/lib/greetings/recipient-actions";

export function RecipientView({
  greetingId,
  themeKey,
  content,
  isOriginalSender,
}: {
  greetingId: string;
  themeKey: ThemeKey;
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
      theme={getThemeConfig(themeKey)}
      content={content}
      mode="recipient"
      onContentPlayed={handlePlayed}
      senderBanner={
        isOriginalSender ? (
          <div
            className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-xs text-white backdrop-blur"
            data-testid="sender-success-banner"
            role="status"
          >
            <span aria-hidden="true">❤️</span>
            <span>{t("banner")}</span>
          </div>
        ) : undefined
      }
    />
  );
}

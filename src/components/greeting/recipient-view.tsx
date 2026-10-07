"use client";

import { useCallback } from "react";
import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
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
          <div
            className="flex max-w-md items-start gap-3 rounded-[var(--radius-lg)] bg-surface/95 px-4 py-3 text-left text-ink shadow-md ring-1 ring-black/5 backdrop-blur-md"
            data-testid="sender-success-banner"
            role="status"
          >
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <div className="min-w-0">
              <p className="text-label">{t("title")}</p>
              <p className="mt-0.5 text-caption text-ink-2">{t("banner")}</p>
            </div>
          </div>
        ) : undefined
      }
    />
  );
}

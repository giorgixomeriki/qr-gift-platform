"use client";

import { useState, useTransition } from "react";
import { ImageIcon, Mic, PenLine, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActionBar, FlowShell } from "@/components/flow/shell";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { startGreetingAction } from "@/lib/greetings/actions";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeSwatch } from "./theme-swatch";

/**
 * First screen after a sender scans an unused card. Its only job: make the
 * idea click in three seconds and get one tap on the primary action. The
 * hero is a real miniature of what the recipient will see — the same
 * envelope the recipient experience opens with — not stock imagery.
 */
export function SenderEntry({ publicToken, priceLabel }: { publicToken: string; priceLabel: string | null }) {
  const t = useTranslations("sender.entry");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function handleStart() {
    setFailed(false);
    startTransition(async () => {
      // startGreetingAction redirects on success and never returns in that
      // case — reaching here means it returned an error result instead.
      const result = await startGreetingAction(publicToken);
      if (result && !result.ok) setFailed(true);
    });
  }

  const contentTypes = [
    { Icon: PenLine, label: t("addMessage") },
    { Icon: ImageIcon, label: t("addPhoto") },
    { Icon: Video, label: t("addVideo") },
    { Icon: Mic, label: t("addVoice") },
  ];

  return (
    <FlowShell headerEnd={<LocaleSwitcher />} width="wide">
      <div
        className="grid flex-1 grid-rows-[auto_1fr] gap-7 md:grid-cols-[1fr_1.1fr] md:grid-rows-1 md:items-center md:gap-16 md:py-12"
        data-testid="sender-entry"
      >
        <ThemeSwatch
          themeKey="romantic"
          scale={0.82}
          className="animate-fade -mx-4 aspect-[5/4] max-h-[46dvh] sm:mx-0 sm:rounded-[var(--radius-lg)] md:order-2 md:aspect-[4/5] md:max-h-none"
        />

        <div className="flex flex-col md:order-1">
          <div className="stagger">
            <h1 className="text-display">{t("title")}</h1>
            <p className="mt-3 max-w-md text-body text-ink-2 md:mt-4">{t("subtitle")}</p>
            <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-label text-ink-2" data-testid="content-type-row">
              {contentTypes.map(({ Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  <Icon className="size-4 text-ember" strokeWidth={1.75} aria-hidden />
                  {label}
                </span>
              ))}
            </p>
          </div>

          <ActionBar>
            {failed && (
              <Notice tone="danger" className="mb-1">
                <span data-testid="start-error">{t("startError")}</span>
              </Notice>
            )}
            <Button size="lg" block onClick={handleStart} loading={pending} disabled={!priceLabel} data-testid="start-greeting-button">
              {t("cta")}
            </Button>
            {priceLabel ? (
              <p className="text-center text-caption text-ink-2" data-testid="activation-price">
                {t("timeEstimate")} · {t("priceLabel")} <span className="font-medium text-ink">{priceLabel}</span> · {t("previewFirst")}
              </p>
            ) : (
              <p className="text-center text-caption text-danger" data-testid="price-unavailable">
                {t("priceUnavailable")}
              </p>
            )}
          </ActionBar>
        </div>
      </div>
    </FlowShell>
  );
}

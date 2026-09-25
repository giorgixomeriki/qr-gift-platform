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
        className="grid flex-1 grid-rows-[auto_1fr] gap-6 pt-2 md:grid-cols-[1fr_1.05fr] md:grid-rows-1 md:items-center md:gap-14 md:py-12"
        data-testid="sender-entry"
      >
        <ThemeSwatch
          themeKey="romantic"
          envelopeWidth="62%"
          className="animate-fade aspect-[16/10] max-h-[34dvh] w-full rounded-[var(--radius-xl)] shadow-md md:order-2 md:aspect-[4/5] md:max-h-none"
        />

        <div className="flex flex-col md:order-1">
          <div className="stagger">
            <p className="text-eyebrow text-ember">{t("eyebrow")}</p>
            <h1 className="text-display mt-2 md:mt-3">{t("title")}</h1>
            <p className="mt-3 max-w-md text-body text-ink-2 md:mt-4">{t("subtitle")}</p>

            <ul className="mt-7 flex flex-wrap gap-2 md:mt-9" data-testid="content-type-row">
              {contentTypes.map(({ Icon, label }) => (
                <li
                  key={label}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-surface pr-3.5 pl-3 text-label text-ink-2 shadow-xs ring-1 ring-line"
                >
                  <Icon className="size-4 text-ink" strokeWidth={1.75} aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-caption text-ink-3">{t("afterActivation")}</p>
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
                {t("timeEstimate")} · {t("priceLabel")} <span className="font-medium text-ink">{priceLabel}</span>
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

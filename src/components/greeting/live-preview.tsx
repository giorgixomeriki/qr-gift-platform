"use client";

import { Mic, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spark } from "@/components/ui/logo";
import { getThemeConfig, themeVars } from "@/lib/themes/registry";
import type { GreetingRenderContent } from "./greeting-renderer";

/**
 * Desktop-only companion to the wizard: a phone-sized glimpse of the opened
 * greeting that updates as the sender types and uploads. Decorative
 * (aria-hidden by the caller) — the real, accessible preview is the
 * dedicated Preview step, which runs the actual GreetingRenderer.
 */
export function LivePreview({ themeKey, content }: { themeKey: string; content: GreetingRenderContent }) {
  const t = useTranslations("wizard");
  const tt = useTranslations("themes");
  const theme = getThemeConfig(themeKey);
  const hero = content.photos[0];

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-caption text-ink-3">{t("livePreview")}</p>
      <div
        className="gift relative aspect-[9/17] w-full overflow-hidden rounded-[40px] shadow-lg ring-[6px] ring-ink transition-[background] duration-500"
        style={themeVars(theme)}
      >
        <div className="flex h-full flex-col items-center gap-5 overflow-hidden px-5 pt-10 pb-6">
          <p className="text-center font-serif text-[1.125rem] leading-[1.2] [text-wrap:balance]">{tt(`${theme.key}.opening`)}</p>
          {/* The same paper card the recipient reads. */}
          <div className="paper-card flex w-full flex-1 flex-col items-center overflow-hidden px-5 pt-6 pb-5 after:inset-[7px]">
            <Spark className="size-3.5 shrink-0 text-[var(--g-seal)]" />
            <p className="mt-3 line-clamp-[10] w-full font-serif text-[0.875rem] leading-[1.55] whitespace-pre-line text-[var(--g-paper-ink)]">
              {content.message || "…"}
            </p>
          </div>
          {(hero || content.audio || content.video) && (
            <div className="flex w-full items-center gap-2">
              {hero && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={hero.url} alt="" className="size-11 rounded-[3px] bg-white object-cover p-[3px] shadow-sm" style={{ rotate: "-3deg" }} />
              )}
              {content.audio && (
                <span className="grid size-9 place-items-center rounded-full bg-[var(--g-accent)] text-[var(--g-on-accent)]">
                  <Mic className="size-4" />
                </span>
              )}
              {content.video && (
                <span className="grid size-9 place-items-center rounded-full bg-[var(--g-accent)] text-[var(--g-on-accent)]">
                  <Play className="ml-0.5 size-4" fill="currentColor" strokeWidth={0} />
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

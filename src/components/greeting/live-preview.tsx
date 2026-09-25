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
        <div className="flex h-full flex-col gap-4 overflow-hidden px-6 pt-12 pb-6">
          <div className="text-center">
            <Spark className="mx-auto mb-3 size-3.5 text-[var(--g-accent)]" />
            <p className="font-serif text-[1.375rem] leading-[1.15] [text-wrap:balance]">{tt(`${theme.key}.opening`)}</p>
          </div>
          {hero && (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={hero.url} alt="" className="w-full shrink-0 rounded-2xl object-cover" style={{ aspectRatio: "4 / 3" }} />
          )}
          <p className="line-clamp-[9] font-serif text-[0.9375rem] leading-relaxed whitespace-pre-line text-[var(--g-ink)]">
            {content.message || "…"}
          </p>
          {(content.audio || content.video) && (
            <div className="mt-auto flex gap-2">
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

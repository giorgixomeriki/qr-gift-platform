"use client";

import { Mic, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { ThemeWorld } from "@/components/themes/theme-world";
import { getTemplate } from "@/lib/templates/catalog";
import { roomVars } from "@/lib/templates/room";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";
import type { GreetingRenderContent } from "./greeting-renderer";
import "./reveal.css";

/**
 * Desktop-only companion to the wizard: a phone-sized glimpse of the opened
 * greeting — the chosen world in its room, with the sender's own message on
 * its card — that updates as the sender uploads. Decorative (aria-hidden by
 * the caller); the real, accessible preview is the dedicated Preview step,
 * which runs the actual GreetingRenderer.
 */
export function LivePreview({ themeKey, content }: { themeKey: string; content: GreetingRenderContent }) {
  const t = useTranslations("wizard");
  const tt = useTranslations("themes");
  const world = getThemeWorld(themeKey);
  const room = getTemplate(world.key)?.spec.room;
  const hero = content.photos[0];

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-caption text-ink-3">{t("livePreview")}</p>
      <div
        className="reveal relative flex aspect-[9/17] w-full flex-col items-center justify-center gap-5 overflow-hidden rounded-[40px] px-5 shadow-lg ring-[6px] ring-ink"
        style={{ ...worldVars(world), ...(room && roomVars(room)) }}
        data-room={room?.dark ? "dark" : "light"}
      >
        <ThemeWorld themeKey={world.key} opening={tt(`${world.key}.opening`)} message={content.message || "…"} fit className="reveal__world" />
        {(hero || content.audio || content.video) && (
          <div className="flex w-full items-center justify-center gap-2">
            {hero && (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={hero.url} alt="" className="size-11 rounded-[3px] bg-[var(--w-card)] object-cover p-[3px] shadow-sm" style={{ rotate: "-3deg" }} />
            )}
            {content.audio && (
              <span className="grid size-9 place-items-center rounded-full bg-[var(--r-btn)] text-[var(--r-btn-ink)]">
                <Mic className="size-4" />
              </span>
            )}
            {content.video && (
              <span className="grid size-9 place-items-center rounded-full bg-[var(--r-btn)] text-[var(--r-btn-ink)]">
                <Play className="ml-0.5 size-4" fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { ThemeWorld } from "@/components/themes/theme-world";
import { getTemplate } from "@/lib/templates/catalog";
import { roomVars } from "@/lib/templates/room";
import type { ThemeKey } from "@/lib/themes/registry";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";
import type { GreetingRenderContent } from "./greeting-renderer";

/**
 * The studio's live view (desktop, ≥ 1024 px): the chosen world in its own
 * room, the sender's words on its card as they type, and a quiet list of
 * what the greeting holds. The caller mounts it only on wide screens, so
 * phones never pay for a second world. Decorative — the real, accessible
 * preview is the Preview step, which runs the recipient's renderer.
 */
export function StudioAside({ themeKey, content }: { themeKey: ThemeKey; content: GreetingRenderContent }) {
  const ts = useTranslations("wizard.sig");
  const tt = useTranslations("themes");
  const template = getTemplate(themeKey)!;
  const style = { ...roomVars(template.spec.room), ...worldVars(getThemeWorld(themeKey)) } as CSSProperties;
  const items = [
    content.message ? ts("itemsText") : null,
    content.photos.length ? ts("itemsPhotos", { count: content.photos.length }) : null,
    content.video ? ts("itemsVideo") : null,
    content.audio ? ts("itemsVoice") : null,
  ].filter(Boolean) as string[];

  return (
    <aside className="sig-studio__aside" aria-hidden data-testid="studio-aside">
      <p className="sig-kicker">{ts("previewKicker")}</p>
      <div className="sig-studio__room" style={style} data-room={template.spec.room.dark ? "dark" : "light"}>
        <ThemeWorld themeKey={themeKey} opening={tt(`${themeKey}.opening`)} message={content.message || "…"} fit className="sig-studio__world" />
      </div>
      <p className="sig-studio__name">{tt(`${themeKey}.name`)}</p>
      {items.length > 0 && <p className="sig-contents">{ts("contents", { items: items.join(" · ") })}</p>}
    </aside>
  );
}

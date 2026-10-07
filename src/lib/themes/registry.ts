import type { CSSProperties } from "react";
import { DEFAULT_TEMPLATE_ID, getCollection, getTemplate, isSelectableTemplateId, TEMPLATES } from "@/lib/templates/catalog";
import type { GreetingPalette, TemplateDefinition } from "@/lib/templates/schema";
import type { ENTRANCES, PARTICLES } from "@/lib/templates/vocabulary";

/**
 * Recipient renderer v1's view of a template: palette, entrance, particles
 * (GreetingRenderer, LivePreview, ThemeSwatch). Derived from the template
 * catalogue (src/lib/templates/) — the single source of truth for every
 * template; nothing is declared here any more.
 *
 * GreetingRenderer reads ONLY this config for structure — it never branches
 * on theme key directly, so adding a template never touches the renderer.
 * `themes.config` in the database stays a thin reference; rendering config
 * is typed code, never behaviour read out of a jsonb column.
 *
 * Copy (name, tagline, opening, ending, sample) is localized and lives in
 * messages/{locale}.json under `themes.<id>`.
 */

/** A template id (`themes.key`). Open-ended: the catalogue decides which exist. */
export type ThemeKey = string;

/** Ambient particles layered behind content — decorative only, hidden under reduced motion. */
export type Particle = (typeof PARTICLES)[number];

export type ThemePalette = GreetingPalette;

export type ThemeConfig = {
  key: ThemeKey;
  palette: ThemePalette;
  /**
   * Opening choreography once the envelope is tapped: "envelope" (flap opens,
   * letter rises), "balloons" (seal bursts into confetti), "fade" (soft bloom).
   */
  entrance: (typeof ENTRANCES)[number];
  particle: Particle;
};

function toConfig(t: TemplateDefinition): ThemeConfig {
  return { key: t.id, palette: t.spec.greeting.palette, entrance: t.spec.greeting.entrance, particle: t.spec.greeting.particle };
}

/** Every template version's config, latest published per id. */
export const THEME_REGISTRY: Readonly<Record<ThemeKey, ThemeConfig>> = Object.fromEntries(
  [...new Set(TEMPLATES.map((t) => t.id))].flatMap((id) => {
    const t = getTemplate(id);
    return t ? [[id, toConfig(t)] as const] : [];
  }),
);

export const DEFAULT_THEME_KEY: ThemeKey = DEFAULT_TEMPLATE_ID;

export function isThemeKey(value: string): value is ThemeKey {
  return isSelectableTemplateId(value);
}

/** A template's config — a specific version when given — falling back to the default template. */
export function getThemeConfig(key: string, version?: number): ThemeConfig {
  const t = getTemplate(key, version) ?? getTemplate(key) ?? getTemplate(DEFAULT_TEMPLATE_ID)!;
  return toConfig(t);
}

/** The picker's collection, in display order. */
export const SELECTABLE_THEMES: ThemeConfig[] = getCollection("launch").map(toConfig);

/** Palette → the --g-* custom properties the greeting components consume. */
export function themeVars(theme: ThemeConfig): CSSProperties {
  const p = theme.palette;
  return {
    "--g-bg": p.background,
    "--g-base": p.base,
    "--g-ink": p.text,
    "--g-ink-soft": p.textMuted,
    "--g-accent": p.accent,
    "--g-on-accent": p.onAccent,
    "--g-card": p.card,
    "--g-line": p.line,
    "--g-envelope": p.envelope,
    "--g-envelope-flap": p.envelopeFlap,
    "--g-envelope-ink": p.envelopeInk,
    "--g-seal": p.seal,
    "--g-seal-ink": p.sealInk,
    "--g-paper": p.paper,
    "--g-paper-ink": p.paperInk,
    "--g-paper-ink-soft": p.paperInkSoft,
    "--g-edge": p.edge ?? "transparent",
    "--g-liner": p.liner,
    colorScheme: p.dark ? "dark" : "light",
  } as CSSProperties;
}

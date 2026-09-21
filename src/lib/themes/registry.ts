/**
 * Theme Engine (Phase 2, refined Phase 4). Deliberately code-level config,
 * not DB-driven jsonb behavior: `themes.config` (DB) stays a thin reference —
 * the actual typed rendering config lives here, keyed by `themes.key`. This
 * keeps "add a theme" a safe code change (typed, reviewable) rather than
 * executing arbitrary behavior out of a jsonb column. GreetingRenderer reads
 * ONLY this registry for structure — it never branches on theme key directly,
 * so adding Wedding, Anniversary, etc. later never touches the renderer.
 *
 * Deliberately holds NO copy (name/opening/ending lines) — those are
 * localized strings and live in messages/{locale}.json under `themes.<key>`,
 * looked up by GreetingRenderer/ThemeStep via next-intl (Phase 4 §6): a
 * theme's visual identity is code, its words are translations.
 */

export type ThemeKey = "romantic" | "birthday" | "minimal";

export type ThemeConfig = {
  key: ThemeKey;
  /** CSS custom properties applied at the renderer root. */
  palette: {
    background: string;
    backgroundGradient: string;
    accent: string;
    text: string;
    textMuted: string;
  };
  fontFamily: string;
  /** Opening animation style before content is revealed. */
  entrance: "envelope" | "balloons" | "fade";
  /** Ambient decorative motion layered behind content — kept subtle, never fighting readability. */
  decorative: "hearts" | "confetti" | "none";
};

export const THEME_REGISTRY: Record<ThemeKey, ThemeConfig> = {
  romantic: {
    key: "romantic",
    palette: {
      background: "#1a0f14",
      backgroundGradient: "radial-gradient(circle at 50% 20%, #4a1628 0%, #1a0f14 70%)",
      accent: "#e8a3b3",
      text: "#f5e6ea",
      textMuted: "#c99aa6",
    },
    fontFamily: "var(--font-serif)",
    entrance: "envelope",
    decorative: "hearts",
  },
  birthday: {
    key: "birthday",
    palette: {
      background: "#1c1230",
      backgroundGradient: "radial-gradient(circle at 50% 15%, #3d2266 0%, #1c1230 70%)",
      accent: "#ffc857",
      text: "#fff7e8",
      textMuted: "#d9c9e8",
    },
    fontFamily: "var(--font-display)",
    entrance: "balloons",
    decorative: "confetti",
  },
  minimal: {
    key: "minimal",
    palette: {
      background: "#0a0a0a",
      backgroundGradient: "linear-gradient(180deg, #111111 0%, #0a0a0a 100%)",
      accent: "#e5e5e5",
      text: "#f5f5f5",
      textMuted: "#8a8a8a",
    },
    fontFamily: "var(--font-sans)",
    entrance: "fade",
    decorative: "none",
  },
};

export const DEFAULT_THEME_KEY: ThemeKey = "minimal";

export function isThemeKey(value: string): value is ThemeKey {
  return value in THEME_REGISTRY;
}

export function getThemeConfig(key: string): ThemeConfig {
  return isThemeKey(key) ? THEME_REGISTRY[key] : THEME_REGISTRY[DEFAULT_THEME_KEY];
}

export const SELECTABLE_THEMES: ThemeConfig[] = [THEME_REGISTRY.romantic, THEME_REGISTRY.birthday, THEME_REGISTRY.minimal];

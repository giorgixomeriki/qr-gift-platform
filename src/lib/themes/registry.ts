import type { CSSProperties } from "react";

/**
 * Theme Engine (Phase 2, refined Phase 4, redesigned in the UI pass).
 * Deliberately code-level config, not DB-driven jsonb behavior: `themes.config`
 * (DB) stays a thin reference — the actual typed rendering config lives here,
 * keyed by `themes.key`. This keeps "add a theme" a safe code change (typed,
 * reviewable) rather than executing arbitrary behavior out of a jsonb column.
 * GreetingRenderer reads ONLY this registry for structure — it never branches
 * on theme key directly, so adding a theme never touches the renderer.
 *
 * Adding a theme = add its key + config here, a `themes` seed row
 * (src/db/seed.ts), and its copy under `themes.<key>` in messages/{locale}.json.
 *
 * Deliberately holds NO copy (name/opening/ending lines) — those are localized
 * strings and live in messages/{locale}.json under `themes.<key>`.
 */

export type ThemeKey = "romantic" | "birthday" | "wedding" | "celebration" | "elegant" | "minimal";

/** Ambient particles layered behind content — decorative only, hidden under reduced motion. */
export type Particle = "none" | "petals" | "confetti" | "sparkles" | "stars";

export type ThemePalette = {
  /** Page background (may be a gradient). */
  background: string;
  /** Solid colour close to the background's dominant tone — theme-color, overscroll, fallbacks. */
  base: string;
  text: string;
  textMuted: string;
  accent: string;
  /** Text colour on top of `accent` (primary buttons inside the greeting). */
  onAccent: string;
  /** Translucent surface for players/cards on top of the background. */
  card: string;
  line: string;
  envelope: string;
  envelopeFlap: string;
  envelopeInk: string;
  seal: string;
  sealInk: string;
  particleColors: string[];
  dark: boolean;
};

export type ThemeConfig = {
  key: ThemeKey;
  palette: ThemePalette;
  /**
   * Opening choreography once the envelope is tapped: "envelope" (flap opens,
   * letter rises), "balloons" (seal bursts into confetti), "fade" (soft bloom).
   */
  entrance: "envelope" | "balloons" | "fade";
  particle: Particle;
};

export const THEME_REGISTRY: Record<ThemeKey, ThemeConfig> = {
  romantic: {
    key: "romantic",
    entrance: "envelope",
    particle: "petals",
    palette: {
      background: "radial-gradient(120% 80% at 50% 0%, #7a3244 0%, #4a1827 45%, #2a0e17 100%)",
      base: "#2a0e17",
      text: "#fcefef",
      textMuted: "rgb(252 239 239 / 0.74)",
      accent: "#f3c1bb",
      onAccent: "#3a1320",
      card: "rgb(255 255 255 / 0.08)",
      line: "rgb(255 255 255 / 0.16)",
      envelope: "#f6e7df",
      envelopeFlap: "#ecd5ca",
      envelopeInk: "#5a2332",
      seal: "#9e2f47",
      sealInk: "#fbe3e1",
      particleColors: ["#f6b8bd", "#f9d3d0", "#e98c98"],
      dark: true,
    },
  },
  birthday: {
    key: "birthday",
    entrance: "balloons",
    particle: "confetti",
    palette: {
      background: "linear-gradient(180deg, #fff6ea 0%, #ffe6d2 100%)",
      base: "#fff1e2",
      text: "#3b1e14",
      textMuted: "#7b5344",
      accent: "#c63f26",
      onAccent: "#ffffff",
      card: "rgb(255 255 255 / 0.72)",
      line: "rgb(59 30 20 / 0.12)",
      envelope: "#ffffff",
      envelopeFlap: "#fdebdc",
      envelopeInk: "#7b5344",
      seal: "#df4f35",
      sealInk: "#fff4ea",
      particleColors: ["#df4f35", "#f4a52a", "#3a9d8f", "#6c5fd3", "#f07fa8"],
      dark: false,
    },
  },
  wedding: {
    key: "wedding",
    entrance: "envelope",
    particle: "petals",
    palette: {
      background: "linear-gradient(180deg, #f7f4ec 0%, #e8ede2 100%)",
      base: "#f1f1e8",
      text: "#253029",
      textMuted: "#56635a",
      accent: "#56704f",
      onAccent: "#ffffff",
      card: "rgb(255 255 255 / 0.72)",
      line: "rgb(37 48 41 / 0.12)",
      envelope: "#fffdf8",
      envelopeFlap: "#f0ece1",
      envelopeInk: "#5b675e",
      seal: "#6f8b69",
      sealInk: "#f7f4ec",
      particleColors: ["#ffffff", "#f3efe4", "#dfe8d8"],
      dark: false,
    },
  },
  celebration: {
    key: "celebration",
    entrance: "balloons",
    particle: "stars",
    palette: {
      background: "radial-gradient(120% 80% at 50% 0%, #34387a 0%, #1a1c4a 50%, #0c0d26 100%)",
      base: "#0e0f2a",
      text: "#f3f2ff",
      textMuted: "rgb(243 242 255 / 0.72)",
      accent: "#ffd479",
      onAccent: "#1c1a3d",
      card: "rgb(255 255 255 / 0.07)",
      line: "rgb(255 255 255 / 0.15)",
      envelope: "#f8f4ea",
      envelopeFlap: "#ede6d6",
      envelopeInk: "#34387a",
      seal: "#3d4296",
      sealInk: "#ffd479",
      particleColors: ["#ffd479", "#ffffff", "#b9bcff"],
      dark: true,
    },
  },
  elegant: {
    key: "elegant",
    entrance: "fade",
    particle: "sparkles",
    palette: {
      background: "radial-gradient(110% 70% at 50% 0%, #2c2620 0%, #141214 55%, #0d0c0d 100%)",
      base: "#0f0e0f",
      text: "#f4ecdc",
      textMuted: "rgb(244 236 220 / 0.7)",
      accent: "#d6b47c",
      onAccent: "#1a1611",
      card: "rgb(255 255 255 / 0.06)",
      line: "rgb(214 180 124 / 0.25)",
      envelope: "#1d1b1d",
      envelopeFlap: "#262326",
      envelopeInk: "#d6b47c",
      seal: "#c8a266",
      sealInk: "#1a1611",
      particleColors: ["#e9cf9c", "#d6b47c", "#fff3d6"],
      dark: true,
    },
  },
  minimal: {
    key: "minimal",
    entrance: "fade",
    particle: "none",
    palette: {
      background: "#f6f4f0",
      base: "#f6f4f0",
      text: "#161514",
      textMuted: "#5f5a55",
      accent: "#161514",
      onAccent: "#f6f4f0",
      card: "rgb(255 255 255 / 0.85)",
      line: "rgb(22 21 20 / 0.1)",
      envelope: "#ffffff",
      envelopeFlap: "#eeebe5",
      envelopeInk: "#5f5a55",
      seal: "#161514",
      sealInk: "#f6f4f0",
      particleColors: [],
      dark: false,
    },
  },
};

export const DEFAULT_THEME_KEY: ThemeKey = "minimal";

export function isThemeKey(value: string): value is ThemeKey {
  return value in THEME_REGISTRY;
}

export function getThemeConfig(key: string): ThemeConfig {
  return isThemeKey(key) ? THEME_REGISTRY[key] : THEME_REGISTRY[DEFAULT_THEME_KEY];
}

/** Display order in the picker: most-used occasions first, the quiet default last. */
export const SELECTABLE_THEMES: ThemeConfig[] = [
  THEME_REGISTRY.romantic,
  THEME_REGISTRY.birthday,
  THEME_REGISTRY.wedding,
  THEME_REGISTRY.celebration,
  THEME_REGISTRY.elegant,
  THEME_REGISTRY.minimal,
];

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
    colorScheme: p.dark ? "dark" : "light",
  } as CSSProperties;
}

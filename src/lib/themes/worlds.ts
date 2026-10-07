import type { CSSProperties } from "react";
import { DEFAULT_TEMPLATE_ID, getTemplate, resolveTemplate } from "@/lib/templates/catalog";
import type { WorldPalette } from "@/lib/templates/schema";
import type { CompositionId, CompositionMeta } from "@/lib/templates/vocabulary";
import type { ThemeKey } from "./registry";

/**
 * Theme worlds — each template's art direction as the tokens its world
 * components consume (docs/design/theme-worlds/). Derived from the template
 * catalogue (src/lib/templates/): a world is a template's authored
 * *composition* (layout, artwork, material, scene — code) dressed in its
 * *skin* (palette and type pair — data). Two templates can share a
 * composition and still differ in palette and type.
 *
 * Screen #2 (the theme picker) renders worlds through
 * components/themes/theme-world.tsx. The editor, preview and recipient
 * reveal are meant to render the same primitives, so what a sender picks is
 * what the recipient gets.
 *
 * Fonts: each type pair is declared in components/themes/theme-world.css
 * ("Theme world type") as a Latin file plus a Georgian file under one
 * family name, so KA and EN share one voice. They load only when a world is
 * rendered near the viewport; the picker preloads the chosen world's files
 * (`fontFiles`, the same URLs).
 */

export type ThemeWorld = {
  key: ThemeKey;
  composition: CompositionId;
  /** One-line signature, for docs and debugging. */
  signature: string;
  palette: WorldPalette;
  type: { display: string; text: string };
  fontFiles: { latin: string; georgian: string };
  material: CompositionMeta["material"];
  artwork: CompositionMeta["artwork"];
  mediaFrame: CompositionMeta["mediaFrame"];
  motion: CompositionMeta["motion"];
  reveal: CompositionMeta["reveal"];
  /** The ground is dark (UI chrome drawn on top of the world adapts). */
  dark: boolean;
};

const cache = new Map<string, ThemeWorld>();

/**
 * A template's world: a specific version when given (a sent greeting's
 * recorded version), else the latest published one; the default template
 * for unknown ids.
 */
export function getThemeWorld(key: ThemeKey, version?: number): ThemeWorld {
  const cacheKey = version === undefined ? key : `${key}@${version}`;
  let world = cache.get(cacheKey);
  if (!world) {
    const t = resolveTemplate((version !== undefined && getTemplate(key, version)) || getTemplate(key) || getTemplate(DEFAULT_TEMPLATE_ID)!);
    world = {
      key: t.id,
      composition: t.spec.composition,
      signature: t.composition.signature,
      palette: t.spec.palette,
      type: { display: t.typePair.display, text: t.typePair.text },
      fontFiles: t.typePair.files,
      material: t.composition.material,
      artwork: t.composition.artwork,
      mediaFrame: t.composition.mediaFrame,
      motion: t.composition.motion,
      reveal: t.composition.reveal,
      dark: t.spec.dark,
    };
    cache.set(cacheKey, world);
  }
  return world;
}

/** A world's tokens as the --w-* custom properties its components consume. */
export function worldVars(world: ThemeWorld): CSSProperties {
  const p = world.palette;
  return {
    "--w-ground": p.ground,
    "--w-ground-deep": p.groundDeep,
    "--w-card": p.card,
    "--w-ink": p.ink,
    "--w-ink-soft": p.inkSoft,
    "--w-on-ground": p.onGround,
    "--w-accent": p.accent,
    "--w-accent-2": p.accent2,
    "--w-accent-3": p.accent3,
    "--w-light": p.light,
    "--w-rule": p.rule,
    "--w-shadow": p.shadow,
    "--w-display": world.type.display,
    "--w-text": world.type.text,
    colorScheme: world.dark ? "dark" : "light",
  } as CSSProperties;
}

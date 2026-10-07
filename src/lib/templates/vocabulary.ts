/**
 * The approved vocabulary of the Theme Experience Engine — every building
 * block a template may reference. A template is never code: it is data that
 * names blocks from these lists (docs/design/THEME-ENGINE.md).
 *
 * Rule: a block is added here in the same change that implements its
 * renderer. Nothing listed here is aspirational, so any template that
 * validates against these lists can be rendered — including one composed
 * later by a creator or by AI from a sender's description.
 *
 * Two kinds of block:
 *
 * - **Compositions** are authored: a world's layout, artwork, material and
 *   signature scene, written as code (components/themes/theme-world.tsx,
 *   theme-world.css, scenes/scenes.ts) by a designer. Few, expensive, and
 *   what makes worlds feel authored rather than recoloured.
 * - **Skins** are data: palette, type pair, room. Many templates can share
 *   one composition with different skins (a "Midnight" Romantic is a skin,
 *   not new code).
 */

/** Static assets a composition may ask the browser for. URLs live only here, never in template data. */
export const ASSETS = {
  "paper-tooth": { href: "/customer/textures/paper-tooth-256.avif", type: "image/avif" },
  "linen-rough": { href: "/customer/textures/linen-rough-256.avif", type: "image/avif" },
  "linen-rough-webp": { href: "/customer/textures/linen-rough-256.webp", type: "image/webp" },
  /** Used as a CSS mask, which is fetched in CORS mode. */
  "window-light": { href: "/customer/textures/window-light-900.avif", type: "image/avif", crossOrigin: true },
  "romantic-leaves-rest": { href: "/customer/scenes/romantic-leaves-rest.webp", type: "image/webp" },
  "celebration-sky-rest": { href: "/customer/scenes/celebration-sky-rest.webp", type: "image/webp" },
  "celebration-room": { href: "/customer/scenes/celebration-room.webp", type: "image/webp" },
} as const satisfies Record<string, { href: string; type: string; crossOrigin?: boolean }>;
export type AssetId = keyof typeof ASSETS;

/**
 * Runtime cost classes. Not shown to senders; they decide what may load and
 * when (docs/design/THEME-ENGINE.md, "Performance tiers").
 * - light: CSS only, static assets.
 * - rich: + the lazily loaded scene runtime (GSAP), small footage played once.
 * - immersive: + Rive / WebGL. No launch composition uses it; reserved, and
 *   such a composition must ship a `rich` or `light` fallback.
 */
export const TIERS = ["light", "rich", "immersive"] as const;
export type Tier = (typeof TIERS)[number];

export type CompositionMeta = {
  /** The world's one-line signature, for docs and debugging. */
  signature: string;
  material: "linen" | "paper" | "ink";
  artwork: "honeysuckle-engraving" | "cut-paper" | "olive-engraving" | "burst" | "rules" | "point";
  /** Character of its motion (QR-STARR-MOTION-LANGUAGE.md). */
  motion: "breathe" | "pop" | "ceremonial" | "strike" | "assemble" | "still";
  /** Footage or light layered into the world, played once by its scene. */
  ambience: "none" | "leaf-shadows" | "night-sky";
  /** How photos are framed inside this world (Editor / Reveal). */
  mediaFrame: "vellum-mount" | "cut-paper-slip" | "deckle-mount" | "full-bleed" | "inset-hairline" | "plain";
  /**
   * Lines of message the card is designed to hold. A longer message keeps
   * its beginning on the card and is presented in full as a letter
   * (greeting-renderer.tsx).
   */
  messageLines: number;
  /** How the message itself is revealed. */
  messageReveal: "inked-lines" | "dropped-words" | "through-light" | "equilibrium";
  /** The recipient reveal this world is designed toward. */
  reveal: "vellum-lift" | "layers-pop" | "vellum-draw" | "burst" | "type-assemble" | "words";
  tier: Tier;
  /** Approximate length of the full signature scene. */
  sceneMs: number;
  /** Rest-state assets: requested up front when this world is the chosen one (its largest paint). */
  preload: AssetId[];
};

export const COMPOSITIONS = {
  "quiet-light": {
    signature: "Leaves at the window",
    material: "linen",
    artwork: "honeysuckle-engraving",
    motion: "breathe",
    ambience: "leaf-shadows",
    mediaFrame: "vellum-mount",
    messageLines: 4,
    messageReveal: "inked-lines",
    reveal: "vellum-lift",
    tier: "rich",
    sceneMs: 4400,
    preload: ["linen-rough", "window-light", "romantic-leaves-rest"],
  },
  "paper-party": {
    signature: "Cut paper lands",
    material: "paper",
    artwork: "cut-paper",
    motion: "pop",
    ambience: "none",
    mediaFrame: "cut-paper-slip",
    messageLines: 4,
    messageReveal: "dropped-words",
    reveal: "layers-pop",
    tier: "rich",
    sceneMs: 3200,
    preload: [],
  },
  vellum: {
    signature: "The vellum ritual",
    material: "paper",
    artwork: "olive-engraving",
    motion: "ceremonial",
    ambience: "none",
    mediaFrame: "deckle-mount",
    messageLines: 5,
    messageReveal: "inked-lines",
    reveal: "vellum-draw",
    tier: "rich",
    sceneMs: 5000,
    preload: [],
  },
  signal: {
    signature: "Night of the Starr",
    material: "ink",
    artwork: "burst",
    motion: "strike",
    ambience: "night-sky",
    mediaFrame: "full-bleed",
    messageLines: 4,
    messageReveal: "through-light",
    reveal: "burst",
    tier: "rich",
    sceneMs: 3900,
    preload: ["celebration-sky-rest"],
  },
  "ink-and-stone": {
    signature: "Shutters",
    material: "linen",
    artwork: "rules",
    motion: "assemble",
    ambience: "none",
    mediaFrame: "inset-hairline",
    messageLines: 6,
    messageReveal: "inked-lines",
    reveal: "type-assemble",
    tier: "rich",
    sceneMs: 4900,
    preload: ["linen-rough"],
  },
  "just-words": {
    signature: "Equilibrium",
    material: "paper",
    artwork: "point",
    motion: "still",
    ambience: "none",
    mediaFrame: "plain",
    messageLines: 5,
    messageReveal: "equilibrium",
    reveal: "words",
    tier: "rich",
    sceneMs: 4500,
    preload: [],
  },
} as const satisfies Record<string, CompositionMeta>;
export type CompositionId = keyof typeof COMPOSITIONS;
export const COMPOSITION_IDS = Object.keys(COMPOSITIONS) as [CompositionId, ...CompositionId[]];

/**
 * Finales: how a world closes the greeting (the reveal's ending beat). A
 * finale is authored for the world it closes — it moves that composition's
 * own elements (dusk, vellum, shutters, the point…) — so each declares the
 * compositions it can close, and a template may only name a compatible one
 * (templateSpecSchema). Its resting state is CSS (theme-world.css,
 * "Finales"), which reduced motion shows directly; its motion is a scene in
 * components/themes/scenes/finales.ts.
 */
export const FINALES = {
  "evening-falls": {
    gesture: "Dusk returns to the room and the window light withdraws; the card stays lit while the closing words are inked",
    compositions: ["quiet-light"],
    ms: 3800,
  },
  "paper-encore": {
    gesture: "The closing words drop in, the cut paper hops once, a cut-paper rosette snaps onto the card",
    compositions: ["paper-party"],
    ms: 2600,
  },
  "vellum-close": {
    gesture: "The closing line is printed, then the vellum is drawn back over the card and the seal is pressed shut",
    compositions: ["vellum"],
    ms: 4200,
  },
  afterglow: {
    gesture: "Three small Starrs ignite in turn, then the Starr; the rays redraw; the closing words come through the light; a warm glow remains",
    compositions: ["signal"],
    ms: 3400,
  },
  "gallery-doors": {
    gesture: "The graphite doors glide in and stop at the card's edges, framing it as in a gallery niche; the closing words are set",
    compositions: ["ink-and-stone"],
    ms: 3600,
  },
  "full-stop": {
    gesture: "The label and rule withdraw; the vermilion point travels to the end of the message and becomes its full stop",
    compositions: ["just-words"],
    ms: 2600,
  },
} as const satisfies Record<string, { gesture: string; compositions: readonly CompositionId[]; ms: number }>;
export type FinaleId = keyof typeof FINALES;
export const FINALE_IDS = Object.keys(FINALES) as [FinaleId, ...FinaleId[]];

export function finaleFits(finale: FinaleId, composition: CompositionId): boolean {
  return (FINALES[finale].compositions as readonly CompositionId[]).includes(composition);
}

/**
 * Type pairs: one display + one text family per world, each declared in
 * components/themes/theme-world.css as a Latin file plus a Georgian file
 * under one family name, so KA and EN share one voice. Georgian for the
 * serif pairs is Screen #1's own Noto Serif Georgian variable file.
 */
export const TYPE_PAIRS = {
  "letter-italic": {
    note: "EB Garamond Italic / Noto Serif Georgian",
    display: '"QS Romantic", "QS Serif Georgian", Georgia, serif',
    text: '"QS Romantic", "QS Serif Georgian", Georgia, serif',
    files: { latin: "/fonts/themes/eb-garamond-italic-latin.woff2", georgian: "/fonts/noto-serif-georgian.woff2" },
  },
  "soft-poster": {
    note: "Fraunces (soft, wonky) / Noto Serif Georgian",
    display: '"QS Birthday", "QS Serif Georgian", Georgia, serif',
    text: '"QS Birthday", "QS Serif Georgian", Georgia, serif',
    files: { latin: "/fonts/themes/fraunces-soft-latin.woff2", georgian: "/fonts/noto-serif-georgian.woff2" },
  },
  "ceremonial-garamond": {
    note: "EB Garamond roman + italic / Noto Serif Georgian",
    display: '"QS Wedding", "QS Serif Georgian", Georgia, serif',
    text: '"QS Wedding Italic", "QS Serif Georgian", Georgia, serif',
    files: { latin: "/fonts/themes/eb-garamond-latin.woff2", georgian: "/fonts/noto-serif-georgian.woff2" },
  },
  "condensed-signal": {
    note: "Instrument Sans Condensed / Noto Sans Georgian Condensed",
    display: '"QS Celebration", system-ui, sans-serif',
    text: '"QS Celebration", system-ui, sans-serif',
    files: { latin: "/fonts/themes/instrument-sans-condensed-latin.woff2", georgian: "/fonts/themes/noto-sans-georgian-condensed.woff2" },
  },
  "didone-display": {
    note: "Gilda Display / Noto Serif Georgian",
    display: '"QS Elegant", "QS Serif Georgian", Georgia, serif',
    text: '"QS Elegant", "QS Serif Georgian", Georgia, serif',
    files: { latin: "/fonts/themes/gilda-display-latin.woff2", georgian: "/fonts/noto-serif-georgian.woff2" },
  },
  "quiet-sans": {
    note: "Instrument Sans / Noto Sans Georgian Light",
    display: '"QS Minimal", system-ui, sans-serif',
    text: '"QS Minimal", system-ui, sans-serif',
    files: { latin: "/fonts/themes/instrument-sans-latin.woff2", georgian: "/fonts/themes/noto-sans-georgian-light.woff2" },
  },
} as const satisfies Record<string, { note: string; display: string; text: string; files: { latin: string; georgian: string } }>;
export type TypePairId = keyof typeof TYPE_PAIRS;
export const TYPE_PAIR_IDS = Object.keys(TYPE_PAIRS) as [TypePairId, ...TypePairId[]];

/** Room textures (Screen #2: the whole screen takes on the chosen world). CSS values live only here. */
export const ROOM_TEXTURES = {
  "paper-tooth": "var(--cx-paper-tooth)",
  linen: 'image-set(url(/customer/textures/linen-rough-256.avif) type("image/avif"), url(/customer/textures/linen-rough-256.webp) type("image/webp"))',
  "night-sky": 'image-set(url(/customer/scenes/celebration-room.webp) type("image/webp"))',
} as const;
export type RoomTextureId = keyof typeof ROOM_TEXTURES;
export const ROOM_TEXTURE_ASSETS: Partial<Record<RoomTextureId, AssetId>> = { "night-sky": "celebration-room" };

/** Recipient renderer v1 (components/greeting/greeting-renderer.tsx). */
export const ENTRANCES = ["envelope", "balloons", "fade"] as const;
export const PARTICLES = ["none", "petals", "confetti", "sparkles", "stars"] as const;

/** Ambient theme audio: a reserved slot. Only "none" has a renderer (see THEME-ENGINE.md, "Audio"). */
export const AUDIO_MOODS = ["none"] as const;

/** Discovery taxonomy. Data, not UI: the launch picker shows one curated collection and no categories. */
export const CATEGORIES = ["love", "birthday", "wedding", "celebration", "classic", "essentials"] as const;
export const MOODS = ["intimate", "warm", "quiet", "playful", "joyful", "ceremonial", "timeless", "energetic", "proud", "refined", "restrained", "calm"] as const;
export const CONTENT_TYPES = ["text", "photo", "video", "audio"] as const;

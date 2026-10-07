import { z } from "zod";
import {
  AUDIO_MOODS,
  CATEGORIES,
  COMPOSITION_IDS,
  CONTENT_TYPES,
  ENTRANCES,
  FINALE_IDS,
  finaleFits,
  MOODS,
  PARTICLES,
  ROOM_TEXTURES,
  TYPE_PAIR_IDS,
  type RoomTextureId,
} from "./vocabulary";

/**
 * Template data model (docs/design/THEME-ENGINE.md).
 *
 * A template is a **TemplateDefinition**: catalogue metadata (id, version,
 * status, taxonomy) around a **TemplateSpec** — the composable part, built
 * only from the approved vocabulary plus validated design tokens. The spec
 * is the contract a future custom builder targets: sender intent → AI or
 * creator → TemplateSpec → `parseTemplateSpec` → the same renderer the
 * curated templates use. Never code, never free CSS.
 *
 * Every value that reaches CSS is constrained here: colours are hex or
 * rgb(), paints are gradients of colours (no url(), no var(), nothing that
 * can close a declaration), textures and fonts are ids into code-owned
 * tables.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgb\(\s*\d{1,3}\s+\d{1,3}\s+\d{1,3}(?:\s*\/\s*(?:0|1|0?\.\d+))?\s*\)$/i;

/** A single colour: #hex or rgb(r g b / a). */
export const colorSchema = z.string().refine((v) => HEX.test(v) || RGB.test(v), "Expected #hex or rgb(r g b / a)");

/** "r g b" — a colour as channels, for rgb(var(--x) / alpha). */
const channelsSchema = z.string().regex(/^\d{1,3} \d{1,3} \d{1,3}$/);

/**
 * A paint: a colour, or CSS gradients built from colours, lengths and
 * angles. Only gradient functions are allowed, and the character set cannot
 * end a declaration or open a string, so a paint can be written into a style
 * attribute or a stylesheet without escaping anything.
 */
const PAINT_CHARS = /^[a-z0-9#%().,\s/-]+$/i;
const PAINT_FUNCTIONS = new Set(["linear-gradient", "radial-gradient", "repeating-linear-gradient", "repeating-radial-gradient", "rgb", "ellipse", "circle", "at"]);
export function isSafePaint(v: string): boolean {
  if (v.length > 600 || !PAINT_CHARS.test(v)) return false;
  for (const [, fn] of v.matchAll(/([a-z-]+)\s*\(/gi)) if (!PAINT_FUNCTIONS.has(fn!.toLowerCase())) return false;
  return true;
}
export const paintSchema = z.string().refine(isSafePaint, "Expected a colour or a colour gradient");

/** The world's art-direction tokens (Screen #2, and the recipient worlds to come). */
export const worldPaletteSchema = z.strictObject({
  ground: colorSchema,
  groundDeep: colorSchema,
  card: colorSchema,
  ink: colorSchema,
  inkSoft: colorSchema,
  /** Text set directly on the ground (the opening line). */
  onGround: colorSchema,
  accent: colorSchema,
  accent2: colorSchema,
  accent3: colorSchema,
  /** Light (Romantic's window light, Celebration's signal). */
  light: colorSchema,
  rule: colorSchema,
  /** Shadow temperature, as "r g b". */
  shadow: channelsSchema,
});

/** The room: Screen #2 takes on the chosen world (body background + chrome ink). */
export const roomSchema = z.strictObject({
  base: colorSchema,
  /** The soft pool of light where the world sits. */
  glow: colorSchema,
  texture: z.enum(Object.keys(ROOM_TEXTURES) as [RoomTextureId, ...RoomTextureId[]]),
  textureSize: z.number().int().min(64).max(1024).optional(),
  /** How the texture meets the base (default soft-light). */
  blend: z.enum(["soft-light", "screen", "multiply", "overlay"]).optional(),
  /** Dark room: the shell switches to light ink (every pairing ≥ 4.5:1 — verify:templates checks it). */
  dark: z.boolean(),
});

/** Recipient renderer v1 (greeting-renderer.tsx) — the palette the live greeting uses today. */
export const greetingPaletteSchema = z.strictObject({
  background: paintSchema,
  base: colorSchema,
  text: colorSchema,
  textMuted: colorSchema,
  accent: colorSchema,
  onAccent: colorSchema,
  card: colorSchema,
  line: colorSchema,
  envelope: colorSchema,
  envelopeFlap: colorSchema,
  envelopeInk: colorSchema,
  seal: colorSchema,
  sealInk: colorSchema,
  paper: paintSchema,
  paperInk: colorSchema,
  paperInkSoft: colorSchema,
  edge: colorSchema.optional(),
  liner: paintSchema,
  particleColors: z.array(colorSchema).max(8),
  dark: z.boolean(),
});

/** The composable part of a template — the only thing a custom builder may produce. */
export const templateSpecSchema = z
  .strictObject({
    /** The authored world this template is set in (layout, artwork, material, scene). */
    composition: z.enum(COMPOSITION_IDS),
    /** How the world closes the greeting — an approved finale authored for this composition. */
    finale: z.enum(FINALE_IDS),
    type: z.enum(TYPE_PAIR_IDS),
    palette: worldPaletteSchema,
    /** The world's ground is dark (chrome drawn on top of it adapts). */
    dark: z.boolean(),
    room: roomSchema,
    greeting: z.strictObject({
      entrance: z.enum(ENTRANCES),
      particle: z.enum(PARTICLES),
      palette: greetingPaletteSchema,
    }),
    audio: z.enum(AUDIO_MOODS),
  })
  .refine((spec) => finaleFits(spec.finale, spec.composition), { message: "This finale is not authored for this composition", path: ["finale"] });

const slug = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/);

export const templateDefinitionSchema = z.strictObject({
  /**
   * Stable id. Equals `themes.key` in the database, which greetings
   * reference; never renamed or reused once published.
   */
  id: slug,
  /** Bumped when a published template changes visibly (see "Versioning" in THEME-ENGINE.md). */
  version: z.number().int().min(1),
  status: z.enum(["draft", "published", "retired"]),
  /** Who made it: the QR Starr studio, a future creator, or a sender's own (custom builder). */
  origin: z.enum(["studio", "creator", "custom"]),
  category: z.enum(CATEGORIES),
  occasions: z.array(slug).max(8),
  moods: z.array(z.enum(MOODS)).min(1).max(4),
  tags: z.array(slug).max(12),
  /** Content the template is designed to present well. */
  contentTypes: z.array(z.enum(CONTENT_TYPES)).min(1),
  /** Reserved for premium templates; every launch template is included. */
  pricing: z.enum(["included", "premium"]),
  /** Renderer contract the spec was written for. */
  renderer: z.literal(1),
  spec: templateSpecSchema,
});

export type TemplateSpec = z.infer<typeof templateSpecSchema>;
export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;
export type WorldPalette = z.infer<typeof worldPaletteSchema>;
export type GreetingPalette = z.infer<typeof greetingPaletteSchema>;
export type Room = z.infer<typeof roomSchema>;

/** The custom-builder boundary: untrusted input → a renderable spec, or the reasons it is not one. */
export function parseTemplateSpec(input: unknown) {
  return templateSpecSchema.safeParse(input);
}

import type { TemplateDefinition } from "../schema";

/**
 * Luxury Vintage — "The keepsake letter" (docs/design/signature-2/VINTAGE-PROPOSAL.md).
 * A seventh world: an antique letter on parchment in a gold Linotype vine
 * frame (1922, public domain), with a Redouté rose (Cleveland Museum of Art,
 * CC0), set in IM Fell English with a Pinyon Script hand, sealed in wax.
 */
export const luxuryVintage = {
  id: "luxury-vintage",
  version: 1,
  status: "published",
  origin: "studio",
  category: "classic",
  occasions: ["love-note", "anniversary", "birthday", "thank-you", "just-because"],
  moods: ["timeless", "refined", "intimate"],
  tags: ["letter", "parchment", "botanical", "rose", "wax-seal", "vintage"],
  contentTypes: ["text", "photo", "video", "audio"],
  pricing: "included",
  renderer: 1,
  spec: {
    composition: "keepsake",
    finale: "keepsake-seal",
    type: "fell-and-script",
    dark: true,
    palette: {
      ground: "#5a3a2c",
      groundDeep: "#24160f",
      card: "#f3e7cf",
      ink: "#3b2217",
      inkSoft: "#6e4d3c",
      onGround: "#f4e6cc",
      accent: "#a8823c",
      accent2: "#7a2433",
      accent3: "#d9b878",
      light: "#ffe2b0",
      rule: "rgb(120 84 40 / 0.32)",
      shadow: "40 22 12",
    },
    room: { base: "#2a1b15", glow: "rgb(176 128 72 / 0.3)", texture: "paper-tooth", textureSize: 256, dark: true },
    greeting: {
      entrance: "envelope",
      particle: "petals",
      palette: {
        background: "radial-gradient(120% 80% at 50% 0%, #5a3a2c 0%, #34221a 45%, #1c120d 100%)",
        base: "#1c120d",
        text: "#f4e6cc",
        textMuted: "rgb(244 230 204 / 0.74)",
        accent: "#d9b878",
        onAccent: "#2a1b15",
        card: "rgb(255 255 255 / 0.08)",
        line: "rgb(255 255 255 / 0.16)",
        envelope: "#efe0c4",
        envelopeFlap: "#e3d0ae",
        envelopeInk: "#3b2217",
        seal: "#7a2433",
        sealInk: "#f4e0d6",
        paper: "#f3e7cf",
        paperInk: "#3b2217",
        paperInkSoft: "#6e4d3c",
        liner: "repeating-linear-gradient(135deg, #7a2433 0 7px, #8e3242 7px 14px)",
        particleColors: ["#e9c6c0", "#d99a96", "#c9a466"],
        dark: true,
      },
    },
    audio: "none",
  },
} as const satisfies TemplateDefinition;

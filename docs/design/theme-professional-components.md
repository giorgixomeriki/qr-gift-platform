# Screen #2 — professional component inventory

The professional pass (2026-10-02) replaced home-made artwork and type with
professionally made resources where those beat the custom version in the real
composition. Every candidate below was rendered inside the actual theme world
(production CSS and markup, KA and EN, at the 320/390 phone slide and the 1440
stage), not judged from a catalogue thumbnail. Visual evidence:
`docs/visual-walkthrough/theme-picker-v1/_professional-resource-candidates.webp`,
`_typography-finalists.webp`, `_color-palette-study.webp`.

Ranking used for every decision: professional visual quality → emotional fit →
legal commercial use → KA/EN compatibility → performance → maintainability.

## Per theme

### Romantic — "Quiet light"

| Current custom component | Professional candidate | Source | Licence | Use / reject | Why |
|---|---|---|---|---|---|
| Hand-drawn SVG stem (4 Bézier strokes) | Honeysuckle spray, line engraving, 1775 | Wellcome Collection V0044075 via Wikimedia Commons | CC BY 4.0 (attribution in `public/customer/LICENSES.md`) | **Use** | Real burin hatching; reads as a tucked-in keepsake rather than a doodle. Honeysuckle ("bonds of love") avoids the rose / heart cliché. Printed in the room's light ink, half hidden behind the card |
| Same engraving printed on the card in wine ink | same | same | **Reject** | The vellum layer hid it; competed with the message |
| Vellum veil over the message (44% of the card) | Vellum sleeve across the card's foot, below the message (24%) | own (CSS) | — | **Use** | Final art-direction review: over the message the veil washed out EN line 2 and KA lines 2–3 at 390px. Tucked below, the layering stays physical and every line reads |
| ambientCG Fabric036 weave | "Rough Linen" | Poly Haven | CC0 | **Use** | Slub threads and irregular weave: cloth, not a repeating pattern. Lighter too (9 KB AVIF vs 25 KB) |
| Fraunces Italic (SOFT) | EB Garamond Italic | Google Fonts (Georg Duffner, Octavio Pardo) | OFL | **Use** | Reads like a hand-written letter; Fraunces' soft display italic read as a trend face. Gambetta Italic (Fontshare) was close but its licence forbids subsetting (see below) |
| Romantic accent pink | Rose-clay ground, oxblood-umber depth, aged-ivory card | colour study | — | **Use** | Moves off "burgundy/pink" into dusk-lit clay; warm umber shadows |

### Birthday — "Paper party"

| Current custom component | Professional candidate | Source | Licence | Use / reject | Why |
|---|---|---|---|---|---|
| Cut-paper disc / arc / streamer on Paper001 tooth | ambientCG Paper002 (fibre, inclusions) on the shapes | ambientCG | CC0 | **Reject** | 100% crops: flatter than the tooth; the inclusions read as dirt on saturated colour |
| Same shapes | Matisse-style cut-out vector packs | Freepik / Envato / Creative Market | Commercial | **Reject (not acquired)** | Inspected public listings only: generic "paper-cut" packs read as template art; the composition's own geometry is stronger |
| Noto Sans Georgian Bold (KA) | Noto Serif Georgian 800 / 600 | Google Fonts (already on the page) | OFL | **Use** | Georgian now shares the serif voice of EN Fraunces instead of switching to a sans; zero new bytes |
| Fraunces 800 (EN) | Young Serif; DM Serif Display | Google Fonts | OFL | **Reject** | Both less joyful at 320px; Fraunces' soft wonky heavy cut stays |
| Saturated orange / yellow / pink / teal | Persimmon ground, saffron disc, dusty peony, bottle teal | colour study | — | **Use** | Same structure; slightly less chroma, warmer shadow temperature, accents kept small |

### Wedding — "Vellum & olive" (highest priority)

| Current custom component | Professional candidate | Source | Licence | Use / reject | Why |
|---|---|---|---|---|---|
| Hand-drawn SVG olive sprig (blind emboss filter) | *Olea cuspidata* plate, W. H. Fitch del. et lith. | Brandis, *Forest Flora of North-West and Central India* (1874), Wikimedia Commons | Public domain | **Use** | A Victorian botanical lithograph line, printed letterpress-pale in olive with a faint impression, bleeding off the card under the vellum band. The material is the luxury; no flower frame |
| Same plate as pure blind emboss (no ink) | same | same | **Reject** | Physically right, but it disappeared at phone size |
| Loddiges' *Botanical Cabinet* no. 456 (*Olea europaea*, G. Cooke sc.) | Wikimedia Commons | Public domain | **Reject** | Hand-coloured; the colour can't be separated cleanly from the line |
| Cooper Hewitt "Cartouche with two laurel branches" (1738) | Wikimedia Commons | Public domain | **Reject** | Rococo cartouche — period costume, not today's ceremony |
| QR Starr spark between lines | EB Garamond fleuron ❦ (U+2766) | Google Fonts | OFL | **Reject** | Beautiful, but the Starr is the brand's mark across every world |
| Pale greige ground | Sage-stone ground (#b4b6a4), cotton-white card, olive-black ink | colour study | — | **Use** | The single biggest improvement: the card now glows against a confident ground instead of pale-on-pale |
| ambientCG Paper002 cotton as card stock | ambientCG | CC0 | **Reject** | Invisible on near-white stock at the intended strength |
| Cormorant Garamond 500 | EB Garamond + EB Garamond Italic (EN); Noto Serif Georgian 400 / 300 (KA) | Google Fonts | OFL | **Use** | Roman opening + italic message gives a ceremonial pairing; KA opening at 400 gains presence (300 looked faint); the KA message moved 300 → 380 in the final review, as 300 broke up at ~11px on phones. Libre Caslon Display was the runner-up |

### Celebration — "Signal"

| Current custom component | Professional candidate | Source | Licence | Use / reject | Why |
|---|---|---|---|---|---|
| QR Starr sparks | Phosphor Icons "Sparkle" (fill) | Phosphor (already a dependency) | MIT | **Reject** | Rendered in place it reads as a UI icon; the brand Starr is crisper and on-identity |
| Hairline burst (26 rays, CSS-drawn dash animation) | Starburst / sunburst vector packs | Freepik, Envato Elements, Adobe Stock (public listings) | Commercial | **Reject (not acquired)** | Listings are poster/fireworks/casino idioms; none beat the controlled hairline fan |
| Instrument Sans Condensed 700 | Archivo ExtraCondensed 800; Sofia Sans Extra Condensed 800 | Google Fonts | OFL | **Reject** | No visible gain over the current voice at any size |
| Generic navy | Midnight-ink ground, marigold-brass, dusty periwinkle | colour study | — | **Use** | Less digital blue; brass reads premium rather than "gold" |

### Elegant — "Ink & stone"

| Current custom component | Professional candidate | Source | Licence | Use / reject | Why |
|---|---|---|---|---|---|
| Bodoni Moda (EN) | Gilda Display | Google Fonts (Eduardo Tunni) | OFL | **Use** | Didone contrast without the fashion-magazine chill; Bodoni's hairlines broke up at 216px. Playfair (opsz) was the runner-up. KA: Noto Serif Georgian 250 opening, 380 message (300 was too faint on phones) |
| Noto Serif Georgian Condensed (separate file) | Noto Serif Georgian, normal width, 250 | Google Fonts (already on the page) | OFL | **Use** | Reads better than the condensed cut and removes a 32 KB file |
| Fabric036 weave under ink | Poly Haven Rough Linen | Poly Haven | CC0 | **Use** | Real cloth under the ink |
| Flat near-black #1d1b19 | Warm graphite #282421, bone card #e3dbcf | colour study | — | **Use** | Ink and graphite, not digital black |

### Minimal — "Just the words"

| Current custom component | Professional candidate | Source | Licence | Use / reject | Why |
|---|---|---|---|---|---|
| Instrument Sans + Noto Sans Georgian Light | Hanken Grotesk + FiraGO Light; Switzer + Noto Sans Georgian SemiCondensed | Google Fonts; bBox Type; Fontshare | OFL; OFL; ITF FFL | **Reject** | Current pairing stays the most intentional; Minimal adds nothing for the sake of it |
| Paper001 tooth card | ambientCG Paper002 cotton | ambientCG | CC0 | **Reject** | Invisible at the intended strength |
| Vermilion point #d2452a | Oxide/cinnabar #c0472c | colour study | — | **Use** | The one accent, less screen-red |

### Selectors (seals)

| Current custom component | Replacement | Why |
|---|---|---|
| Round colour discs with a glyph | 4:5 tiles, each a miniature of its world: the honeysuckle (Romantic), layered cut paper (Birthday), a framed card carrying the olive (Wedding), the hairline burst + Starr (Celebration), framed bone card + rule (Elegant), the point and words (Minimal) | They preview identity, not colour. Engraving seals use dedicated 112px crops (3–7 KB), not the full artwork |

## Paid resources worth considering

| Resource | Source | Price / licence (public) | Would improve | Why |
|---|---|---|---|---|
| **Lava Georgian** (Akaki Razmadze, Peter Biľak) | Typotheque — typotheque.com/fonts/lava/georgian | Commercial; per-style web/desktop licences (price shown at checkout); 12 styles incl. italics | Romantic, Wedding, Elegant (KA) | TDC-recognised text serif with true Georgian design (not a Noto adaptation); would give KA a second serif voice with real italics. **The single purchase most likely to raise Georgian typography materially** |
| **Adapter Georgian** (Ana Sanikidze) | Rosetta — rosettatype.com/AdapterGeorgian | from €45 / style, family from €265 | Minimal, Celebration (KA) | Best-in-class Georgian sans with true italics; would replace Noto Sans Georgian |
| Sabon Georgian (Akaki Razmadze) | Linotype / MyFonts | $67.99 / style; family $209.99 | Wedding (KA) | Classical Garalde Georgian that pairs naturally with EB Garamond |
| Graphik Georgian | Type Today | from $60 desktop+web | Celebration (KA) | Crisp grotesk; a smaller step up than Adapter |
| Botanical line-art / emboss packs | Creative Market, Envato Elements, Freepik, Adobe Stock | Commercial / subscription | — | **Not recommended.** From public listings: generic invitation styling; the public-domain engravings above are better drawn |

## Free resources evaluated and rejected (licence)

| Resource | Licence | Reason |
|---|---|---|
| Fontshare (Gambetta, Switzer) | ITF Free Font License v2 — commercial and self-hosting allowed, but subsetting / format conversion counts as a Derivative Work needing written consent | We'd have to ship unsubset official WOFF2 files; Gambetta was not better enough to justify that |
| BPG Georgian families | GPL-2 without font exception | Web-embedding risk |
| IM Fell Flowers (letterpress ornaments) | OFL | Source site has moved; EB Garamond's own fleurons were evaluated instead (and rejected for the Starr) |
| LottieFiles | varies | No motion needed a runtime; still rejected |

## System

- **Display / body / microcopy.** Each world: display = `--w-display`, body =
  `--w-text`; microcopy (labels, the step, the picker UI) stays in the app's
  Google Sans so the worlds never compete with the interface.
- **Shared families.** EB Garamond serves Romantic (italic) and Wedding (roman +
  the same italic file). Noto Serif Georgian (Screen #1's variable file,
  wght 100–900) serves Georgian for Romantic, Birthday, Wedding and Elegant.
- **Colour roles** per world (`src/lib/themes/worlds.ts`): ground, ground-deep,
  card (surface), ink, ink-soft (secondary), on-ground, accent / accent-2 /
  accent-3 (decorative tones), light (highlight temperature), rule, and the new
  **shadow** (shadow temperature: every world's shadows now use its own warm or
  cool shade instead of a shared black).

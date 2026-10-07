# Theme worlds

Six greeting worlds, one per theme ID (`romantic`, `birthday`, `wedding`,
`celebration`, `elegant`, `minimal`; IDs and database values unchanged).

Two layers:

- **QR Starr application UI** (header, progress, selector, action): Google
  Sans, the customer design language, the same on every theme.
- **The greeting world** (what the recipient will receive): owned by the
  theme, with its own composition, type, material, artwork and motion.

Each world is a template (`src/lib/templates/definitions/<id>.ts`) set in an
authored composition (`quiet-light`, `paper-party`, `vellum`, `signal`,
`ink-and-stone`, `just-words` — `src/lib/templates/vocabulary.ts`) with its
own palette, type pair and room; see `../THEME-ENGINE.md`. The renderer view
is `src/lib/themes/worlds.ts`; the world artwork, card face and scenes are in
`src/components/themes/`. The picker
renders them today. The editor, preview and recipient reveal are meant to
render the same primitives, so what is picked is what is sent.

Structural signatures, so the worlds stay distinct without colour (the
grayscale test):

| World | Ground | Composition | Type | Artwork |
|---|---|---|---|---|
| Romantic | mid-dark rose-clay, light patches | card offset, behind a vellum veil | letter-writing italic (EB Garamond) | a 1775 honeysuckle engraving tucked behind the card |
| Birthday | saturated, mid | poster, layered cut paper | heavy wonky serif | paper circles, a cut streamer |
| Wedding | sage stone | centred, symmetrical, framed | EB Garamond roman + italic | Fitch's 1874 olive printed pale + pressed, double rule, vellum band |
| Celebration | dark | asymmetric, burst behind type | condensed bold sans | radiating lines |
| Elegant | darkest | tall narrow card, vast negative space | Didone / thin condensed | hairline rules |
| Minimal | lightest | left-aligned grid, words only | quiet sans | one vermilion point |

> **Professional pass (2026-10-02).** Type, palettes, materials and artwork were re-evaluated against professional resources; the decisions and the rejected candidates are in `../theme-professional-components.md`.

> **WOW pass (2026-10-04).** Each world now has ONE signature moment (see each file's *Motion personality*); the system is defined in `../QR-STARR-MOTION-LANGUAGE.md`, the research in `../theme-wow-research.md`.

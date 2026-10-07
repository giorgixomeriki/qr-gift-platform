# Screen #2 — Theme Picker: resource study

Research for the six greeting worlds (Romantic, Birthday, Wedding,
Celebration, Elegant, Minimal), done before implementation. Every resource
that ships is also registered in `public/customer/LICENSES.md`.

Method: as on Screen #1. Fonts were judged only from real Georgian renders
of the production strings (theme name, the theme's localized opening line,
a sample message), at the desktop preview size and in a 320px phone column
(`docs/visual-walkthrough/theme-picker-v1/_theme-typography-study.webp`).

## What exists for Georgian (re-checked 2026-10-01)

- Google Fonts: 3 families with Georgian — Google Sans, **Noto Sans
  Georgian** (wdth 62.5–100, wght 100–900), **Noto Serif Georgian** (wdth
  62.5–100, wght 100–900). Our self-hosted Noto Serif Georgian file has the
  wdth axis stripped; the full variable font restores it.
- Fontshare: 0 families with Georgian.
- FiraGO (bBox Type, OFL): Thin–Heavy plus italics, Georgian by Akaki Razmadze.
- Zoto Serif Georgian (FontLab GetGo, Apache 2.0): a Noto Serif Georgian
  derivative, so it adds nothing.
- BPG families (Debian `fonts-bpg-georgian`): GPL-2 **without** a font
  exception, a licensing risk for web embedding.
- Paid: **Adapter Georgian** (Rosetta; Ana Sanikidze, David Březina),
  ExtraLight–Black with true italics, variable, €265 for the family.

So Georgian expression comes from the two Noto variable families' axes
(weight and width), each paired deliberately with a Latin face of the same
emotional character.

## Superseded by the professional pass (2026-10-02)

The matrix below is the first-pass record. Its type, texture and artwork
decisions were re-run against professional resources in the real compositions;
the current decisions (EB Garamond for Romantic/Wedding, Gilda Display for
Elegant, Noto Serif Georgian for every serif world's Georgian, Poly Haven rough
linen, period engravings for Romantic and Wedding, refined palettes) are in
`theme-professional-components.md`. Rows still marked **Use** below remain
valid unless that document says otherwise.

## Decision matrix

| Category | Theme | Resource | Source | Creator | Licence | Format | Visual value | Perf cost | Use / reject | Reason |
|---|---|---|---|---|---|---|---|---|---|---|
| Type (EN display) | Romantic | Fraunces Italic, SOFT 100 | Google Fonts | Undercase Type | OFL | woff2 subset, wght 300–400 instance | High: warm, round, personal | ~30 KB | **Use** | Clearly warmer and more intimate than the alternatives at both sizes |
| Type (KA display) | Romantic / Wedding | Noto Serif Georgian 300 | Google Fonts (already self-hosted) | Google | OFL | existing file | High | 0 | **Use** | The tuned Screen #1 Georgian; already loaded |
| Type | Romantic | Cormorant Garamond Italic | Google Fonts | Christian Thalmann | OFL | — | Medium | — | Reject | Too thin at 320px; tiny x-height next to Georgian |
| Type | Romantic | Newsreader Italic | Google Fonts (self-hosted) | Production Type | OFL | — | Medium | 0 | Reject | Screen #1's own voice, so Romantic would read as the app |
| Type (EN display) | Birthday | Fraunces 800, SOFT 100, WONK | Google Fonts | Undercase Type | OFL | woff2 subset, wght 600–800 | High: fun without childishness | ~35 KB | **Use** | Soft, wonky heavy serif: celebratory and sophisticated |
| Type (KA display) | Birthday / Celebration / Minimal | Noto Sans Georgian (variable) | Google Fonts | Google | OFL | woff2, Georgian subset, wdth 62.5–100, wght 300–800 | High | ~55 KB, shared by 3 worlds | **Use** | One file gives heavy (Birthday), condensed (Celebration) and light (Minimal) |
| Type | Birthday | Bricolage Grotesque condensed | Google Fonts | Mathieu Triay | OFL | — | Medium | — | Reject | Reads as a sports poster |
| Type | Birthday | FiraGO Heavy | bBox Type | Akaki Razmadze et al. | OFL | — | Medium | — | Reject | Friendly but generic; one more family for no gain |
| Type (EN display) | Wedding | Cormorant Garamond 500 | Google Fonts | Christian Thalmann | OFL | woff2 subset, wght 400–500 | High: formal, timeless | ~35 KB | **Use** | Ceremonial Garamond; Georgian partner holds its rhythm |
| Type | Wedding | Italiana | Google Fonts | Santiago Orozco | OFL | — | Medium | — | Reject | Latin-only display caps; KA would lose the voice |
| Type (EN display) | Celebration / Minimal | Instrument Sans (variable) | Google Fonts | Instrument | OFL | woff2 subset, wdth 75–100, wght 400–700 | High | ~40 KB, shared by 2 worlds | **Use** | Condensed bold for Celebration's poster voice, regular for Minimal |
| Type | Celebration | Bodoni Moda 700 | Google Fonts | Owen Earl | OFL | — | Low | — | Reject | Luxury, not achievement |
| Type (EN display) | Elegant | Bodoni Moda 400, opsz 96 | Google Fonts | Owen Earl | OFL | woff2 subset, static instance | High: architectural contrast | ~25 KB | **Use** | Didone hairlines, distinct from Wedding's Garamond |
| Type (KA display) | Elegant | Noto Serif Georgian Condensed (wdth 75, wght 200–300) | Google Fonts | Google | OFL | separate woff2 instance | High: tall, thin, architectural | ~45 KB | **Use** | Matches Bodoni's verticality; separate file so Screen #1 is untouched |
| Type | Elegant | Instrument Serif | Google Fonts | Instrument | OFL | — | Medium | — | Reject | Fashionable, but reads as magazine rather than luxury |
| Type | Minimal | Google Sans | self-hosted | Google | OFL | — | Medium | 0 | Reject | The app's UI face, so the world would blur into the shell |
| Type (paid) | any | Adapter Georgian | Rosetta | A. Sanikidze, D. Březina | Commercial (€265 family) | — | High | — | Candidate only | Best Georgian sans with true italics; not acquired |
| Type | any | BPG Nateli / Chveulebrivi | Debian | BPG-InfoTech | GPL-2, no font exception | — | Medium | — | Reject | Licensing risk |
| Texture | Romantic, Elegant | ambientCG Fabric036 (linen weave) | ambientCG | ambientCG | CC0 | 256 px seamless grey relief tile, AVIF/WebP | Medium-high: woven material, tinted per world | ~10 KB | **Use** | Linen read through soft-light, never as a visible tile |
| Texture | Wedding, Minimal, Birthday, cards | ambientCG Paper001 tooth (existing) | ambientCG | ambientCG | CC0 | existing 12 KB tile | High | 0 | **Use** | Card stock everywhere |
| Texture | — | Fabric019/032, Paper003 (creased) | ambientCG | ambientCG | CC0 | — | Low | — | Reject | Wool is too fuzzy; creased paper is a scrapbook look |
| Photography | Romantic | "white painted wall" (window light) | Unsplash `PrZw3_3xUxI` | Bernard Hermant | Unsplash License (free) | light map: divided by its wall, grey, AVIF/WebP | High: intimate window light | ~15 KB | **Use** | Used as light, not as a picture |
| Photography | Romantic | blush silk / pink chiffon | Unsplash | various | free | — | Low | — | Reject | Lingerie-advert feel; pink overload |
| Photography | Wedding | olive branch on white | Unsplash | various | free | — | Medium | — | Reject | A custom line drawing is truer to "restrained botanical line art" |
| Photography | Romantic | sheer draped fabric | Unsplash `u8maxDvbae8`, `812n5mwir8w` | Max Berg, Tsuyoshi Kozu | free | — | Medium | — | Reject | The vellum layer does this in live HTML/SVG |
| Illustration | all | Custom SVG (stem, olive sprig, cut-paper forms, burst, frames, Starr marks) | QR Starr | — | own | inline SVG | High | ~0 (inline) | **Use** | Brand-specific; recolourable through theme tokens |
| Illustration (paid) | Wedding / Romantic | Botanical line-art packs | Creative Market, Envato, Freepik, Adobe Stock | — | Commercial | — | Medium | — | Not needed | Account-gated; not inspected beyond public listings. Custom SVG covers the need |
| Motion | all | LottieFiles + lottie-web | LottieFiles | — | varies | ~250 KB runtime | Low | High | Reject | Every theme motion is a short CSS/SVG transform |
| Motion | all | Native CSS / SVG animation | — | — | — | — | High | 0 | **Use** | Matches Screen #1's motion discipline |
| Motion | transition | View Transitions API | Browser | — | — | — | Medium | 0 | **Prototype** | React 19.2 stable has no `ViewTransition`; only a hand-rolled `document.startViewTransition` would work |

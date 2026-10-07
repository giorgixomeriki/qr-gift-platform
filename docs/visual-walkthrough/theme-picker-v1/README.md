# Screen #2 v1 — Theme Picker ("How should it feel?")

Six theme worlds rendered as the recipient will meet them (live HTML type,
real material, per-world composition), chosen through one radio group.
Art direction: `docs/design/theme-worlds/`; resources and licences:
`docs/design/theme-picker-resource-study.md`, `public/fonts/themes/OFL-*.txt`,
`public/customer/LICENSES.md`.

Screen #1 is untouched (pixel-identical to the frozen build at
360/390/768/1440, KA and EN). Theme IDs, `updateThemeAction`, radiogroup
semantics and the wizard flow are unchanged.

## Sheets

All captured from a production build (`next build && next start`). Committed
as WebP (q82); raw per-viewport PNGs stay out of git.

| Sheet | What it shows |
|---|---|
| `_theme-picker-mobile-contact-sheet.webp` | 320 · 360 · 390 · 430 · 768, KA and EN. 320 is allowed to scroll (sticky action) |
| `_theme-picker-desktop-contact-sheet.webp` | 1024×768 (tighter list on short desktops) and 1440×900, KA and EN |
| `_all-six-themes.webp` | The six worlds in context (390 KA), unlabeled, and in grayscale — they stay identifiable by structure |
| `_theme-typography-study.webp` | Each world's final pairing with real KA and EN strings at stage size |
| `_theme-material-study.webp` | 100% crops of each world's material (linen, window light, paper tooth, vellum + emboss, ink) |
| `_selection-states.webp` | Seals (phones) and list rows (desktop): chosen, hover, keyboard focus; reduced motion at rest |
| `_typography-finalists.webp` | **Professional pass.** Per world: CURRENT vs candidate A vs B, KA then EN, at 216 · 304 · 544 px (320 phone · 390 phone · 1440 stage), production strings in the real composition |
| `_color-palette-study.webp` | **Professional pass.** CURRENT vs REFINED palette per world on the same markup (colour judged in isolation): role swatches with proportions measured from the render, type on ground, 100% material crop, shadow temperature |
| `_professional-resource-candidates.webp` | **Professional pass.** Candidate resources rendered inside each world (engravings, Poly Haven linen, ambientCG Paper002, Phosphor Sparkle, EB Garamond fleuron); decisions in `docs/design/theme-professional-components.md` |
| `_before-after-professional-pass.webp` | **Professional pass.** Each world before / after (EN · KA stage), the mobile selector, and the overall 390 KA screen (Minimal default, Wedding) |
| `_REJECTED-shared-element-transition.webp` | **Rejected.** The Screen #1 → #2 `startViewTransition` prototype: double exposure mid-transition, and it needed changes to Screen #1's frozen card layer. Reverted; kept only as evidence |

## Loading model

- **Chosen world — critical.** Its ground material (paper tooth; linen for
  Romantic/Elegant) is preloaded at high priority and its two font files
  (Latin; Georgian on KA) are preloaded from the head, so they start with the
  app's own fonts instead of after CSS + layout.
- **Neighbours — after idle.** On phones a world's typefaces apply only once
  it is within ±60% of the gallery's width, observed after
  `requestIdleCallback` (timeout fallback where unsupported). The peeking
  neighbour shows its material at low priority.
- **Far worlds — on intent.** Hovering or focusing a seal/row warms that
  world's fonts before it is chosen. Desktop renders only the chosen world.
- **Motion** plays once on selection (`data-active`); inactive worlds are
  static; reduced motion shows the finished state.
- **CSS** lives with its components (`components/themes/theme-world.css`,
  `components/greeting/theme-picker.css`), not in `globals.css`.

## Performance (production, medians of 7 runs; professional pass, 2026-10-02)

Phone: 390×844 @3x, 4× CPU, 1.6 Mbps / 150 ms. Desktop: 1440×900 @2x, same
network, no CPU throttle. KA locale. "Before" = the committed build with the
old 2×3 theme grid.

| Profile | First paint | LCP | CLS | Transferred |
|---|---|---|---|---|
| Screen #1, phone — before / after | 904 / 872 ms | 1076 / 1048 ms | 0 / 0 | 523 / 533 KB |
| Screen #1, desktop — before / after | 940 / 916 ms | 1732 / 1708 ms | 0.0004 / 0.0004 | 573 / 583 KB |
| Theme Picker, phone (Minimal) — before / after | 936 / 968 ms | 1172 / 1032 ms | 0 / 0.0001 | 449 / 611 KB |
| Theme Picker, desktop (Minimal) — before / after | 916 / 944 ms | 1176 / 984 ms | 0 / 0 | 449 / 550 KB |
| Theme Picker, phone (Romantic) — before / after | 932 / 960 ms | 1164 / 1028 ms | 0 / 0.0001 | 449 / 646 KB |
| Theme Picker, desktop (Romantic, 11 runs) — before / after | 908 / 952 ms | 1168 / 988 ms | 0.0001 / 0 | 449 / 542 KB |
| Theme Picker, phone (Wedding) — before / after | 936 / 964 ms | 1156 / 1068 ms | 0 / 0.0007 | 449 / 683 KB |
| Theme Picker, desktop (Wedding) — before / after | 904 / 936 ms | 1168 / 976 ms | 0.0001 / 0.0006 | 449 / 574 KB |

Desktop Romantic is bimodal (~960–990 ms or ~1190 ms, depending on whether
the linen tile lands before the ground's first paint); both modes are at or
under the old grid. The first, unoptimised Screen #2 measured ~3250 ms (phone)
/ ~2930 ms (desktop) LCP. Screen #1 is pixel-identical to the frozen build
(360/390/768/1440, KA and EN).

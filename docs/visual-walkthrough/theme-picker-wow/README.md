# Screen #2 — WOW pass (signature interaction + professional components)

Builds on the approved professional pass (`../theme-picker-v1/`, unchanged).
Each world now has ONE signature moment, switching worlds is a choreographed
change, the phone gallery tracks the finger, selectors answer in their
world's gesture, and the chosen world is larger on real phones. System:
`docs/design/QR-STARR-MOTION-LANGUAGE.md`; research and scores:
`docs/design/theme-wow-research.md`.

All captures from a production build (`next build && next start`). Motion is
shown as frames frozen at fixed times (Web Animations API), so sheets are
deterministic. Committed as WebP; recordings stay local (gitignored).

## Sheets

| Sheet | What it shows |
|---|---|
| `_before-after-wow-pass.webp` | **Start here.** Each world: professional pass vs WOW pass at 0 · 250 · 600 ms and at rest; the mobile picker at a real phone height (393×739) and tall (430×932); selectors on press |
| `_all-six-wow-final.webp` | The six signatures through time (390, KA) |
| `_theme-wow-prototypes.webp` | Every prototype candidate vs the current motion, with winners and rejects; the gallery swipe study |
| `_wow-resource-board.webp` | Signatures, measured engine costs, spring curves, gallery depth, desktop sheet change, selector identity, paid and rejected resources |
| `_mobile-wow-contact-sheet.webp` | 320×640 · 360×740 · 390×664 · 393×739 · 390×844 · 430×932 · 768×1024, KA and EN (Wedding) |
| `_desktop-wow-contact-sheet.webp` | 1024×768 and 1440×900, KA and EN: Wedding at rest, then the sheet change to Celebration at 120 / 300 / 700 ms |
| `_selector-interactions.webp` | Press, then each world's selector gesture at 60 / 220 / 700 ms; desktop hover and keyboard focus |

Local recordings (not committed): `recording-phone-ka.webm`,
`recording-phone-en.webm` (393×739: entrance from Screen #1, each world, a
swipe, rapid taps) and `recording-desktop-en.webm` (1440×900). Headless
recordings drop frames — judge smoothness on a device.

## What changed

- **Signatures** (`components/themes/theme-world.css`): Romantic *light finds
  the letter*, Wedding *the vellum is drawn off*, Birthday *cut paper snaps
  in*, Celebration *ignition*, Elegant *aperture*, Minimal *the words
  resolve*. Full the first time, short (×0.6) when seen or switching fast, no
  replay on re-choosing; entrance plays when arriving from Screen #1, never
  on a direct load (LCP).
- **Switching**: phones — scroll-driven depth (size, light, ground parallax
  track the finger); desktop — the new sheet is laid over the old, which
  stays beneath (no blank frame).
- **Selectors**: press compression with spring release; one ~0.6 s gesture
  per world on choosing.
- **Mobile composition**: hero world 84vw on tall phones; on real phone
  heights (≤760px) the mood line yields to the world and the world is sized
  from the measured chrome: 393×739 255 → 290 px wide, 390×664 216 → 230 px.
- **Fix**: the last world (Elegant) centred 16px short after tapping its seal
  (offsetParent bug in the gallery; present before this pass).
- **Reduced motion**: a designed 240 ms opacity-only fade; no movement, no
  scroll-driven depth.
- **Dependencies**: none added. Spring easings are precomputed CSS `linear()`.

## Performance (production, medians of 7; KA; phone 390×844 @3x, 4× CPU, 1.6 Mbps/150 ms; desktop 1440×900 @2x)

"Before" = the professional pass (frozen copy of the working tree).

| Profile | LCP before / after | CLS before / after | Transferred |
|---|---|---|---|
| Theme Picker phone (Minimal) | 1036 / 1032 ms | 0.0001 / 0.0001 | 611 / 614 KB |
| Theme Picker desktop (Minimal) | 972 / 996 ms | 0 / 0 | 549 / 552 KB |
| Theme Picker phone (Romantic) | 1040 / 1040 ms | 0.0001 / 0.0001 | 645 / 648 KB |
| Theme Picker phone (Wedding) | 1068 / 1072 ms | 0.0007 / 0.0007 | 682 / 685 KB |
| Screen #1 phone | 1044 / 1052 ms | 0 / 0 | 533 / 535 KB |
| Screen #1 desktop | 1692 / 1704 ms | 0.0004 / 0.0004 | 582 / 585 KB |

Route JS `/g/[token]`: 32.7 → 33.0 kB. Interaction (4× CPU, 390 phone):
longest input event 88 ms; a full Wedding signature had 0 frames over 50 ms.
Screen #1 is pixel-identical to the professional pass at 320/360/390/768/1440,
KA and EN.

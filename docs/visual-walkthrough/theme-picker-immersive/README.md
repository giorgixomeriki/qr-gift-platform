# Screen #2 — Immersive pass + Theme Experience Engine

Builds on `../theme-picker-wow/` (signatures, motion language) and the
immersive scenes (GSAP timelines, real footage as light) that followed it.
This pass: **18 directions explored and the six selected**, the picker moved
onto a scalable template engine (`docs/design/THEME-ENGINE.md`), a design
arsenal (`docs/design/QR-STARR-DESIGN-ARSENAL.md`), one new interaction,
two fixes, and full KA/EN responsive QA.

All captures: production build (`next build && next start`), Chromium,
deviceScaleFactor 2. Committed as WebP; raw PNGs and recordings stay local
(gitignored).

## Sheets — start here

| Sheet | What it shows |
|---|---|
| `_signatures-through-time-390-ka.webp` | **Start here.** The six signatures at 250 / 900 / 1800 / 3000 / 5500 ms (390, KA), final build |
| `_six-worlds-320-ka-en.webp` | All six worlds at rest at 320 px, KA and EN |
| `_six-worlds-1440-ka-en.webp` | All six at 1440 (list + stage), KA and EN |
| `_responsive-matrix-ka-en.webp` | 320 · 390 · 768 · 1024 · 1440 × KA/EN (default world) |
| `_replay-phone-390-ka.webp` | New: tap the chosen world → its signature plays again (Wedding, KA) |
| `_replay-desktop-1440.webp` | Same on the desktop stage (Celebration, EN); shows the action-bar fix |
| `_before-after-caption-contrast.webp` | Every pixel this pass changed on Screen #2 at rest (red): the caption ink only |
| `_screen-1-unchanged.webp` | Screen #1 at all five widths × KA/EN — pixel-identical to before this pass |

## 1. Signature definitions (the six launch worlds)

| | Romantic | Birthday | Wedding | Celebration | Elegant | Minimal |
|---|---|---|---|---|---|---|
| **Emotional intention** | Being thought of, quietly | Delight, being celebrated | Ceremony, permanence | Pride, a moment to mark | Respect, restraint | Sincerity, nothing in the way |
| **Visual world** | A room at dusk; window light; leaf shadows | A paper poster on a bright table | Sage stone; letterpress invitation | Night sky; a single burst of light | Graphite; an editorial page | A white page |
| **Material** | Rough linen, aged ivory card, vellum | Cut paper, cotton card | Cotton card, vellum, blind emboss | Ink-dark ground, cream card | Linen-stone, tall card, hairlines | Paper, one vermilion point |
| **Typography** | Letter-writer's italic (EB Garamond Italic / Noto Serif Georgian 340) | Soft wonky serif (Fraunces) | Garamond roman + italic, centred | Condensed bold sans (Instrument Sans Condensed / Noto Sans Georgian Condensed) | Didone display (Gilda) | Quiet sans (Instrument Sans / Noto Sans Georgian Light) |
| **Motion language** | Slow, warm, light travels | Fastest, snap, overshoot ≤ 10% | Slowest, deliberate hand | Darkness → ignition → stillness | Aperture, drawn rules | Least motion; balance |
| **Signature interaction** | *Leaves at the window* | *Cut paper lands* | *The vellum ritual* | *Night of the Starr* | *Shutters* | *Equilibrium* |
| **Preview behaviour** | 4.4 s full, ×1.8 short; footage (79 KB) only when played | 3.2 s | 5.0 s | 3.9 s; sky footage (185 KB) when played | 4.9 s | 4.5 s |
| **Recipient reveal relationship** | Vellum lifts off the card (`vellum-lift`) | Layers pop in (`layers-pop`) | Vellum drawn, seal pressed (`vellum-draw`) | Burst behind the message (`burst`) | Type assembles in the frame (`type-assemble`) | Words resolve (`words`) |
| **Mobile** | Hero world 84vw in a swipe gallery; pointer depth off on touch | same | same | same | same | same |
| **Reduced motion** | Rest state, 240 ms opacity fade; no footage | ← same for all six | | | | |

Per-world art direction: `docs/design/theme-worlds/*.md`.

## 2. Eighteen directions

Scores 1–5: **E**motion · **O**riginality · **M**obile safety · **F**it with
the motion language. Complexity S/M/L. Selected in **bold**.

### Romantic

| # | Direction | Concept & interaction | Tech · Arsenal | Cx | Mobile risk | E | O | M | F | Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | **Leaves at the window** | Dusk lifts; window light and real leaf shadows travel across linen; honeysuckle grows; the card is set down; words inked | CSS rest + GSAP + SplitText; Pexels footage as light map, Poly Haven linen, Wellcome engraving | M | Low (79 KB, played once, still at rest) | 5 | 5 | 4 | 5 | **Selected** — the most intimate; light is the material |
| R2 | The letter under vellum | Drag a vellum sheet off a folded letter to read it | GSAP Draggable / pointer events | M | **High** — fights the horizontal gallery swipe | 4 | 4 | 2 | 4 | Moved to the **recipient reveal** (one card, no gallery) |
| R3 | Candle & handwriting | A candle glow grows; the opening line writes itself | SVG stroke handwriting | M | Low | 4 | 3 | 4 | 3 | Rejected — no Georgian handwriting outlines; KA would fall back to roman, breaking parity |

### Birthday

| # | Direction | Concept & interaction | Tech · Arsenal | Cx | Mobile risk | E | O | M | F | Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | **Paper party** | Shapes arrive, words drop in, the card is tossed, cut paper bursts under real physics and lands *composed* | GSAP Physics2D + SplitText; own cut-paper geometry | M | Low | 5 | 4 | 5 | 5 | **Selected** — joy without confetti clichés; ends as a designed poster |
| B2 | Pop-up card | A folded card opens with pop-up layers in perspective | CSS 3D transforms | L | Medium (3D on low-end, text in perspective) | 4 | 3 | 3 | 2 | Rejected for the picker — the motion language bans 3D flips; candidate for a premium reveal |
| B3 | Blow out the candle | Hold to blow; confetti | Pointer hold + particles | S | Low | 3 | 1 | 4 | 1 | Rejected — childish, generic, "particles" |

### Wedding

| # | Direction | Concept & interaction | Tech · Arsenal | Cx | Mobile risk | E | O | M | F | Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | **The vellum ritual** | Sealed vellum; the seal is pressed; the sheet is drawn up; olive grows; light passes over the letterpress | GSAP; Fitch 1874 olive (PD); custom vellum CSS | M | Low | 5 | 5 | 5 | 5 | **Selected** — ceremony as a gesture, timeless |
| W2 | Raking light over emboss | A light sweeps across a blind-embossed card | CSS | S | — | 3 | 4 | 1 | 4 | Rejected (WOW pass) — invisible on phones |
| W3 | Untying the ribbon | A satin ribbon unties, answering the finger | Rive state machine (~54 KB JS + ~880 KB wasm) | L | High on a QR scan | 5 | 4 | 2 | 4 | Deferred — immersive-tier **recipient** reveal candidate; needs commissioned art |

### Celebration

| # | Direction | Concept & interaction | Tech · Arsenal | Cx | Mobile risk | E | O | M | F | Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | **Night of the Starr** | Darkness; the sky appears; a tiny Starr holds its breath and ignites; rays draw; words appear through the light | GSAP (stroke draw, SplitText); Mixkit night-sky footage | M | Low–medium (185 KB footage) | 5 | 5 | 4 | 5 | **Selected** — a climax built from the brand mark, not fireworks |
| C2 | Fireworks / confetti cannon | Bursts across the screen | Particles / Lottie | S | Medium | 3 | 1 | 3 | 1 | Rejected — "QR Starr never" list; generic |
| C3 | Spotlight marquee | Spotlights sweep; the name lights up | CSS conic gradients | S | Low | 3 | 3 | 4 | 2 | Rejected here — reads as nightlife; kept as a seed for a future Nightlife collection |

### Elegant

| # | Direction | Concept & interaction | Tech · Arsenal | Cx | Mobile risk | E | O | M | F | Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| E1 | **Shutters** | Graphite panels hold the world closed; a slit of light; they part; rule, words, frame drawn | GSAP (expo curves), drawn frame | M | Low | 4 | 4 | 5 | 5 | **Selected** — restraint with a real moment |
| E2 | Aperture (CSS) | The card opens from its centre line | CSS clip-path | S | Low | 4 | 3 | 5 | 5 | Superseded by E1 (same idea, plus light) |
| E3 | Living stone light | A slow caustic light moves over stone | Paper Shaders (WebGL2) | M | Medium (GPU, battery) | 4 | 4 | 3 | 2 | Deferred — breaks "nothing loops" unless one-shot; immersive tier |

### Minimal

| # | Direction | Concept & interaction | Tech · Arsenal | Cx | Mobile risk | E | O | M | F | Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 | **Equilibrium** | One point lands; words appear one by one, centred; the layout travels to its balance (FLIP) | GSAP SplitText + FLIP | M | Low | 4 | 4 | 5 | 5 | **Selected** — precision as emotion |
| M2 | Words resolve | Words rise from their baselines | CSS clip-path per word | S | Low | 3 | 3 | 5 | 5 | Runner-up; the light-tier fallback if GSAP is ever removed |
| M3 | Typewriter | Characters type out with a caret | CSS steps | S | Low | 2 | 1 | 5 | 1 | Rejected — cliché; a blinking caret loops |

**Selection principle:** strongest emotion within the motion language, not
the most technical. The three "L"/Rive/WebGL directions (R2, W3, E3, plus B2)
all belong to the **recipient reveal**, where one card has the whole screen,
there is no gallery gesture to fight, and an immersive-tier asset is worth
loading for the person who receives the gift.

## 3. What changed in this pass

**Architecture (no visual change):**
- `src/lib/templates/` — template schema (zod, strict, CSS-safe), approved
  vocabulary, six launch definitions (one file each), versioned catalogue,
  curated collection, generated rooms. `lib/themes/registry.ts` and
  `worlds.ts` became derived views; `ThemeKey` is an open id.
- Worlds, seals, scenes and arrival grammar are keyed by **composition**,
  not template id — a new template reusing a composition needs no component
  or CSS change. `theme-picker.css` no longer names any template.
- Rooms are generated from template tokens into one server-rendered
  `<style>`; dark-room chrome keys on `data-room="dark"`.
- Picker order and preloads come from the catalogue (`getCollection`,
  `restAssets`).
- `npm run verify:templates` — 101 invariant checks (schema, versions, KA/EN
  copy, assets, compositions, contrast, custom-spec boundary, DB rows).

**Interaction:** tapping the chosen world (phone gallery, desktop stage)
plays its signature again in full. Seals still never replay, so stray taps
stay quiet. E2E-tested.

**Fixes:**
- Caption contrast on light rooms: `--ink-3` measured 3.36:1 on Wedding's
  sage, 4.05:1 on Birthday, 4.37:1 on Minimal → `#625952` on light rooms,
  now ≥ 4.55:1 everywhere (caught by the new contrast check).
- Desktop: the action bar's fade (flat `--paper`) painted a box over
  textured rooms (visible on Celebration); hidden at ≥ 1024 px where the
  bar never covers content.

## 4. QA

| Check | Result |
|---|---|
| Screen #1, 5 widths × KA/EN, reduced motion, vs pre-pass build | **Pixel-identical** (10/10) |
| Screen #2 at rest, all six worlds, vs pre-pass build | Identical except caption ink on light rooms (intended); Celebration and Elegant identical (proves generated rooms = hand-written CSS); Romantic varies run-to-run only by footage frame |
| Horizontal overflow, 320–1440 × KA/EN × six worlds | 0 px everywhere |
| Signatures play and come to rest (390, KA) | All six |
| Replay (390 KA phone, 1440 EN desktop) | Plays from start, ends at rest, choice unchanged |

### Performance (production; KA; phone 390×844 @3×, 4× CPU, 1.6 Mbps / 150 ms; cold cache; median of 5)

| World (direct load) | LCP | CLS | Transferred | LCP element |
|---|---|---|---|---|
| Minimal | 1032 ms | 0.0001 | 664 KB | card text |
| Wedding | 1032 ms | 0.0007 | 757 KB | card |
| Romantic | 1428 ms | 0.0001 | 698 KB | `romantic-leaves-rest.webp` (scene still) |
| Celebration | 1484 ms | 0 | 755 KB | `celebration-sky-rest.webp` (scene still) |

Route JS `/g/[token]`: 37.1 → 39.3 kB (+2.2 kB: catalogue metadata,
vocabulary, room generator; zod schema verified **not** in the client
bundle). GSAP stays in five async chunks (~36 KB gz), absent from the
route's initial manifest.

Compared with the WOW pass on the same profile (Minimal 1032 / Wedding 1072 /
Romantic 1040 ms, 614 KB): Minimal and Wedding are unchanged. **Romantic's
LCP rose ~390 ms and transfer ~50 KB** in the immersive pass that preceded
this one: the footage rest stills became the LCP element, and idle GSAP
prefetch lands inside the measurement window. Both are still well within
"good" (< 2.5 s). Options if pilot devices show it: give the rest still
`fetchpriority` above the fonts, or let the linen ground (not the still) be
the largest paint.

## 5. Known risks / future work

See `docs/design/THEME-ENGINE.md` §9. (Since resolved: Preview and the
recipient reveal now render the chosen world with its finale —
`../recipient-reveal-worlds/`.)

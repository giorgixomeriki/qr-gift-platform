# QR Starr — motion language

How things move in QR Starr, so every screen moves like the same product.
Established in the Screen #2 WOW pass (2026-10-04); reference implementation:
`src/components/themes/theme-world.css` (signatures, easings) and
`src/components/greeting/theme-picker.css` / `theme-picker.tsx` (switching,
gallery, selectors). Research and rejected alternatives:
`theme-wow-research.md`.

## Principles

1. **Material, not effects.** Motion shows what a thing is made of — light on
   linen, vellum lifted off cotton, cut paper landing, a card opening. If a
   motion would look the same on any website, it does not belong here.
2. **One signature per world.** Each theme world has exactly one memorable
   moment. Supporting motion exists only to serve it.
3. **Beginning, moment, stillness.** Every sequence ends at rest. Nothing
   loops, idles, breathes or floats. The finished state *is* the design —
   if the motion were removed the screen must still be beautiful.
4. **Motion is the interface answering.** It follows an intent (a tap, a
   swipe, arriving on a screen), never plays on its own, never blocks input.
5. **Restraint scales with importance.** Minimal moves least; Birthday is
   the fastest; Wedding and Romantic are the slowest. No world competes with
   the interface around it.

## Choreography

| Phase | Duration | What happens |
|---|---|---|
| Exit | 0–180 ms | Phones: the previous world recedes with the swipe (scroll-driven). Desktop: the old world stays put beneath the new one — never fades to an empty frame |
| Transition | 150–520 ms | Phones: the gallery scrolls/snaps; size and light track the finger. Desktop: the new sheet is laid on top (rises 2.5%, 0.985 → 1, opaque by 40%) |
| Signature | 300–1500 ms | The world's one moment (table below) |
| Settle | 150–400 ms | Springs come to rest; everything is still |

### States

| Situation | Behaviour |
|---|---|
| Arriving on the screen from the previous step | Chosen world plays its **full** signature |
| Direct load / refresh of the step | World shown **at rest** (its first paint is the page's LCP — never hide it behind an entrance) |
| Choosing a world for the first time | **Full** signature |
| Choosing a world already seen | **Short** signature (same choreography at 0.6× — `data-motion="short"`, `--p`) |
| Choices < 700 ms apart (rapid switching) | **Short**; each new choice remounts the world, cancelling the previous cleanly |
| Choosing the current world again (its seal / list row) | Nothing replays |
| Tapping the chosen world itself (phone gallery, desktop stage) | **Full** signature again — the preview is there to be watched |
| Reduced motion | Opacity-only 240 ms fade of the finished world; no movement anywhere |

## Signatures (Screen #2)

| World | Signature | Full length | Easing |
|---|---|---|---|
| Romantic | *Light finds the letter* — dusk lifts, window light travels in and rests, the engraving appears where it lands, the card is set down | ~1.8 s | settle spring; slow ease-out for the light |
| Wedding | *The vellum is drawn off* — misty under a full vellum sheet; held beat; sheet drawn up and away, lifting; letterpress comes up crisp | ~1.5 s | ease-in-out (a hand drawing a sheet) |
| Birthday | *Cut paper snaps in* — each piece on its own path, landing with a small overshoot | ~0.5 s to settle | snap spring |
| Celebration | *Ignition* — focal Starr ignites, rays draw out in one sweep, card arrives, sparks complete it | ~1.2 s | ease-out; paper spring for the card |
| Elegant | *Aperture* — rule drawn, card opens from its centre line, frame settles, words inked | ~1.4 s | aperture curve (0.76, 0, 0.24, 1) |
| Minimal | *The words resolve* — point lands, words rise from their baselines, hairline drawn | ~1.2 s | ease-out; snap spring for the point |

## Easing

Springs are physics, precomputed: damped springs (mass 1) sampled into CSS
`linear()` curves — the same model as Motion/Framer springs, with zero
runtime. Use the tokens; do not invent per-component curves.

| Token | Feel | Use |
|---|---|---|
| `--qs-ease-settle` (k120 c22) | Lands without overshoot | Paper set down, cards settling |
| `--qs-ease-paper` (k260 c22, 5% overshoot) | A sheet with a little give | Cards arriving, arcs |
| `--qs-ease-snap` (k420 c24, 10% overshoot) | Crisp, joyful | Small pieces landing, press release, points, sparks |
| `--qs-ease-out` (0.16, 1, 0.3, 1) | Decelerating reveal | Light, ink, words, rays |
| `--qs-ease-inout` (0.65, 0, 0.35, 1) | Deliberate hand movement | Drawing a sheet, drawing a rule |
| `--qs-ease-aperture` (0.76, 0, 0.24, 1) | Editorial opening | Masks/apertures |
| `--cx-ease`, `--cx-ease-soft` | App chrome | UI transitions outside the worlds |

## Durations

- Press feedback: 90 ms in, spring out (~500 ms).
- Selector response: ~600 ms, once.
- Sheet change (desktop): 520 ms.
- Signatures: 0.5–1.8 s full; ×0.6 short.
- Nothing in the interface chrome over 400 ms.

## Press feedback

Things you touch give under the finger: `scale: 0.88` in 90 ms, released on
the snap spring. Chosen selectors answer once in their world's gesture
(light, sheen, paper, rays, aperture, point). Never on page load.

## Material movement

- Light travels; it does not pulse.
- Paper is set down, tossed, drawn off — it has weight and lands once.
- Rules are drawn, frames settle, ink is applied.
- Parallax is tiny (≤ 6% of a world's width) and only tracks the finger.

## Performance rules

- Animate `transform`, `translate`, `scale`, `rotate`, `opacity`; `clip-path`
  and `stroke-dashoffset` on small elements only.
- No looping or idle animation; no animated `box-shadow`, `filter` or blur.
  (A blurred element may *move*; its blur never animates.)
- No JS on scroll: use scroll-driven animations (`animation-timeline`) with
  `@supports`, gated by `prefers-reduced-motion: no-preference`.
- No animation runtime dependency without a measured reason (see the engine
  comparison in `theme-wow-research.md`). The immersive pass (2026-10-04)
  measured one: theme scenes are GSAP timelines (SplitText, Physics2D,
  CustomEase) in `components/themes/scenes/`, loaded as async chunks only
  when a scene plays and prefetched on idle — never in the first paint. CSS
  remains the engine for everything else. Tool responsibilities:
  `QR-STARR-DESIGN-ARSENAL.md` §1.5.
- Never animate the first paint of a directly-loaded screen's LCP element.

## Reduced motion

Designed, not collapsed: the global rule shortens everything to 1 ms; worlds
override it with a 240 ms opacity-only fade of the finished state, so a
choice still *feels* answered. The gallery keeps its plain selection state
(no scroll-driven depth); press scaling is instant.

## QR Starr never

- Loops, idles, floats, breathes or pulses anything.
- Confetti cannons, fireworks, particles, floating hearts or petals, glitter.
- Glow, neon, glassmorphism, blobs, gradient sweeps for their own sake.
- Bounces more than once; overshoots more than ~10%.
- 3D card flips, tilts beyond a few degrees, gaming-style transitions.
- Plays sound automatically, or relies on haptics.
- Animates something the user did not just ask for.
- Hides content the user needs behind an animation, or blocks input while
  one plays.

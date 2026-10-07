# Recipient reveal in the worlds

The recipient (and the sender's Preview, the same renderer) now meets the
greeting inside the world chosen on Screen #2 — what is picked is what is
received. Architecture: `docs/design/THEME-ENGINE.md` §3.1.

## Finales — each world closes its own way (final pass, 2026-10-06)

The ending beat brings the world back — the sender's words still on its
card — and closes it with its own gesture; the template's closing line takes
the world's headline. Architecture: `docs/design/THEME-ENGINE.md` §3.2.

| World | Finale | Gesture | Reduced motion |
|---|---|---|---|
| Romantic | `evening-falls` | Dusk returns, the window light withdraws, the card keeps the last light while "With love" is inked | Dusk and withdrawn light, at once |
| Birthday | `paper-encore` | Closing words drop in, the cut paper hops once, a cut-paper rosette snaps onto the card | The rosette on the card |
| Wedding | `vellum-close` | The closing line is printed, the vellum is drawn back over the card, the seal is pressed | The card under vellum, sealed |
| Celebration | `afterglow` | Three small Starrs ignite in turn, then the Starr; rays redraw; words come through the light | A warm glow remains |
| Elegant | `gallery-doors` | Graphite doors glide in and stop at the card's edges | The card framed by the doors |
| Minimal | `full-stop` | Label and rule withdraw; the point travels to the end of the message as its full stop (beneath a clamped letter) | Label and rule gone |

| Sheet | What it shows |
|---|---|
| `_finales-through-time-390-en.webp` | **Start here.** Each world: message at rest, then its finale at 250 / 1300 / 2600 / 6000 ms |
| `_finales-320-ka-long.webp` | 320 px, Georgian, 400-character letters; Celebration EN after photo + video + voice |
| `_finales-768-1024-1440.webp` | All six at 1440 EN; Romantic 768 (after a photo), Elegant 1024 KA (after a video), Minimal 1440 KA (long) |
| `_finales-reduced-motion.webp` | Every finale's ending under `prefers-reduced-motion` (captured 250 ms in) |
| `_finales-after-photo-video-voice.webp` | Photo → video → voice → finale (Romantic KA 390, Celebration EN 320) |

Defects found and fixed in this pass: Elegant's doors crossed the card
mid-glide (GSAP folds CSS `translate` into its transform — positions now
explicit); Celebration's "Congratulations!" broke mid-word (closing lines are
fitted after the world's face has loaded; words never break) and touched the
spark at 1440 (its slot is kept clear); Minimal's point landed on the wrong
line (lines picked by midpoint) and on faded text for clamped letters (it now
closes the card beneath them).

## Sheets (reveal pass)

| Sheet | What it shows |
|---|---|
| `_six-worlds-short-en-390.webp` | **Start here.** Each world, short EN message + a photo: sealed → scene (1.4 s) → message at rest → photo in the world's frame → ending |
| `_long-message-letters-ka-390.webp` | A 400-character Georgian message in each world: its beginning on the card, then the whole letter in the world's paper and type |
| `_recipient-page-phones.webp` | The real recipient page (activated via the TEST provider, opened without the sender's cookie) at 320 and 390, KA and EN; the checkout thumbnail |
| `_recipient-page-tablet-desktop.webp` | 768, 1024, 1440 |
| `_writing-on-the-world-ka.webp` | The message step: written on each world's card stock, in its type and room |

Captures: Preview sheets from a production build; recipient-page sheets
from `next dev` with the TEST payment provider (as `e2e/greeting-flow`
does) — the Next dev indicator ("N") is visible there only.

## Design

| Beat | Before (v1) | Now |
|---|---|---|
| Opening | Generic envelope on a theme gradient; same object for every theme | The world sealed: its ground, the template's opening line, a seal in the world's accent |
| Opening → message | Envelope flap / balloons / fade; particles drifting behind | The world's own signature scene (light, vellum, cut paper, ignition, shutters, equilibrium) with the sender's words on its card |
| Message | One shared paper card | On the world's card if it fits its designed capacity; otherwise the beginning under a fade and then the full letter in the world's materials, with one trait of its world (ruled frame, cut-paper shadow, tilt, the point) |
| Photo / video | One polaroid style for every theme | The composition's media frame: vellum mount, cut-paper slip with tab, deckle mount with ruled frame, full bleed, inset hairline, plain |
| Voice | Player on the theme gradient | Player on the world's card stock |
| Ending | Closing line in the app serif, Starr in theme accent, particles | Closing line in the world's display type, the Starr in its accent, still |

No particles anywhere (the motion language's "QR Starr never" list). The
message step, desktop live preview and checkout thumbnail use the same world.

## Fixes found in QA

- Fit measured against the card box failed for compositions whose card grows
  with its content (Birthday, Celebration): a short Birthday message became a
  letter, a 400-character Celebration message overflowed the world. Fit is now
  measured against each composition's designed capacity (`messageLines`).
- Full-screen page: with only `min-h-dvh` on the root, the stage's container
  units resolved to 0 and the world was invisible (Preview, with a definite
  height, was fine). The renderer is now `h-dvh`.
- Long letters on short phones had no sign of more text: a CSS-only scroll
  cue (shade at the foot, covered once the end is reached).

## Results

| Check | Result |
|---|---|
| Six worlds × short EN (+photo) × long KA, 390 | Short messages stay on the card (6/6), long become letters (6/6) |
| Recipient page 320 / 390 / 768 / 1024 / 1440, KA + EN | World, letter, ending render; 0 px horizontal overflow |
| Route JS `/g/[token]` | 39.3 → 37.5 kB (envelope and particles removed) |
| E2E | see `e2e/recipient-reveal.spec.ts` (sealed → scene → message; long → letter; reduced motion) |

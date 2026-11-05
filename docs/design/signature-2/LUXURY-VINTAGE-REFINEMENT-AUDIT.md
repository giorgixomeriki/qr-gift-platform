# Luxury Vintage: visual and motion refinement audit (Phase 1, awaiting approval)

Branch `design/signature-experience-2` @ `9270203`, clean tree. Nothing below is implemented. Evidence: full recordings of the current experience (390 × 844 and 1440 × 900) and frame strips, in `/Users/Shared/qr-gift-platform-signature-2-review/luxury-vintage/recordings-before/` and on the review page.

## 1. Findings

Severity: **H** breaks the illusion of a crafted keepsake · **M** generic or mechanical · **L** polish.

| # | Stage | What's wrong (observed) | Sev |
|---|---|---|---|
| 1 | Opening → letter | After the sheet rises, everything vanishes and **an empty dark rectangle** shows for ~0.9 s before the letter fades in. The hand-off from envelope to letter isn't continuous. | H |
| 2 | Letter scene | The world is drawn as **a framed box on the desk** (its own walnut ground, rounded corners and drop shadow inside the walnut room): box-in-box, the most "generic card" moment. It's worst on desktop, where the letter is small in a large empty room. | H |
| 3 | Letter scene | The parchment **fades in through a muddy grey** (opacity over the dark ground) rather than being laid down. | M |
| 4 | Letter scene | The gold vine frame **wipes on edge by edge** (clip-path) and the Redouté rose **wipes up from the bottom**. Both read as mechanical masks, not gilding or printing. | M |
| 5 | Letter scene | The wax seal arrives **pink and translucent, then springs** (`back.out`). Real wax doesn't fade or bounce. | M |
| 6 | Letter scene | The words rise line by line from masks, **the same reveal the other worlds use**; it doesn't read as ink or a hand. | M |
| 7 | Long letter | The full letter appears as the shared **semi-transparent overlay** over the dimmed card (a double image); it isn't parchment. | M |
| 8 | Finale | The seal **disappears and is pressed again** (it was already on the letter). It reads as a glitch, and it duplicates the closing's own seal. | M |
| 9 | Envelope | The flap folds by a **2D squash** (scaleY), and the seal simply fades. The envelope is a flat cream gradient: no fibre, deckle or postal detail. | M |
| 10 | Opening | The large white **"Open" pill and "Tap to open"** are the shared modern controls, out of place on a candlelit desk. The same applies to "Continue", "Watch again" and the "Made with" chip in this world. | M |
| 11 | Photos | Prints use the **shared cream mat** (Wedding's deckle mount). They're repetitive across beats and enter with the same fade. Between photos a **grey skeleton square** flashes on the dark desk. | M |
| 12 | Video | **Browser-native white controls** over a cream mat: the most modern-looking element in the world. | M |
| 13 | Closing seal | The postmark ring **spins linearly** (a postmark is stamped, not spun), and its **lower half reads upside down** («VINTAGE» inverted). | M |
| 14 | Closing seal | A soft **radial halo** around the seal is the "artificial glow" the brief rules out. | L |
| 15 | Petals | canvas-confetti petals are **tiny uniform specks** with confetti physics; they read as dust, not rose petals. | M |
| 16 | Closing type | "This letter is yours to keep." is the shared Newsreader italic. The world's own hand (Pinyon) and type (IM Fell) aren't used there, nor in the "Keepsakes" kicker or captions ("01 · 02 Photo"). | L |
| 17 | Picker | The seventh tile's swatch shows **bare parchment stripes**: no rose and no vine, so the world isn't recognisable at a glance. | M |
| 18 | Writing | The letter field has grey sans rules, a sans counter and helper, and a faint rose. It reads as a form placed on parchment. | L |
| 19 | Pace | Tap → readable letter takes **≈ 4.5 s** (envelope 0.95 s + blank 0.9 s + scene inking from 2.3 s). It's elegant, but slower than it needs to be. | M |

What already works and should be kept: the materials (parchment fibre, gold vine, Redouté rose, lace, wax), the Pinyon opening line, the IM Fell letter, the print stack's tactile drag and keyboard support, the lace-edged closing letter, and the picker layout of seven.

## 2. Proposed refinements (all Luxury Vintage-only)

Method key: **CSS** = transitions/keyframes on existing elements; **GSAP** = the world's existing scene runtime (already loaded for every world's scene, so no new cost); **lib** = an existing third-party component.

| # | Refinement | Fixes | Method | Shared cost |
|---|---|---|---|---|
| A | **One continuous gesture from envelope to letter:** the sheet that rises out of the envelope *becomes* the letter. It glides and settles into the letter's place on the desk (FLIP between the two rects), so there's no blank frame and no fade-through-grey. Tap → readable ≤ 2.4 s. | 1, 3, 19 | GSAP (existing) + CSS | 0 |
| B | **The letter lies on the desk, frameless:** for this world the world's ground is transparent and borderless (no box, no rounded edge, no box shadow); a candlelit falloff on the room carries the light. Larger letter on desktop. | 2 | CSS | ~0.2 KB |
| C | **Laid down, not faded:** the parchment arrives opaque with a short slide and rotation, and its shadow tightens as it touches the desk (paper settling, no overshoot). | 3 | GSAP | 0 |
| D | **Gilding and printing:** the vine frame is present from the start and **catches the candle once** (a foil sheen travelling along the gold, CSS keyframes on the existing mask). The rose **develops like a fresh print** (ink density from pale to full, a hint of blur clearing), not a wipe. | 4 | CSS | ~0.3 KB |
| E | **Ink, not masks:** each line is revealed left to right behind a soft-edged ink front (GSAP SplitText, already in the runtime), with the ink settling a shade darker. The sign-off is written in the script hand last. | 6 | GSAP | 0 |
| F | **Real wax:** the seal is pressed opaque. It has a slight squash on contact and its edge spreading (scale on one axis), with no bounce or transparency. The finale **keeps** the seal (no re-press) and closes with the script line inked and the candle dipping once. | 5, 8 | GSAP | 0 |
| G | **The envelope as an object:** parchment fibre on the paper. The flap **hinges in 3D** (`rotateX` with perspective and a back face) instead of squashing, and the seal **cracks in two** along a jagged line (two clip-path halves of the existing seal) as the flap lifts. | 9 | CSS | ~0.5 KB |
| H | **Long letter on parchment:** in this world the full-letter view is the same parchment sheet (fibre, vine head, IM Fell), not the translucent overlay. | 7 | CSS | ~0.2 KB |
| I | **Stationery controls:** in this world, "Open", "Continue", "Watch again" and "Made with" become ink-on-parchment controls (deckled pill, sepia ink, thin gold rule). Same buttons, labels, sizes and test ids; ≥ 44 px targets kept. | 10 | CSS | ~0.3 KB |
| J | **Mounted prints:** photos mounted on parchment with a fine gold rule cut from a *different* border in the same public-domain 1922 Linotype book ("Bodoni dashes"), so the frame isn't repeated. Each print is set down at its own small angle. The skeleton becomes a parchment-toned placeholder. | 11 | CSS + PD asset (≈ 6 KB, vintage-only) | 0 shared |
| K | **The film as a keepsake:** the video sits in the same mount with a warm poster frame and a round sealing-wax play label. Native controls appear once it plays (so they're still the accessible ones). There's no autoplay; keyboard and screen-reader use is unchanged. | 12 | CSS + small markup branch | ~0.2 KB |
| L | **A stamped postmark:** two concentric rules and the text on the **upper arc only** (nothing upside down), stamped once (press, ink at full strength, a fraction of a degree of skew) instead of spinning. It uses Motion Primitives SpinningText as a static circular layout with a 0.6 s settle, or plain CSS if you prefer to drop the component. | 13 | lib (existing) / CSS | 0 shared (lazy) |
| M | **Candlelight, no halo:** remove the seal halo; let the room's existing candle falloff light the closing. | 14 | CSS | −0.1 KB |
| N | **Real petals:** 6–8 petals **cut from the CC0 Redouté plate itself**, falling slowly with a gentle sway (CSS keyframes, each with its own path and duration), once, when the seal comes into view; never under reduced motion. This replaces canvas-confetti and Magic UI Confetti. | 15 | CSS + CC0 asset (≈ 10 KB, lazy) | 0 shared; the vintage chunk gets ~7 KB lighter |
| O | **The world's own hand in the closing:** the closing line in Pinyon Script (IM Fell for Georgian, falling back to Noto Serif Georgian); the kicker and captions in IM Fell small caps; captions "Photograph · I", "Photograph · II", "Film". | 16 | CSS + 3 copy keys (EN/KA) | ~0.1 KB |
| P | **A recognisable tile:** the seventh tile's swatch shows the letter's corner with the rose and a sliver of gold vine (the existing 3 KB rose crop plus the vine mask). | 17 | CSS | ~0.1 KB |
| Q | **Writing on the letter:** sepia ledger rules, IM Fell placeholder and counter, a sepia caret, and the rose a little more present (away from the counter). No typing effects. | 18 | CSS | ~0.1 KB |

**Shared download:** to keep the six worlds' cost from rising, the closing-only vintage CSS (lace, prints, seal, petals) moves into the lazy vintage chunk. That roughly offsets the additions above, so the target is shared CSS at or below today's 162.7 KB (uncompressed).

## 3. Components and patterns considered

| Source | Candidate | Verdict |
|---|---|---|
| Motion Primitives (MIT) | SpinningText (in use) | **Keep, re-cast** as a static stamped ring (L) |
| Motion Primitives | Text Effect, In View, Morphing Dialog | Not needed. E and C use the world's own GSAP runtime at no extra cost; Morphing Dialog competes with the stack's tap |
| React Bits (MIT + Commons Clause) | Stack (in use) | **Keep.** Tune it to a quieter spring (less travel, no wobble) so it doesn't add a third spring feel |
| React Bits | FoldText, SplitText (GSAP) | FoldText reads as a gimmick on a letter. SplitText needs `@gsap/react` (not approved); GSAP's own SplitText already does E |
| React Bits | StickerPeel (React + CSS) | Considered for "peel the seal". Rejected: a peel suggests a sticker, not wax |
| Magic UI (MIT) | Confetti (in use) | **Replace** with N (real petals); the same Confetti stays if you prefer to keep it |
| Aceternity UI | (proprietary licence) | Still excluded by licence and project rule; nothing here needs it |
| Platform | CSS 3D transforms, keyframes, masks; GSAP (installed) | **Primary tools.** Lightweight, no new dependencies |

## 4. Safeguards for Phase 2

- Scope: only `keepsake` rules and branches; the six worlds' code paths, CSS and timings are untouched.
- Re-verify after implementation:
  - the 36-frame pixel regression (it must stay at 0 px);
  - the shared download measured file by file;
  - `luxury-vintage.spec.ts`, plus new checks for the continuous opening, the stamped postmark and the reduced-motion paths;
  - keyboard and screen-reader paths, and the 320–1440 responsive checks;
  - real-touch behaviour (Playwright touch emulation; physical devices remain your check).
- Deliverables: before/after screenshots and before/after recordings at 390 and 1440.
- No push, merge or deploy; migration 0021 stays local.

## 5. Decisions needed

1. Approve refinements **A–Q** (or name the ones to drop).
2. **Petals (N):** replace Magic UI Confetti and `canvas-confetti` with real Redouté petals in CSS (recommended), or keep them, tuned.
3. **Postmark (L):** keep Motion Primitives SpinningText as a static stamped ring (recommended), or plain CSS.
4. **Controls (I):** restyle the shared buttons only in this world (recommended), or leave them as they are.

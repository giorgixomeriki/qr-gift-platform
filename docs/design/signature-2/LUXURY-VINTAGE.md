# Luxury Vintage: the seventh world

Status: implemented on `design/signature-experience-2` (local only; not pushed, merged or deployed). The owner directed (2026-10-22) that Luxury Vintage is **an additional world, not a redesign**: the six launch worlds are unchanged, which is verified pixel for pixel (see Verification).

## 1. Audit: what a seventh world needed

| Layer | Change needed? | What was done |
|---|---|---|
| Database schema | No | `themes.key` is text; greetings reference `themes.id` |
| Database data | **Yes**: `updateGreetingTheme` resolves a world by `themes.key` and throws "Theme not found" without a row | Owner-approved migration `0021_luxury_vintage_theme.sql` (one idempotent `INSERT … ON CONFLICT DO NOTHING`) + the same row in `src/db/seed.ts`. Applied only to the local throwaway DB `qr_signature2` |
| API routes, server actions, validation | No | `isThemeKey` is catalogue-driven; `updateThemeAction` unchanged |
| Payments, pricing, auth, RLS, storage | No | `pricing: "included"`; nothing under `src/lib` (except the earlier client helpers), `src/app/api`, `supabase`, middleware or config touched |
| Existing greetings | No | Their template id/version is frozen in `greetings.theme_version`; their compositions, CSS, scenes and finales are untouched (only new, separately named rules were added) |

## 2. The world

Template `luxury-vintage` (`src/lib/templates/definitions/luxury-vintage.ts`), composition **`keepsake`** ("The keepsake letter"), finale **`keepsake-seal`**, type pair **`fell-and-script`**.

- **The world:** a parchment letter on a walnut desk in candlelight, framed in a gold vine border from Linotype's 1922 border proofs. A Redouté rose is printed into the page, the letter is set in IM Fell English, the opening is written in Pinyon Script, and it's sealed with QR Starr's wax seal.
- **The scene** (GSAP, the existing scene runtime): candlelight, then the parchment is laid down, the frame is printed edge by edge, the rose grows, the opening is written, the words are inked, and the seal is pressed.
- **The finale:** the closing words in script, the rose back in bloom, the candle lower, and the seal pressed again.
- **The sender:**
  - the picker's seventh, full-width tile (all seven worlds and the action fit one screen at 320, 360 and 390 px);
  - a parchment letter field with the gold vine and the rose;
  - the rose pressed onto the preview envelope;
  - the world in the checkout thumbnail and the desktop studio.
- **The recipient:**
  - the envelope carries the rose, and the sheet that rises out is parchment under the vine, addressed in script;
  - the closing has the parchment letter with an antique lace edge, the photos as a stack of prints, and the wax seal inside a turning postmark ring, with rose petals falling once.
- **Localization:** EN "Luxury Vintage", KA «ლუქს ვინტაჟი»; opening, sign-off, sample, postmark and the print stack's accessible name in both languages. Georgian is set in Noto Serif Georgian, as approved.

## 3. Asset and component register

| World / screen | Component or asset | Source URL | Licence | Integration method |
|---|---|---|---|---|
| World card, tile seal, letter field, envelopes | Redouté, *Les Roses: Rosa Damascena, subalba* (1817–24) | https://clevelandart.org/art/1965.291 | CC0 (museum API) | **Adapted asset**: cropped, paper cleaned, AVIF/WebP; printed with `mix-blend-mode: multiply` |
| World frame, letter field, envelope sheet | Linotype "Benedictine" border 721, 1922 border proofs | https://archive.org/details/linotypetypograp00merg | Public domain | **Adapted asset**: one row extracted, inverted to an alpha mask, seamless tile; gold via CSS mask |
| Closing letter | *Lace Towel End* (1700s–1800s) | https://clevelandart.org/art/1931.107 | CC0 (museum API) | **Adapted asset**: scalloped edge as an alpha mask |
| Parchment everywhere in this world | ambientCG Paper 006 | https://ambientcg.com/a/Paper006 | CC0 | **Adapted asset**: fibre relief tile, soft-light over parchment colour |
| World type | IM Fell English (Igino Marini) | https://github.com/google/fonts/tree/main/ofl/imfellenglish | SIL OFL 1.1 | **As-is font**, Latin subset woff2 (61 KB), self-hosted |
| World script | Pinyon Script | https://github.com/google/fonts/tree/main/ofl/pinyonscript | SIL OFL 1.1 | **As-is font**, Latin subset woff2 (26 KB), self-hosted |
| Closing photos | React Bits **Stack** | https://github.com/DavidHDev/react-bits (`08a0115`) | MIT + Commons Clause | **Integrated, lightly adapted**: localized `ariaLabel`, strict-TS fixes (`src/components/vendor/react-bits/`) |
| Closing seal | Motion Primitives **SpinningText** | https://github.com/ibelick/motion-primitives (`e3c7b99`) | MIT | **Integrated, lightly adapted**: no `cn`, reduced-motion rest (`src/components/vendor/motion-primitives/`) |
| Closing petals | Magic UI **Confetti** (+ `canvas-confetti`) | https://github.com/magicuidesign/magicui (`8f0ff43`) | MIT (+ ISC) | **Integrated, lightly adapted**: component only, worker off (no CSP change); petal shape via canvas-confetti's `shapeFromPath` |
| Motion runtime | `motion` 12, `canvas-confetti` 1.9 | npm | MIT, ISC | **Installed packages**, loaded only with the vintage closing chunk |
| Wax seal, envelope | QR Starr's existing seal and envelope | n/a (in-house, approved earlier) | n/a | **Reused**, dressed with the licensed assets above (owner decision) |
| Icons | Phosphor (installed) | https://phosphoricons.com | MIT | No new icons were needed |

Not integrated: React Bits SplitText (needs `@gsap/react`, which wasn't approved) and Motion Primitives Morphing Dialog (it would compete with the stack's tap).

## 4. Loading

- The world's CSS rules match only `.tw--keepsake` and `[data-composition="keepsake"]`. Its images and fonts are requested only when an element of this world renders. Elsewhere that's only its picker tile, which costs the 3 KB rose crop: tiles render worlds without their typefaces (no `data-near`), so the fonts load only once Luxury Vintage is chosen.
- `vintage-keepsake.tsx` (Stack, SpinningText, Confetti, `motion`, `canvas-confetti`) is a `React.lazy` chunk requested only by a Luxury Vintage closing. An e2e test asserts that a Romantic recipient downloads none of it.

## 5. Verification (local, throwaway DB `qr_signature2`, TEST payments, no real money)

| Check | Result |
|---|---|
| `tsc --noEmit` · `eslint` · `next build` | clean · clean (0 warnings) · builds (`/g/[token]` first load 121 kB, unchanged) |
| `verify:templates` | all pass, including the new world's definition, copy (EN/KA), assets, scene, CSS, seal, arrival, finale, chrome contrast (7.62:1) and its `themes` row |
| `verify:site-content` · `verify:low-cost-hosting` · `verify:env-guards` | 51 · 55 · 36 pass |
| e2e (post-scan suites + `signature-experience` + `luxury-vintage`; Chromium desktop + Pixel 7) | final run on the final code **80 passed, 12 failed, 14 skipped**. That run took 1.6 h because the machine slept mid-run, and all 12 failures were visibility timeouts; **all 12 passed on an immediate rerun** (92 passed in total). The 14 skips are by design (single-project groups and desktop/WebKit-only tests). `luxury-vintage.spec.ts` also passed 5/5 twice on its own |
| Six launch worlds vs the pre-change baseline | **36 / 36 frames pixel-identical** (sealed, letter and ending × 6 worlds × KA/EN, reduced motion; two baseline runs differ by 0, so there is no noise) |
| Console / horizontal overflow | none at 320, 360, 390, 768, 1024 and 1440 px |

**Download cost** (production builds, recipient from load through the closing; uncompressed; files requested and sized once):

| | before (`e84987d`) | after |
|---|---|---|
| Each of the six worlds: scripts | 554.2 KB / 17 files | 560.4 KB / 17 files (+1.1%) |
| Each of the six worlds: styles | 151.1 KB / 4 files | 162.7 KB / 4 files (the added rules are ≈ 4 KB gzip) |
| Luxury Vintage: scripts | n/a | 719.2 KB / 19 files (+2 lazy chunks: `motion`, `canvas-confetti`, the three components) |

The six worlds request none of the vintage chunks (also asserted in e2e). Their small increase is the seventh world's definition, scene and CSS in the shared files, which keeps it ready at first paint.

Screenshots: `/Users/Shared/qr-gift-platform-signature-2-review/luxury-vintage/` (sender and reveal at 320/390/768/1024/1440, KA and EN; full flows with photos; `before-rest` / `after-rest-final` for the six worlds).

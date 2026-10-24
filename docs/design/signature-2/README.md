# Signature Experience 2.0: the post-scan journey

Branch `design/signature-experience-2` (worktree `/Users/Shared/qr-gift-platform-signature-2`). It's based on the production head `bfbbae8` (`feat/render-low-cost-hosting`, PR #13). It's local only: not pushed, merged or deployed.

This document covers what changed after a QR scan, why, and how it was checked. The public home page is a separate redesign (`design/public-site-redesign`) and isn't touched here.

## 1. The journey, as it actually exists

All post-scan screens live on one route, `src/app/g/[token]/page.tsx`. It dispatches on `resolveQrState(token)`.

| QR state | Who | Screen (before) | Screen (2.0) |
|---|---|---|---|
| `not_found` | anyone | generic icon status (app `not-found.tsx`) | Signature paper status: paper disc + serif headline |
| `blocked` | anyone | generic icon status | Signature paper status |
| `available` | first scanner | Screen #1 `SenderEntry` (photographed envelope, approved) | **unchanged**: Screen #1 is approved and frozen |
| `draft`, no edit cookie | someone else | hourglass icon status | the **sealed envelope** with "a greeting is on its way" |
| `draft`, with edit cookie | the sender | legacy wizard: theme → message → media → preview → checkout | Signature sender: Design → Words (+ memories) → Preview → "see it as the recipient" → Checkout order slip |
| `active` | the sender (cookie) | reveal + white system toast | reveal + paper note with the wax seal ("Activated") |
| `active` | recipient | world sealed as a flat card → beats → finale + replay | **envelope in the world's room** → beats → finale → **closing**: letter "for you", numbered keepsakes, the seal pressed again |
| error | anyone | generic status + black button | Signature status + wine action |

Steps that don't exist (not invented): there is no separate "claim" screen (starting the greeting claims the card) and no saved-greetings list. Nothing new was added on the product side.

## 2. Audit: before → after

| # | Finding (before) | Severity | 2.0 |
|---|---|---|---|
| 1 | Production still ran the legacy wizard. The approved Signature design existed only as a lab route and an unreviewed WIP snapshot (84b364c) on an old base | high | Ported onto the production head as commit `8eb6f2b` (homepage excluded). `SIGNATURE_UI=0` still restores the legacy wizard |
| 2 | Checkout used a generic black button and system notices. Its contents caption overflowed at 390 px ("…რომანტიკული" ran off the edge) | high | Order slip: ruled rows that wrap and never overflow, a torn foot, the wine action, a labelled test mode. Every checkout state has its own composition |
| 3 | The recipient's sealed state was a flat dark rectangle with a disc | high | A stationery envelope (pure CSS) in the world's own room, in candle light. The seal gives, the flap folds and an ivory sheet "For you" rises out before the world's scene takes over |
| 4 | The ending stopped at the finale with a lone Replay. The full letter and the media were no longer reachable together | high | A closing below the finale (in flow, never an overlay): the full letter with the world's sign-off, the photos as numbered prints, the film, the voice note, then the seal pressed again and one line on keeping it |
| 5 | **The voice waveform was fake**, a pseudo-random shape seeded from the duration (`voice-player.tsx`, `Wave` in the create list) | high (brief: "no fake waveforms") | `lib/client/waveform.ts` decodes the real audio (Web Audio) into RMS peaks, at idle time, cached per URL. Until it's known, or if decoding fails, a flat level line, never invented bars. Tested with a loud-then-quiet fixture |
| 6 | "See it as the recipient" was wrapped in white app bars, with a black Activate | medium | Full screen in the room. A floating "back" chip, and Activate in the room's own button style once the finale rests |
| 7 | Sender success was a white system toast with a green tick | medium | Paper note with the wax seal, a green "Activated" kicker and the same copy |
| 8 | Status screens were generic (grey disc, lucide icon) | medium | Signature paper. A draft someone else is writing shows the sealed envelope |
| 9 | Desktop sender screens were a 30 rem phone column on an empty page | medium | ≥ 1024 px: the picker puts the chosen room large on the left with the worlds and the action on the right. Create becomes a studio with the world live beside the letter, mounted only on wide screens |
| 10 | At 320 px Georgian world names («მინიმალისტური») overlapped the next tile | medium | ≤ 350 px: two worlds per row with a side swatch. Names never break inside a word |
| 11 | ka typo «გაააქტიურეთ» on checkout (lab audit #9) | low | Fixed in `ka.json` |
| 12 | Safari paints the lines a line-clamp hides (emoji fragments) in the checkout snippet | low | The legacy fix (headroom + clip band) is carried into the order slip. The WebKit e2e test points at it |

Existing strengths kept as they were: the six authored worlds, their scenes and finales, the beat model, the 450 ms beat guard, no autoplay, focus moving per beat, reduced-motion paths, the message backup in `localStorage`, the History-API steps and the signed-upload pipeline.

## 3. Creative direction and design system

One system, three materials. **Paper** (A: ivory cotton stock, tooth texture), **light** (B: the world's own room with a pool of candle light, which never pulses) and **labels** (C: kickers with a rule, zero-padded italic numerals, ruled rows). The approved Signature tokens are unchanged: `--sig-*` in `src/components/signature/signature.css`. The recipient side adds `--sx-*` in `src/components/greeting/reveal-signature.css`.

| Token | Value | Notes |
|---|---|---|
| paper / card | `#f6f0e6` / `#fbf7f0` | sender ground / objects |
| ink / ink-2 / ink-3 | `#2a201c` / `#5d4f47` / `#74655b` | 14.0 / 6.9 / 4.9 : 1 on paper |
| wine / wine-2 | `#5e1f33` / `#7a3244` | the only accent; CTA text 10.6:1 |
| candle | `#f2c99a` | light pool, kicker and numerals on dark rooms |
| letter / letter ink | `#f7eee2` / `#43232c` | 12.1:1 |
| light-room accent | `#5e1f33` | replaces candle on Birthday, Wedding and Minimal for contrast |
| success / danger / warning ink | `#1f5c40` / `#8f1d17` / `#6f4a0c` | 6.8–7.4:1 on their tints |

Type: Noto Serif Georgian / Newsreader for words, Google Sans for UI (all self-hosted). Georgian is never uppercased and never below 12 px. Inputs are ≥ 16 px. User text uses `overflow-wrap: anywhere`.

Motion: only transform and opacity move, and shadows are never animated. The envelope opens in 0.95 s: the seal presses (120 ms), the flap folds (360 ms), the sheet rises (600 ms) and the envelope hands over to the world (330 ms), overlapping. Opening is one deliberate gesture. After it, the beats keep their own 450 ms guard. Keepsakes are "set down" with CSS scroll-driven animation (`animation-timeline: view()`, which degrades to static). Reduced motion turns every keyframe into a ≤ 200 ms fade, the envelope opens in 180 ms, and nothing travels.

## 4. Components

New (2.0):

| File | Purpose |
|---|---|
| `greeting/reveal-envelope.tsx` | The sealed envelope and its opening (CSS paper; the seal is a pointer target, Open is the labelled control) |
| `greeting/reveal-closing.tsx` | Letter "for you", numbered keepsakes (photos, film, voice), closing seal and line |
| `greeting/reveal-signature.css` | Recipient tokens, envelope, closing, banner, ending layout, reduced motion |
| `greeting/signature-checkout.tsx` + `signature/checkout.css` | Order slip and every checkout state |
| `greeting/checkout-flow.ts` | Checkout state machine, **moved verbatim** out of `CheckoutStep` so the legacy and Signature screens share one behaviour |
| `greeting/studio-aside.tsx` | Desktop live world beside the letter |
| `flow/status-screen.tsx` + `signature/status.css` | Status screens in Signature paper |
| `lib/client/waveform.ts` | Real waveform peaks from the audio |
| `greeting/card-states.tsx` | Each `/g/[token]` state as its own client bundle (`React.lazy` + `Suspense`, server-rendered); the recipient never downloads the wizard |
| `lib/client/use-media-query.ts` | `useSyncExternalStore` media query (mounts the studio only on wide screens) |

Ported (approved design, from 84b364c): `signature/chrome.tsx`, `signature/signature.css`, `greeting/signature-{wizard,theme-picker,create-step,voice-capture}.tsx`, `greeting/use-media-uploads.ts` and `greeting/message-backup.ts`.

## 5. Component libraries: research and register

Licences were rechecked on 2026-10-21 (React Bits' LICENSE and Aceternity's licence page fetched today; the others confirmed by the site redesign on the same date).

| Source | Licence | Decision | Why |
|---|---|---|---|
| shadcn/ui | MIT | Pattern only | Native `<details>` (checkout testing options) and ARIA radio-group semantics (picker) cover the need without Radix |
| Radix Primitives | MIT | Not added | There's no dialog, menu or popover in this flow; arsenal rule: pick one primitive layer, adopt on first real need |
| Magic UI | MIT | Pattern only | "Blur fade / in view" → CSS scroll-driven `sx-set-down` on keepsakes |
| Motion Primitives | MIT | Pattern only | "In view" and "transition panel" ideas, done in CSS |
| Motion (Framer Motion) | MIT | Not added | Every motion here is a CSS keyframe or transition. Scenes already use GSAP (installed, "Standard No Charge" licence), so no second motion engine was added |
| React Bits | MIT + **Commons Clause** | Not used | Commercial use is allowed but redistribution of components is restricted. Nothing here needed it |
| Aceternity UI | Proprietary (no reselling as templates/themes) | **Not used** | Arsenal §1.4: never in theme compositions; its spotlight/3D idiom conflicts with the stationery identity |
| Embla Carousel | MIT | Not added | There's no carousel: keepsakes are a vertical album, and the picker is a fixed grid |
| Lenis | MIT | **Avoid** | Scroll hijacking hurts native mobile feel and accessibility |
| Web Audio API (platform) | n/a | Used | Real waveform peaks without wavesurfer.js (BSD-3, ~40 KB) |

**No new dependencies were installed and nothing was purchased.** `package.json` is unchanged.

## 6. Business and security rules (unchanged, verified by diff)

There are no changes under `src/lib/payments`, `src/lib/greetings`, `src/lib/qr`, `src/lib/security`, `src/db`, `supabase/`, `src/app/api`, `src/middleware.ts`, `render.yaml` or `next.config.ts`. The price shown is only ever the server's (`summary.grossAmountMinor` / `getDefaultProductPrice`). The checkout logic is the same code, moved into a hook, so return-polling, the "still confirming" hold (no second Pay), closed checkout, cancel/fail/retry and the TEST simulation are identical. The recipient still sees nothing before the authorized reveal: the opening beat renders no message at all (an e2e test asserts the words are absent from the page until Open).

## 7. Verification (local, throwaway DB `qr_signature2`, TEST payments, no real money)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | clean |
| `next build` | passes; `/g/[token]` first load **121 kB** (production baseline bfbbae8: 185 kB) |
| `verify:templates` · `verify:site-content` · `verify:low-cost-hosting` · `verify:env-guards` | pass (51 · 55 · 36 checks) |
| e2e post-scan suites (greeting-flow, recipient-reveal, theme-picker, mobile-experience, pilot-protections, locale) + new `signature-experience`, Chromium desktop + Pixel 7 | final run **83 passed, 2 failed, 9 skipped**. The 2 failures were load timeouts (a "session closed" protocol error and a 12 s wait while the machine's load average was ~15), and both passed on an immediate rerun. The 9 skips are by design: WebKit-only/desktop-only tests in the other project, and the Signature group runs once with explicit phone contexts. Earlier runs on the same code saw 1–7 similar load flakes, all passing on rerun |
| Legacy path (`SIGNATURE_UI=0`) against **production's original** greeting-flow + pilot-protections specs | 12 / 12 (the shared checkout hook drives the money path and QA-02/04/08) |
| Console | no errors or warnings on sender screens or on the reveal of any world (a `useId` hydration mismatch caused by `next/dynamic` was found and fixed by moving to `React.lazy` + `Suspense`) |
| Horizontal overflow | none at 320, 360, 390, 430, 768, 1024 or 1440 px on any captured screen |

New focused spec `e2e/signature-experience.spec.ts`:
- A real voice note uploaded to local Storage: the create row and the recipient's player draw **decoded** peaks (loud first second > quiet second, × 2).
- Order slip: the server amount, the real contents, a labelled test mode, simulated failure → retry → pay.
- The sealed envelope keeps the words out of the page until Open (phone context, tap).
- The closing has the full letter, a numbered keepsake and the closing line, and nothing autoplays. The cue scrolls to it, and Replay re-seals.
- Keyboard: Tab reaches Open (the seal isn't a tab stop), and Enter opens.
- Reduced motion: Open → message beat within 0.7 s.
- 320 px: no sideways scroll from sealed to closing.
- A draft someone else is writing shows the envelope status, never the wizard.

### Performance (production builds, 390 × 844, Chromium, recipient page)

| | baseline bfbbae8 | 2.0 |
|---|---|---|
| JS transferred (uncompressed) | 712 KB | **554 KB** (−22%: each card state is its own bundle now) |
| CSS (uncompressed) | 128 KB | 151 KB |
| LCP (CPU ×4, warm) | 132–252 ms | 108–116 ms (cold first request: 624 ms) |
| CLS at rest / after the ending | 0 / 0.028 | 0 / 0.033 |
| Open → message beat (in-page) | 193–201 ms | 962–981 ms: the 950 ms envelope gesture, by design |

The world's artwork is no longer preloaded at high priority behind the sealed envelope. It's warmed at idle time, and only the room texture and paper that paint at once are preloaded.

### Accessibility

- Contrast: the new pairs are listed in §3 (all ≥ 4.5:1 for text; captions ink-3 4.9:1).
- The envelope and the world are `aria-hidden`. The opening line, the letter and every keepsake caption are real text. Focus moves to each beat as before. The closing letter is focusable (`tabIndex=0`) and labelled.
- Touch targets ≥ 44 px (cue, chip, ghosts, edit links via min-height).
- Reduced motion has been tested (e2e).
- Keyboard has been tested (e2e). Playwright WebKit skips radios on Tab, so focus-visible on the picker is only checked in Chromium.

## 8. Known limitations

- Screen #1 (the entry after the first scan) is unchanged on purpose. It was approved and frozen on 2026-10-06. A redesign of it would be a proposal for the owner.
- Only emulated browsers were used (Chromium desktop, Pixel 7 emulation and Playwright WebKit for the Safari check). No physical iOS or Android QA was done.
- The envelope's seal is QR Starr's wine for every world (a brand mark). Per-world seal tints are a possible follow-up.
- The Preview step and the theme hero still play the world's GSAP scene (unchanged cost).
- iPhone voice memos are often typed `audio/x-m4a`, which the upload allowlist (`audio/mp4`) doesn't list. This is untested on a device, and changing it is a validation-rule decision, so it was left alone.
- WebKit pixel test (checkout snippet): the snippet is now clamped deterministically (height, not `-webkit-line-clamp`; `text-wrap: wrap`). A rare sub-pixel difference (≈ 1 render in 60 in a stress loop) remains, while the test passed 5/5 and in the final reruns.
- The preview shows 10 ₾ from the local seed; pricing wasn't touched.

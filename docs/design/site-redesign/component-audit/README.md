# Premium component audit and proposal (Phase 1, awaiting approval)

Date: 2026-10-22. Reviewed the live preview (http://127.0.0.1:3400) at 1440 and 390 px, KA and EN.
Proposal images: `proposal-1440.png`, `proposal-390.png`. The real product designs captured from the theme picker are in `real-designs.png`.

## 1. Section audit

| # | Section | Severity | Finding | Decision |
|---|---|---|---|---|
| 1 | Header | – | Clean, functional | Keep |
| 2 | Hero | Medium | Composition is strong. The two floating pill badges ("Opens in the phone's browser", "Voice note · 0:24") are a stock landing-page device, and the phone's waveform implies audio that doesn't exist | Keep the composition; remove the badges; keep the phone waveform static |
| 3 | Moments ribbon | Low | Editorial prints work | Keep |
| 4 | How it works | Low | Photographs carry it; the small icon above each title is a generic icon-and-text habit | Keep; drop the icons |
| 5 | From paper to screen | Low | Distinctive and meaningful. The screen half repeats the same Polaroid pair used elsewhere | Keep; give the screen half the real Romantic design capture |
| 6 | After the scan (demo) | Medium | Component works, but the recipient photo is half-hidden behind the phone and reads as accidental | Keep the component; recompose (photo as the dominant image, phone overlapping its corner) |
| 7 | **Inside a greeting** (your screenshot) | **High** | Four near-identical white cards (same radius, padding, shadow); a dark block of animated bars posing as a voice message; a video "tile" with a play icon that plays nothing; designs shown as tiny envelope swatches rather than the real product | **Replace** (proposal below) |
| 8 | Occasions | Low | Photo carousel + postcard dialog are good; the design chip is the same generic envelope swatch | Keep; chip shows a real design capture |
| 9 | Partners | Medium | Gallery is good; the 4-column icon + title + text benefits row is the classic SaaS feature grid | Replace with an editorial numbered list set against the gallery (typography, no icons) |
| 10 | Pricing | Low | Slip and mockup are good; the lace mat barely reads | Keep; enlarge the mat slightly |
| 11 | Trust + FAQ | Medium | Four icon rows repeat the icon-and-text pattern; FAQ card is good | Keep the FAQ; set the four reassurances as a typographic ledger (numerals, no icons) |
| 12 | Final CTA | – | Postcard fan, photograph and copy are memorable | Keep |
| 13 | Footer | – | Fine | Keep |
| X | Motion overall | Medium | Reveal-on-scroll on almost every block, plus BlurFade and word-by-word text in several places | Keep reveals only on section heads and the hero; one text effect (the demo letter) |
| X | Fake activity | High | The animated waveform in the voice tile is presented as audio activity | Remove; show a waveform only when it is drawn from a real recording |

## 2. Sourcing matrix (section 7)

| Need | Candidate | Source / licence | Weight | Verdict |
|---|---|---|---|---|
| Design showcase | Transition Panel + editorial list | Motion Primitives, https://motion-primitives.com/docs/transition-panel, MIT | ~1 kB + motion (already loaded) | **Recommended**: a numbered list (ARIA tabs) beside a large stage of real design captures that cross-fade |
| | Carousel | Motion Primitives, https://motion-primitives.com/docs/carousel, MIT | ~3 kB | Alternative; reads as an ordinary slider |
| | Carousel (Embla) | shadcn/ui, https://ui.shadcn.com/docs/components/carousel (embla-carousel-react 8.6.0), MIT | 7.1 kB gz new dependency | Rejected: dependency weight for a generic slider |
| | 3D Marquee | Aceternity UI, https://ui.aceternity.com/components/3d-marquee, Aceternity licence | small | Rejected: flashy tech-demo idiom, off-brand |
| Photos | Stack | React Bits, https://reactbits.dev/components/stack, MIT + Commons Clause | already integrated | **Keep and restyle** as captioned prints on a paper ground (no grey tile) |
| | Bounce Cards | React Bits, MIT + CC | already integrated | Rejected here: already the finale's signature, would repeat |
| | Layout Grid | Aceternity UI, https://ui.aceternity.com/components/layout-grid | ~1.5 kB | Rejected: an ordinary click-to-expand grid |
| Video | Hero Video Dialog | Magic UI, https://magicui.design/docs/components/hero-video-dialog, MIT | ~1.5 kB + motion | **Recommended**: cinematic poster with title, duration and real controls; opens a dialog with a native `<video>` (no autoplay, no sound until play) |
| | Media Chrome | https://www.media-chrome.org, MIT | web components, larger | Alternative if custom controls are wanted inline |
| | Vidstack | https://vidstack.io, MIT | ~50 kB+ | Rejected: too heavy for one clip |
| Voice | wavesurfer.js 7.12.12 | https://wavesurfer.xyz, BSD-3-Clause | 14.5 kB gz, lazy on first play | **Recommended**: real waveform from precomputed peaks of a real file; play/pause, seek, time |
| | Custom player + build-time peaks | own code over `<audio>` | 0 deps | Alternative if no new dependency is preferred |
| | react-h5-audio-player | npm, MIT | ~10 kB | Rejected: generic look |
| Layout | Bento Grid | Magic UI (https://magicui.design/docs/components/bento-grid) / Aceternity (https://ui.aceternity.com/components/bento-grid) | small | Rejected: both produce exactly the identical-card grid to remove |
| | Editorial 12-column spread | custom (justified: no library offers an art-directed editorial spread) | 0 | **Recommended** |

## 3. Proposal: "Everything you'd want to say, beautifully kept"

1. **The designs as the hero of the section.**
   - A numbered list of the six designs (Cormorant names, taglines) sits beside a large stage. Selecting one cross-fades the stage to the real capture of that design, with the next two peeking behind.
   - Phones show the stage first and the list as a swipeable row.
2. **An editorial spread:**
   - The letter: a large sheet of paper with real sample words and a sign-off, in place of a ruled textarea.
   - Three captioned prints (the Stack).
   - A wide cinematic video poster.
   - A full-width voice-message bar with a real waveform.
3. **Nothing fakes activity.** The waveform is drawn from a real file. The video poster opens a real clip. Nothing animates on its own.

## 4. Keep / replace / remove

- **Keep:** header; hero composition; moments; how-it-works photos; paper to screen; demo component; occasions carousel and postcards; pricing; FAQ; finale; footer.
- **Replace:**
  - Inside a greeting (the whole section);
  - the partner benefits grid → editorial list;
  - the trust icon rows → typographic ledger;
  - ThemeSwatch chips → real design captures (home page only).
- **Remove:** hero pill badges; step icons; the animated waveform; most reveal-on-scroll; extra text effects.

## 5. Implementation plan (after approval)

1. Capture all six real designs in KA and EN from the theme picker. Encode them as AVIF/WebP and register them as product imagery.
2. Build the showcase from Motion Primitives Transition Panel plus the editorial list (ARIA tabs, keyboard, reduced motion).
3. Restyle the Stack as captioned prints.
4. Integrate Hero Video Dialog with a native `<video>` (licensed clip; captions not needed, no speech).
5. Lazy-load wavesurfer.js with precomputed peaks from the real voice file.
6. Recompose the demo; replace the partners and trust patterns; remove the badges, icons and extra motion.
7. QA: typecheck, lint, build, e2e (incl. new tests for showcase tabs, video dialog and audio player), KA/EN at 320–1440, before/after screenshots, throttled performance.

## 6. Decisions needed

- **Voice note:** a real recording is required. Recommended: you or a team member record a 20–30 s Georgian greeting (your own rights, authentic). Alternative: a CC0 recording from Freesound, which would be a stranger's voice, likely in English.
- **Video clip:** a real short gifting clip. Options:
  - I source one with a verified licence (Mixkit free licence or Pexels; Pexels blocks automated checks, so a browser check is needed);
  - you provide one;
  - the dialog shows the poster only.
- **wavesurfer.js** (one new 14.5 kB lazy dependency) vs a dependency-free custom player.

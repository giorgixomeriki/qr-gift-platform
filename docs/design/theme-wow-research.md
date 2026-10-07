# Screen #2 — WOW pass: research board

Goal: turn six well-designed static themes into six *living* worlds —
choreography, physicality, reveal, depth — without decoration, gimmicks or a
performance regression. Visual board:
`docs/visual-walkthrough/theme-picker-wow/_wow-resource-board.webp`;
prototypes: `_theme-wow-prototypes.webp`; the resulting system:
`QR-STARR-MOTION-LANGUAGE.md`.

Method: resource-first. For every idea we asked whether a professionally made
component, library or asset beats building it ourselves; candidates were
measured in this project (bundle sizes: esbuild + gzip -9) or rendered inside
the real worlds (prototypes injected over the production build, frozen at
fixed times with the Web Animations API, 390 phone, KA).

## Candidates

| Name | Source | Licence | Type | Theme | Interaction idea | Performance cost | Mobile | Use / reject | Why |
|---|---|---|---|---|---|---|---|---|---|
| CSS animations + Web Animations API | Platform | — | Engine | All | Every signature (transform / opacity / clip-path / stroke) | 0 KB | Excellent (compositor) | **Use** | Covers every chosen moment natively; nothing a runtime would add |
| Damped-spring curves as CSS `linear()` | Method of Motion/Framer springs; Jake Archibald & Adam Argyle's linear() generator | — (own implementation of the published technique) | Easing | All | Physical settle / paper / snap springs | 0 KB (≈0.6 KB CSS) | Excellent | **Use** | Professional spring physics with zero runtime; `linear()` in Chrome 113+, Safari 17.2+, Firefox 112+ |
| CSS scroll-driven animations (`view-timeline`) | Platform | — | Engine | Gallery | Size, light and ground parallax track the finger while swiping | 0 KB, compositor | Chrome 115+, Safari 26+; Firefox flag → falls back | **Use** | The single most tactile improvement; no JS on scroll |
| Motion (`motion/mini` animate) | motion.dev | MIT | Library | All | WAAPI + springs from JS | 3.3 KB gz (4.9 KB with spring) | Good | Reject | Springs are precomputed into CSS instead; no JS-driven motion needed |
| Motion (hybrid animate) | motion.dev | MIT | Library | All | Same, plus independent transforms | 19.8 KB gz | Good | Reject | No capability we use |
| GSAP core | gsap.com (now 100% free incl. plugins) | GSAP Standard "no charge" licence | Library | All | Timelines | 27.0 KB gz | Good | Reject | Timelines are expressible as CSS delays; 27 KB for nothing new |
| GSAP SplitText | gsap.com | Same | Library | Minimal | Line/word mask reveal with a11y handling | 29.9 KB gz with core | Good | Reject (strongest runner-up) | Words are React-rendered spans already (world is `aria-hidden`); clip-path per word gives the same reveal at 0 KB |
| GSAP DrawSVG | gsap.com | Same | Library | Celebration, Elegant | Drawing strokes | 28.6 KB gz | Good | Reject | `pathLength=1` + `stroke-dashoffset` does it natively (already used for the rays) |
| lottie-web (light) | Airbnb / LottieFiles | MIT | Runtime | Any | Authored After Effects animations | 47.8 KB gz + JSON per animation | OK | Reject | Bytes, and every Lottie bakes in its type and colour — can't use live KA/EN text or world tokens |
| dotLottie web | LottieFiles | MIT | Runtime | Any | Same, wasm renderer | wasm decoder (~MB-class; LottieFiles forum notes LCP impact) | Poor for a QR landing | Reject | Wasm download on a phone scan |
| LottieFiles free animations | lottiefiles.com | Lottie Simple License (commercial OK) | Animation assets | Celebration, Birthday | Confetti / paper / sparkle loops | + runtime above | — | Reject | The library is UI-illustration idiom (confetti, sparkles) — exactly the "generic celebration" look the brief rules out |
| Rive runtime (canvas-lite) | rive.app | MIT runtime | Runtime | Any | Interactive state machines | 53.9 KB gz JS + ~880 KB wasm | Poor for a QR landing | Reject | Best tool for interactive illustration, wrong cost profile here; also bakes type |
| Rive Community files | rive.app | Per-file (community remix licence) | Assets | — | — | + runtime | — | Reject | Nothing in a stationery idiom; same runtime cost |
| View Transitions API (same-document) | Platform | — | Engine | Desktop stage | Cross-world morph | 0 KB | Good (Chrome, Safari 18+) | Reject | Screen #1→#2 VT was rejected for ghosting; two stacked worlds achieve the sheet change without snapshots |
| Envato Elements / Motion Array AE templates ("paper reveal", "wedding invitation", "luxury intro") | Envato, Motion Array | Subscription | Video templates | Wedding, Elegant | Paper/vellum reveals | Video: MBs | Poor | Reject (public listings only, not acquired) | Invitation-template look; can't carry live KA/EN text; video weight |
| LottieFiles Marketplace premium packs | lottiefiles.com | Paid | Animation packs | All | Paper / invitation / celebration | + runtime | — | Reject (listings only) | Generic UI idiom; runtime cost |
| UI8 motion / 3D kits | ui8.net | Paid | Kits | — | — | — | — | Reject (listings only) | SaaS-product aesthetic; 3D renders clash with print materials |
| Creative Market / Freepik Premium / Adobe Stock "paper cut", "sunburst" vectors | Various | Paid | Vectors | Birthday, Celebration | Pieces to animate | SVG | Good | Reject (listings only) | Template art; the worlds' own geometry is stronger (also concluded in the professional pass) |
| Vellum / tracing-paper scan | ambientCG, Poly Haven (searched) | CC0 | Texture | Wedding | Vellum with fibre | small | Good | Not available | Neither library has vellum; Paper002 was already invisible at strength — vellum stays a CSS material (translucent ivory + 2.2 px backdrop blur) |
| Honeysuckle engraving (Wellcome, 1775) | Wikimedia Commons | CC BY 4.0 | Artwork (existing) | Romantic | Appears where the light lands | existing | Good | **Use (now animated)** | Professional artwork made to *participate* in the moment |
| Olive lithograph (W. H. Fitch, 1874) | Wikimedia Commons | Public domain | Artwork (existing) | Wedding | Comes up crisp as the vellum is drawn off | existing | Good | **Use (now animated)** | Same |
| Window-light map, Rough Linen | Unsplash, Poly Haven | Unsplash / CC0 | Material (existing) | Romantic | The light travels across the linen | existing | Good | **Use (now animated)** | The light *is* Romantic's signature |
| Vibration API | W3C | — | Haptics | Selectors | Tick on choose | 0 KB | Android only; not in iOS Safari | Reject | Inconsistent; the `<input switch>` iOS workaround was patched in iOS 26.5 |
| Sound design | — | — | Audio | — | Paper / chime on reveal | small | — | Reject | No autoplay; QR scans happen in public; intrusive |
| Ambient world light around the gallery (prototype T2) | Own | — | Interaction | All | Page takes on the chosen world's light | 0 KB | Good | Reject | Barely visible; making it visible = glow |

### Inspiration (patterns, not looks)

- **Animated-envelope invitations (Greenvelope, Paperless Post):** occasion is
  created by a physical reveal. QR Starr applies the pattern to each world's
  *own* material (vellum, light, paper, aperture) instead of a generic
  envelope — and keeps the reveal for the sender's choice, not a splash screen.
- **Editorial sites (Awwwards / Godly-class):** type that resolves line by
  line, apertures, ruled frames drawn in — used only where it belongs
  (Minimal, Elegant), at a fraction of their duration.
- **Native iOS/Android pickers:** press compression with spring release;
  carousels whose items scale with their distance from centre.

## Prototype scores (1–5)

Impact · Premium · Originality · Fit · Mobile · Performance · Accessibility · Maintainability.

| World | Candidate | I | P | O | F | M | Perf | A11y | Maint | Total | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Romantic | R1 light finds the letter | 4 | 5 | 4 | 5 | 4 | 5 | 5 | 4 | 36 | **Winner** |
| Romantic | R2 card placed from below | 3 | 3 | 2 | 3 | 4 | 5 | 5 | 5 | 30 | Reject — generic |
| Wedding | W1 vellum drawn off | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 38 | **Winner** (refined: lift + fade so it never reads as a slab) |
| Wedding | W2 raking light over emboss | 1 | 4 | 4 | 4 | 1 | 4 | 5 | 4 | 27 | Reject — invisible on phones |
| Birthday | B1 cut paper snaps in | 5 | 4 | 4 | 5 | 5 | 5 | 5 | 4 | 37 | **Winner** |
| Celebration | C1 ignition | 5 | 4 | 4 | 5 | 5 | 5 | 5 | 4 | 37 | **Winner** (card fades in so it never peeks) |
| Celebration | C2 fan opens | 3 | 3 | 2 | 4 | 4 | 5 | 5 | 5 | 31 | Reject — close to current, mechanical |
| Elegant | E1 aperture | 4 | 5 | 4 | 5 | 4 | 5 | 5 | 4 | 36 | **Winner** |
| Elegant | E2 type exposed | 2 | 4 | 3 | 4 | 3 | 5 | 5 | 5 | 31 | Reject — too quiet |
| Minimal | M1 words resolve | 4 | 5 | 3 | 5 | 4 | 5 | 5 | 4 | 35 | **Winner** (with fade so glyph fragments never show harshly) |
| Minimal | M2 point travels | 2 | 3 | 2 | 4 | 4 | 5 | 5 | 5 | 30 | Reject — no moment |
| Gallery | T1 depth tracks the finger | 4 | 5 | 3 | 5 | 5 | 5 | 5 | 4 | 36 | **Use** |
| Gallery | T3 hero world (84vw; short-phone recomposition) | 4 | 4 | 2 | 5 | 5 | 5 | 5 | 5 | 35 | **Use** |
| Gallery | T2 ambient world light | 1 | 2 | 2 | 3 | 3 | 5 | 5 | 4 | 25 | Reject |
| Desktop | T4 sheet change (old beneath new) | 4 | 5 | 3 | 5 | — | 5 | 5 | 4 | — | **Use** (prototype exposed a blank-frame flash in the old fade; fixed by keeping the old world beneath) |
| Selectors | S1 press + micro-identity | 3 | 4 | 4 | 5 | 5 | 5 | 5 | 4 | 35 | **Use** |

## Paid resources that would materially improve it

| Resource | What it would improve |
|---|---|
| **Lava Georgian** (Typotheque, commercial) | Still the highest-value purchase: true Georgian italics. Romantic's light and Wedding's vellum reveal type; in KA that type is Noto Serif Georgian roman. A designed Georgian italic would make the KA reveals as expressive as EN |
| A bespoke **vellum / tracing-paper scan** (photographed in-house, or a paid macro texture) | Wedding's sheet would show real fibre as it is drawn off; no CC0 source exists |
| Nothing in motion marketplaces | No paid motion asset beat native choreography with live type (see table) |

## Sources

- GSAP is 100% free incl. SplitText, DrawSVG: https://webflow.com/updates/gsap-becomes-free
- Rive runtime sizes: https://rive.app/docs/runtimes/runtime-sizes.md
- dotLottie wasm and LCP: https://forum.lottiefiles.com/t/how-to-reduce-dotlottie-initial-rendering-time-due-to-wasm/6802
- LottieFiles free-animation licence: https://help.lottiefiles.com/hc/en-us/articles/900002438343-Can-I-use-a-free-animation-on-Lottiefiles-for-commercial-business-use
- Motion mini / springs via linear(): https://motion.dev/docs/improvements-to-the-web-animations-api-dx
- linear() easing and generator: https://developer.chrome.com/docs/css-ui/css-linear-easing-function
- Scroll-driven animations (Chrome 115, Safari 26): https://developer.chrome.com/docs/css-ui/scroll-driven-animations
- iOS web haptics workaround and its iOS 26.5 patch: https://www.mintlify.com/lochie/web-haptics/advanced/browser-support
- Animated envelope invitations: https://card.greenvelope.com/resources/animated-envelope-invitations
- ambientCG paper library (no vellum): https://ambientcg.com/list?q=paper

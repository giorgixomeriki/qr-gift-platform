# QR Starr — Design Arsenal

A living catalogue of vetted resources for building QR Starr's consumer
experience: what each one is good for, what it costs, and whether we may use
it. It is a **discovery system and decision framework**, not a shopping list.
Production dependencies stay few; most entries are things we search, study,
adapt or license case by case.

Owner: design engineering. Last researched: 2026-10-06 (licences and
compatibility checked against primary sources where linked; anything marked
*verify* must be re-checked before use).

Related: `QR-STARR-MOTION-LANGUAGE.md` (how things move),
`THEME-ENGINE.md` (how templates are built), `theme-wow-research.md` and
`theme-professional-components.md` (measured evaluations behind several
verdicts), `public/customer/LICENSES.md` (every shipped third-party asset).

---

## 1. Rules

### 1.1 Search before build

Before building a complex visual effect or component from scratch:

1. **Define the feeling** — the emotional and visual behaviour wanted, in words, before any reference.
2. **Search this Arsenal**, then the inspiration sources (§9).
3. **Inspect several candidates** — never the first that looks good.
4. **Compare quality** inside a real QR Starr world, at 390 px, in KA as well as EN.
5. **Check mobile** — a mid-range Android and iOS Safari, 4× CPU throttling.
6. **Check performance** — bytes, main-thread time, GPU, battery; can it load lazily?
7. **Check the licence** — including §1.4.
8. **Check accessibility** — reduced motion, focus, semantics, contrast.
9. **Decide**: reuse · adapt · combine · build custom. Record the decision
   (in the PR, or the relevant research doc) with the rejected alternatives.

Never adopt a component because it is flashy. It must fit QR Starr's art direction.

### 1.2 Arsenal ≠ design system

External libraries supply **primitives and ideas**, never QR Starr's identity.
Typography, spacing, materials, colour, motion language and hierarchy are ours
(`DESIGN_SYSTEM.md`, `globals.css`, the theme worlds). An adapted component
is restyled to our tokens, re-timed to our easings, stripped of anything that
reads as its source. The test: nobody should be able to say "that's an
Aceternity card" or "that's a Magic UI demo".

### 1.3 Dependency hygiene — eight questions

Every new **runtime** dependency must answer, in its PR:

1. Why do we need it?
2. What existing dependency or platform feature cannot do this?
3. Is it actively maintained (commits, releases, issue response)?
4. Does it support our stack (React 19, Next.js 15 App Router, SSR, our CSP)?
5. What does it cost — gzipped bytes, wasm, main-thread time?
6. Can it be lazy-loaded so that customers who never need it never download it?
7. Is the licence appropriate for commercial use **and** for §1.4?
8. What happens if we remove it later?

Weak answers → do not install. Prefer copying permitted source into
`src/components/` (owned, restyled, tree-shaken) over a runtime package.

### 1.4 Template-resale rule (important)

QR Starr will sell templates (premium templates, a possible creator
marketplace). Some component licences forbid exactly that: **Aceternity UI**
("cannot create themes, templates … to sell") and **Hover.dev** ("sale or
redistribution … as standalone products") both restrict resale. Therefore:

- Code under such licences may be used, if at all, only in **app chrome**
  (never in a theme composition, scene or anything a creator could export).
- Theme compositions, scenes and their assets use only **MIT / Apache / ISC /
  BSD / CC0 / public-domain / CC BY** sources (or our own work, or assets
  licensed explicitly for resale-in-product).
- Record every adapted source in a file header comment and, for assets, in
  `public/customer/LICENSES.md`.

### 1.5 Motion responsibility

| Tool | Owns | Not for |
|---|---|---|
| **CSS** (transitions, keyframes, `linear()` springs, scroll-driven animations) | Default for everything: press feedback, chrome, room arrivals, rest-state fades, reduced-motion fallbacks | Multi-element choreography with measured layout |
| **GSAP** (installed, lazy chunk) | Theme **scenes**: timelines, SplitText reveals, Physics2D, FLIP of type | App chrome, anything on the first paint |
| **Motion** (not installed) | React UI motion when it arrives: gestures, shared layout, presence, springs in JS | Theme scenes (GSAP already owns them) |
| **Rive** (not installed) | A future *signature* interactive scene with a state machine | Anything CSS/GSAP can do; anything that must carry live KA/EN text |
| **Lottie** (not installed) | Small authored vector loops in app chrome (e.g. a success tick), if ever | Theme worlds (bakes type and colour; runtime cost) |
| **WebGL** (R3F/Three, shaders) | Only where space or light is the point and a CSS fallback exists | "Premium" decoration |

Never two engines on one element. Every engine beyond CSS is loaded on demand.

### 1.6 Verdicts

**CORE** — in the codebase or the default choice for its job.
**SELECTIVE** — approved for specific, justified uses; lazy-loaded; one PR at a time.
**INSPIRATION** — study and adapt ideas or permitted source; no dependency.
**AVOID** — not needed, wrong cost profile, or licence conflict.

---

## 2. Foundation & accessibility

**shadcn/ui** — https://ui.shadcn.com · Component registry (copy-in source over Radix or Base UI)
- Good at: well-structured, accessible primitives you own; CLI registry ecosystem many other sources (Magic UI, Cult UI, 21st.dev) publish into.
- Not good at: identity — its defaults are the most recognisable "SaaS" look on the web.
- QR Starr: source of *structure* for Admin/Partner dialogs, popovers, menus; never its visual style on consumer screens.
- Mobile ✓ · Perf: per component · A11y: inherits primitive layer · Licence: MIT · Model: copy-in source.
- **Verdict: SELECTIVE** (Admin/Partner; consumer only when restyled to `cx-*`).

**Base UI** — https://base-ui.com · Headless primitives (MUI team)
- Good at: unstyled accessible dialogs, menus, sliders; smaller than Radix; default primitive layer for new shadcn projects since 2026-07 (Radix still supported).
- Not good at: anything visual.
- QR Starr: the primitive layer to choose **if** we adopt one for a complex widget (e.g. a future template-library sheet with focus trap).
- Mobile ✓ · A11y ✓✓ · Licence: MIT · Model: npm. **Verdict: SELECTIVE** — adopt with the first widget our own `Sheet`/`Button` cannot cover.

**Radix Primitives** — https://www.radix-ui.com/primitives
- Mature, accessible, widely known; larger than Base UI. Licence: MIT.
- **Verdict: SELECTIVE** — acceptable alternative; pick one primitive layer, not both.

**React Aria (Adobe)** — https://react-spectrum.adobe.com/react-aria/
- Best-in-class i18n-aware accessibility hooks (incl. RTL, date/number formatting), heavier and more verbose.
- QR Starr: reference implementation when we need a hard pattern right (carousel/radiogroup semantics, drag-and-drop). Licence: Apache 2.0.
- **Verdict: INSPIRATION** (consult patterns; install only for a widget nothing else handles).

**Existing QR Starr primitives** — `src/components/ui/*`, `components/flow/*`, `components/customer/*`
- Button, Field, Notice, Sheet, Spinner, ActionBar, PrimaryAction, Phosphor vocabulary. Already KA-aware (wrapping labels, no Mtavruli uppercase).
- **Verdict: CORE** — extend these first.

**WAI-ARIA Authoring Practices** — https://www.w3.org/WAI/ARIA/apg/
- Canonical keyboard/role patterns (the picker's radiogroup follows "Radio Group"). **Verdict: CORE** (reference).

## 3. Motion

**CSS animations, transitions, `linear()` springs** — platform
- Our default engine (see `QR-STARR-MOTION-LANGUAGE.md`): springs precomputed into `linear()` (Chrome 113+, Safari 17.2+, Firefox 112+). 0 KB, compositor-friendly, reduced-motion trivially handled.
- **Verdict: CORE.**

**CSS scroll-driven animations** — https://developer.chrome.com/docs/css-ui/scroll-driven-animations
- Gallery depth tracking the finger with no JS on scroll (Chrome 115+, Safari 26+; graceful fallback). **Verdict: CORE** (behind `@supports` + `prefers-reduced-motion`).

**View Transitions API** — platform; React `<ViewTransition>`
- Same-document VT is in modern browsers; React's `<ViewTransition>` component is **canary/experimental**, and Next's `viewTransition` flag is "not recommended for production". A Screen #1→#2 VT was already rejected for ghosting.
- **Verdict: SELECTIVE** — plain `document.startViewTransition` for isolated cases; not the React component until stable.

**GSAP 3.15** (+ SplitText, Physics2D, CustomEase) — https://gsap.com · **installed**
- Good at: precise timelines, text splitting with masks, physics, FLIP. Free for commercial use incl. all plugins (GSAP "Standard No Charge" licence since the Webflow acquisition).
- Not good at: being small (~36 KB gz across our five lazy chunks); React-declarative UI.
- QR Starr: owns the six theme scenes (`components/themes/scenes/`), loaded on demand and prefetched on idle; never in the route's initial JS (verified in build manifest).
- Licence: GSAP Standard No Charge (not OSI) — permits use in commercial products; *verify* terms before shipping GSAP *source* inside a creator-exportable package.
- **Verdict: CORE** for scenes only.

**Motion (formerly Framer Motion)** — https://motion.dev · not installed
- Good at: React gestures, `layout`/shared-element animation, `AnimatePresence`, JS springs. React 18/19. `LazyMotion` + `m` ≈ 4.6 KB gz; full `motion` ≈ 34 KB gz; `animate` mini ≈ 2.3 KB.
- Not good at: timeline choreography of the kind scenes need (GSAP has it).
- QR Starr: adopt (with `LazyMotion`) when the first real need appears — e.g. drag-to-dismiss sheets, a template library with shared-element expansion, reorderable media. Not needed for the current picker (measured and rejected in the WOW pass).
- Licence: MIT. **Verdict: SELECTIVE** (pre-approved; add on first need, never alongside GSAP on the same element).

**Motion Primitives** — https://motion-primitives.com · copy-in (Motion + Tailwind)
- Text effects, morphing dialogs, in-view reveals. MIT. Requires Motion.
- **Verdict: INSPIRATION** — adapt patterns into GSAP/CSS where they fit.

**Theatre.js** — https://www.theatrejs.com
- Visual timeline editor for keyframing in the browser; core Apache-2.0, studio AGPL (dev-only). Development partly moved private.
- QR Starr: possible authoring aid for complex scenes; uncertain maintenance.
- **Verdict: AVOID** for now (GSAP timelines + code review are enough).

**NumberFlow** — https://number-flow.barvian.me · `@number-flow/react`
- Accessible, locale-aware animated numbers; MIT, dependency-free.
- QR Starr: price/total transitions in checkout, partner dashboard counters. Check Georgian lari formatting.
- **Verdict: SELECTIVE.**

**Lenis** — https://lenis.darkroom.engineering
- Smooth-scroll library (MIT). Hijacking scroll on mobile hurts native feel and accessibility.
- **Verdict: AVOID.**

**Embla Carousel** — https://www.embla-carousel.com
- Lightweight, dependency-free carousel engine (MIT); good accessibility plugins.
- QR Starr: the picker gallery uses native scroll-snap (better on iOS); Embla is the fallback if we need looping or programmatic physics later.
- **Verdict: SELECTIVE** (only if native snap proves insufficient).

**Vaul** — https://github.com/emilkowalski/vaul
- Drawer component; README states **unmaintained**. MIT.
- **Verdict: AVOID** as a dependency; INSPIRATION for drawer physics.

## 4. Authored & asset-based animation

**Rive** — https://rive.app
- Good at: interactive, state-machine-driven vector scenes; designer-authored; small `.riv` files. Runtimes MIT; editor exports now require a paid plan (Cadet ≈ $9/seat/mo; exported files keep working forever).
- Not good at: our cost profile — ~54 KB gz JS + ~880 KB wasm (measured in WOW pass); live text is possible but KA font embedding is work.
- QR Starr: a future **IMMERSIVE**-tier signature (e.g. an interactive wax seal the recipient breaks) — lazy, recipient-side, with a CSS fallback.
- **Verdict: SELECTIVE** (immersive tier only; prototype before committing).

**Rive Community files** — https://rive.app/community
- Per-file remix licences; nothing in a stationery idiom. **Verdict: INSPIRATION.**

**Lottie / dotLottie** — https://lottiefiles.com · `@lottiefiles/dotlottie-web` (MIT)
- Good at: After Effects animations as vectors; huge catalogue.
- Not good at: our worlds — bakes type and colour (no live KA/EN, no world tokens); dotLottie wasm ≈ 500 KB compressed (LCP impact), lottie-web ≈ 48 KB gz.
- QR Starr: at most a tiny success/activation mark in app chrome, as a lazy asset.
- **Verdict: AVOID** in themes · SELECTIVE in chrome.

**LottieFiles free animations** — Lottie Simple License (commercial OK).
- The catalogue is generic UI-illustration idiom (confetti, sparkles). **Verdict: AVOID** for consumer art.

**SVGator** — https://www.svgator.com
- Exports animated SVG with CSS/JS player; useful for small authored line animations without a runtime library. Paid; *verify* export licence.
- **Verdict: INSPIRATION.**

**Jitter** — https://jitter.video
- Fast motion-design prototyping (export video/Lottie). Great for **storyboarding** scenes before coding them.
- **Verdict: INSPIRATION** (design tool, not runtime).

## 5. Component & inspiration registries

| Registry | URL | Licence | Our use | Verdict |
|---|---|---|---|---|
| **21st.dev** | https://21st.dev | Platform is open source; **each component carries its author's licence** — check per component; daily copy limits on free tier | Discovery: search by effect name, inspect several authors' takes | INSPIRATION |
| **Aceternity UI** | https://ui.aceternity.com | **Custom proprietary**: commercial end products OK; **no reselling as themes/templates** | Ideas for app chrome only — never theme compositions (§1.4) | INSPIRATION (restricted) |
| **Magic UI** | https://magicui.design | MIT (free set) | Text/number effects, marquee, border beams — mostly SaaS-landing idiom | INSPIRATION |
| **Motion Primitives** | https://motion-primitives.com | MIT | See §3 | INSPIRATION |
| **Cult UI** | https://www.cult-ui.com | MIT (free set; separate Pro) | Tactile buttons, dynamic island-style patterns | INSPIRATION |
| **Animata** | https://animata.design | MIT | Small, readable CSS/Tailwind animations — good to learn timing | INSPIRATION |
| **Hover.dev** | https://www.hover.dev | Proprietary: commercial OK; **no redistribution as standalone products** | Interaction ideas for chrome only (§1.4) | INSPIRATION (restricted) |
| **Origin UI / shadcn blocks** | https://originui.com | MIT (*verify* per block) | Admin/Partner forms and tables | SELECTIVE (dashboards) |

Common verdict: these registries trend toward dark-mode SaaS aesthetics
(glow, beams, gradient borders, spotlight cards). For QR Starr they are a
place to see **mechanics** — then rebuild in our materials.

## 6. 3D, WebGL & shaders

**Three.js** — https://threejs.org · MIT
- The WebGL standard library; ~150 KB+ gz for typical use. **Verdict: SELECTIVE** (immersive tier, lazy, with fallback).

**React Three Fiber v9 + drei** — https://r3f.docs.pmnd.rs · MIT
- R3F v9 is the React 19 line (v8 is incompatible with React 19). Declarative Three in React.
- QR Starr: only for a template whose *point* is space (e.g. a future "Night sky" reveal you can look around); never for flat paper.
- **Verdict: SELECTIVE** (immersive tier only).

**Spline** — https://spline.design · `@splinetool/react-spline` (MIT wrapper)
- Easiest 3D authoring; runtime ≈ 500 KB+ and scenes often MBs. *Verify* scene/export terms per plan.
- **Verdict: AVOID** for customer surfaces (cost on a QR scan); INSPIRATION for concepting.

**Paper Shaders** — https://shaders.paper.design · `@paper-design/shaders-react` · Apache 2.0
- ~28 zero-dependency WebGL2 shaders (grain, mesh gradients, paper texture, dithering); React 18/19; SSR-safe; commercial use without attribution.
- QR Starr: the best candidate if a world ever needs **living light or paper grain** beyond static textures (e.g. a slowly shifting window light in a future recipient reveal) — lazy, opt-in, with the current static texture as fallback; respects the "nothing loops" rule only if it renders a still or a one-shot.
- **Verdict: SELECTIVE.**

**Unicorn Studio** — https://www.unicorn.studio
- No-code WebGL scenes; ~29–46 KB gz runtime; commercial licence on paid plan.
- **Verdict: INSPIRATION** (hosted-scene model doesn't fit our validated renderer).

**OGL** — https://github.com/oframe/ogl · Unlicense
- Minimal WebGL library (~8–10 KB). For a single custom shader without Three.
- **Verdict: SELECTIVE** (alternative to Three for one-effect cases).

**ShaderGradient / Haikei / mesh-gradient generators**
- Generic gradient-blob idiom. **Verdict: AVOID** (see "QR Starr never").

## 7. Icons & marks

**Phosphor Icons** — https://phosphoricons.com · `@phosphor-icons/react` · MIT · **installed**
- Consumer UI icon family via the semantic vocabulary `components/customer/icons.ts`. **Verdict: CORE (consumer).**

**Lucide** — https://lucide.dev · ISC · **installed**
- Admin/Partner icons. Never mixed with Phosphor on one screen. **Verdict: CORE (Admin/Partner).**

**Starr spark** — `components/ui/logo.tsx`
- Our own mark; the "finale" of every world. **Verdict: CORE.**

## 8. Type (KA + EN)

Georgian is the scarce resource — only three Google Fonts families ship
Georgian (research: `QR-STARR-CUSTOMER-DESIGN-RESOURCES.md` §3).

**Google Fonts / OFL families** (self-hosted) — https://fonts.google.com · OFL 1.1
- In use: Google Sans, Newsreader, Noto Serif/Sans Georgian, EB Garamond, Fraunces, Gilda Display, Instrument Sans (licences in `public/fonts/`). **Verdict: CORE.**

**FiraGO** — https://bboxtype.com/typefaces/FiraGO · OFL
- Open sans with native Georgian; a second sans voice for future templates. **Verdict: SELECTIVE.**

**BPG fonts** — https://bpgfonts.wordpress.com
- Large Georgian catalogue; licences vary per font (GPL+font exception / Bitstream-Vera-style). *Verify* per family. **Verdict: SELECTIVE** (case by case).

**Typotheque — Lava Georgian & others** — https://www.typotheque.com
- Professional Georgian with designed italics; commercial licence. The single highest-value paid purchase (gives KA reveals the expressiveness of EN italics). **Verdict: SELECTIVE (recommended purchase).**

**Fontshare** — https://www.fontshare.com
- Free (ITF FFL) Latin display faces; **0 support Georgian**. **Verdict: INSPIRATION** (Latin-only pairings must be paired with a Georgian face).

## 9. Assets: textures, artwork, footage, audio

| Source | URL | Licence | Our use | Verdict |
|---|---|---|---|---|
| **Poly Haven** | https://polyhaven.com | CC0 | Linen relief (in use), paper/fabric scans | CORE |
| **ambientCG** | https://ambientcg.com | CC0 | Paper tooth (in use); no vellum available | CORE |
| **Wikimedia Commons / Wellcome Collection** | https://commons.wikimedia.org | PD / CC BY 4.0 (per file) | Period engravings as masks (honeysuckle CC BY — attribution required; olive PD) | CORE (per-file check) |
| **Biodiversity Heritage Library** | https://www.biodiversitylibrary.org | Mostly PD / CC (per item) | More botanical engravings for future worlds | SELECTIVE |
| **Unsplash** | https://unsplash.com/license | Unsplash License (no standalone resale; Unsplash+ excluded) | Light maps (window light, in use); macro materials | SELECTIVE |
| **Pexels (video)** | https://www.pexels.com/license/ | Pexels License | Leaf-shadow light map (in use) | SELECTIVE |
| **Mixkit (video)** | https://mixkit.co/license/ | Mixkit Free (no standalone redistribution) | Night-sky footage (in use) | SELECTIVE |
| **Magnific (ex-Freepik)** | https://www.magnific.com | Premium: no attribution; **mockup licences ≠ product art** | Possible stationery/3D gift renders — check item type | SELECTIVE (premium, per item) |
| **Envato / Motion Array / Creative Market / UI8** | — | Subscription / per item | Template-look; video weight; can't carry live KA/EN | AVOID (evaluated in WOW pass) |
| **Commissioned art** | — | Work-for-hire / assigned | Signature pieces: custom wax seal, world artwork sets, vellum scan | CORE (for signature assets) |
| **Freesound** | https://freesound.org | CC0 / CC BY / CC BY-NC per sound | Future theme ambience — **CC0 only** by default; CC BY with credits; never NC | SELECTIVE |
| **Zapsplat** | https://www.zapsplat.com | Free tier needs attribution; Gold removes it | Paper/seal foley for a future reveal | SELECTIVE |
| **Pixabay Music** | https://pixabay.com/service/terms/ | Pixabay Content License; tracks may be Content-ID-registered later | Background music — risk of later claims | AVOID for bundled theme music |
| **Commissioned / original audio** | — | Owned | The right answer for any signature theme sound | CORE (when audio ships) |

Copyright rule for genre templates (anime-inspired, gaming, cinematic,
nightlife): original aesthetics only — no characters, franchise art, logos,
fonts, music or recognisable branded identities.

## 10. Inspiration sources (look, don't lift)

| Source | URL | Why |
|---|---|---|
| Godly | https://godly.website | Best-curated motion/editorial web; timing and type |
| Awwwards (Sites of the Day) | https://www.awwwards.com | Scene choreography; beware novelty for its own sake |
| Mobbin | https://mobbin.com | Real mobile app flows (pickers, sheets, checkout) — paid |
| Paperless Post / Greenvelope | https://www.paperlesspost.com | Digital stationery reveals — the closest category peers |
| Minted / Papier | https://www.minted.com | Stationery art direction, wedding typography |
| Fonts In Use | https://fontsinuse.com | Real-world type pairings by genre |
| Codrops | https://tympanus.net/codrops | WebGL/CSS technique write-ups with source (licence per demo — *verify*) |
| Rauno Freiberg / Emil Kowalski writing | https://rauno.me · https://emilkowal.ski | Craft of interaction details; animation durations and interruptibility |
| Apple Human Interface Guidelines — Motion | https://developer.apple.com/design/human-interface-guidelines/motion | Purposeful, interruptible motion on phones |

## 11. Tooling for measuring

| Tool | Use | Verdict |
|---|---|---|
| Chrome DevTools Performance + CPU 4× / network throttling | Every scene change; longest task, frames > 50 ms | CORE |
| Playwright (installed) | E2E + screenshot QA harness (5 widths × KA/EN) | CORE |
| `next build` route sizes + build manifest | Prove engines stay out of the initial chunk | CORE |
| WebPageTest / real devices | Before pilot: iPhone SE-class + mid Android on 4G | CORE |
| `bundlephobia` / `pkg-size.dev` | Pre-install cost check | CORE |

---

## 12. Summary — what is actually in the product

| Layer | In production | Lazy? |
|---|---|---|
| Motion | CSS (+ `linear()` springs, scroll-driven) · GSAP 3.15 for theme scenes | GSAP: yes, own chunks, idle-prefetched |
| Primitives | Own `ui/*`, `flow/*`, `customer/*` | — |
| Icons | Phosphor (consumer), Lucide (admin/partner) | per-icon imports |
| Type | Self-hosted OFL faces, per-world families loaded near viewport | yes |
| Assets | CC0 / PD / CC BY / Unsplash / Pexels / Mixkit, all in `LICENSES.md` | footage: only when its scene plays |
| 3D / Rive / Lottie | none | — |

Count: 73 entries — 59 vetted resources with a verdict (§2–§9) plus 9
inspiration sources (§10) and 5 measuring tools (§11).

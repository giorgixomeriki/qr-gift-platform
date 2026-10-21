# Public home page redesign (qrapp.ge `/`)

Branch `design/public-site-redesign`, from production `feat/render-low-cost-hosting` @ bfbbae8.
Design-only: no change to auth, payments, pricing logic, database, QR tokens, storage, env or security settings.

## 1. Audit of the production home page (2026-10-21)

| Area | Finding |
|---|---|
| Structure | One hero (eyebrow "For partners", headline, one paragraph, **Partner sign in** as the only CTA) plus the footer. No explanation of the scan, the greeting contents, occasions, price, privacy or the partner offer. |
| Navigation | The home page had no site navigation, only the logo and the language switch. The info pages had a header, but the home page did not. |
| Conversion | The only action was partner sign-in. There was no route for prospective partners (contact), and customers had no reason to look further. |
| Visual | A generic ThemeSwatch illustration (navy "Celebration") clashed with the wine/ivory Screen #1 that customers actually see after scanning. The ember accent on the site and the wine accent in the product were two brand colours. |
| Typography | Georgian display was fine at desktop, but the hero lacked hierarchy and rhythm. The page ended above the fold with large empty areas. |
| Mobile | The layout did not overflow, but it was a short page with no story. Footer links were single-column. |
| Accessibility | Basics were in place (skip link, lang, focus). No issues blocking the redesign. |
| SEO | Metadata was the generic app title and tagline. Indexing is denied site-wide (root layout `robots: noindex`), a deliberate earlier decision that is left unchanged. |
| Reusable assets | Self-hosted Google Sans, Newsreader and Noto Serif Georgian (OFL); licensed textures and scenes (`public/customer/LICENSES.md`); WaxSeal and Spark brand marks; ThemeSwatch; the site copy system (`messages/site`, inline tokens, `verify:site-content`). |
| Previous design work | Signature (A+B+C hybrid, `design/v2-signature-final-polish`) is the owner-approved direction. Screen #1 in production already uses its wine/paper tokens (`--cx-*`). This redesign extends that identity to the public site and does not touch any existing design branch. |

## 2. Creative direction

The **Signature identity on the marketing surface**: ivory cotton paper in window light, wine wax as the single accent, a light serif (Noto Serif Georgian 300 / Newsreader) for words and Google Sans for UI, and editorial kickers, numerals and ruled rows. The hero is a physical **QR card on a table beside the phone it opened**. The QR on the card is real and points to `https://qrapp.ge`, never to a greeting token. Every word on the illustrated objects is live, translatable HTML, not a screenshot.

Never used: glassmorphism, neon, gradient blobs, particle fields, stock people, fake testimonials, invented partners or payment methods.

## 3. Sections (`src/components/site/home/`)

1. **Header** (shared `SiteHeader`): nav, language switch, and a new Partner sign-in, also added to the mobile menu.
2. **Hero**: the promise ("Your words, inside the gift."), a CTA to the scan walkthrough, a partner CTA, three assurances, and the card+phone stage.
3. **After the scan**: a four-moment tab list (Scan, Open, Read, Keep) driving a phone. It auto-advances only while in view, never under reduced motion, and stops permanently once the visitor chooses a moment. ARIA tabs with arrow/Home/End keys.
4. **How it works**: three steps.
5. **Inside a greeting**: bento of letter, photos, video, voice and the six real designs (ThemeSwatch).
6. **Occasions**: six occasions, each paired with a real design. Swipeable row on phones.
7. **Partners**: dark wine band, contact and sign-in CTAs, printed card sheet, four benefits taken verbatim from the about page.
8. **Pricing**: an order slip whose price comes from `{{price}}` (pricing data, as on /pricing), with a "price shown at checkout" note.
9. **Trust + FAQ**: four reassurances and five native `<details>` questions.
10. **Final CTA**: wax seal, closing line, two actions.
11. **Footer** (shared): tagline in serif, two-column groups on phones; testids and merchant logic unchanged.

All facts come from code (`{{fact.*}}`: limits, theme count, edit-access days) or pricing data. `verify:site-content` enforces no hard-coded prices, no commission exposure and Georgian-only KA strings.

## 4. Components and libraries register

The brief asked for an evaluation of Aceternity UI, Magic UI, shadcn/ui and Motion Primitives. Licences were rechecked on 2026-10-21, and the verdicts in `docs/design/QR-STARR-DESIGN-ARSENAL.md` still hold.

| Source | Licence (checked) | Decision | What was taken |
|---|---|---|---|
| Magic UI | MIT ("Copyright (c) Magic UI") | Pattern adapted, no code copied | The "blur fade / in-view" reveal idea became `reveal.tsx` (one IntersectionObserver, CSS opacity and transform). The animated-waveform idea became the CSS `hm-wave`. |
| Motion Primitives | MIT (per project README; the LICENSE file URL 404s) | Pattern only | "In view" and "transition panel" patterns became the demo crossfade in plain CSS, so no `motion` dependency was added. |
| shadcn/ui | MIT | Structure only | Accordion semantics replaced by native `<details name>` (exclusive open, no JS). Tabs follow the ARIA APG pattern. |
| Aceternity UI | Proprietary (commercial end products OK; no reselling as templates/themes) | **Not used** | Inspiration only. Its 3D/spotlight idiom conflicts with the brand, and its licence is restricted (arsenal §1.4). |
| Phosphor Icons (installed) | MIT | Used | SSR icon modules, light weight. |
| `qrcode` (installed) | MIT | Used | Server-generated SVG for the illustrated cards. |

**No new dependencies, and nothing paid.** Everything visual is original QR Starr code (`home.css`, `objects.tsx`).

## 5. Assets reused (all already licensed, see `public/customer/LICENSES.md`)

`textures/window-light-900`, `scenes/romantic-leaves-rest` (hero light and leaf shadow); `textures/paper-tooth-256`, `textures/linen-rough-256` (paper/linen); `illustrations/entry-stationery-mobile-640`, `scenes/celebration-sky-rest`, `scenes/celebration-room` (photo prints and video poster in the illustrations).

## 6. Accessibility and performance notes

- Contrast (WCAG): lowest text pair is caption ink on paper-2, 4.82:1; text on wine is 10.4–14.9:1.
- Touch targets are at least 44px. Reduced motion shows everything at rest, and the demo never auto-advances.
- Content is visible without JS; reveals only hide blocks below the fold after hydration.
- Motion is transform/opacity only, runs once, and is pausable through interaction. There is no scroll hijacking.
- `/` page JS is 4.76 kB (124 kB first load, which includes the shared 103 kB). Images are the existing small AVIF/WebP files (~10–60 KB).

## 7. Known limitations

- Indexing stays `noindex` site-wide, a business/SEO decision for the owner.
- The info pages get the new header, footer and wine skin, but their body layouts are unchanged.
- The illustrations use the sample name "Ana" (tagged "Example"), and the voice note "0:24" is decorative.
- Only emulated browsers were tested; no physical-device QA.

## 8. Final quality review (2026-10-21, second pass)

These were the five biggest remaining weaknesses, and how each was fixed:

1. **Unconvincing phone mockups.** Added an iOS-style status bar and enlarged the type on every screen so it can be read. Photo prints get a film grade. The scan screen is now a real camera view (a blurred table photograph) instead of a dark void.
2. **Template-looking grids.** Steps are now editorial columns: large italic numerals over an ink rule, no boxes. The four trust cards became a ruled list beside a sticky FAQ card.
3. **Hero lacked gift context, and the overlays read as smudges.** A flat wine satin ribbon now runs from under the card, behind the phone and off the page. The leaf-shadow overlay is removed and the window light softened.
4. **Tablet imbalance.** The letter tile no longer spans two rows, the partner sheet is capped at 26rem, and the demo phone is narrower.
5. **Recipients on mobile.** A new note ("Received a QR Starr card? Scan its code…") sits right under the actions on phones, so it is on the first screen at 390×844. On desktop the hero copy and the note align to the stage.

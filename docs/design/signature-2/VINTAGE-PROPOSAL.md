# Luxury Vintage Editorial: proposal (awaiting approval)

Status: **proposal only. Nothing below is implemented.** Branch `design/signature-experience-2`. Research done 2026-10-22. Every licence below was read from the source (the asset's own page or API record, or the library's LICENSE file) unless marked otherwise.

## 1. Audit: what exists

**Worlds (from `src/lib/templates/definitions/*.ts`):**

| World | Today | Recognisability today |
|---|---|---|
| Romantic | burgundy linen room, honeysuckle engraving (Wellcome, CC BY 4.0), leaf-shadow film, "With love" | good: the only world with a real vintage engraving |
| Birthday | flat cut-paper shapes (orange/yellow/teal), playful | modern, not vintage |
| Minimal | white card, a single dot | intentionally empty, no vintage character |
| Wedding | sage room, olive branch engraving (1874, PD), vellum | partly vintage |
| Celebration | night-sky film (Mixkit), gold rays | modern/cinematic |
| Elegant | noir/gold, rules | restrained, generic |

**Screens:** Screen #1 (photographed stationery, Unsplash), picker, create, media rows, preview, checkout slip, success note, sealed envelope, opening, beats, finale, closing, status screens. All of them use the Signature paper/wine system. The envelope and the wax seal are **custom CSS/SVG built earlier** (pre-dating this brief).

**What the brief changes:** each world needs period artwork, ornament and type of its own, and the vintage language must reach every screen, Screen #1 included.

## 2. Sourcing findings

### Approved-candidate sources (licence verified)

| Source | Licence (checked) | Notes |
|---|---|---|
| Cleveland Museum of Art Open Access (API) | **CC0**, stated per object (`share_license_status`) | Redouté roses, Lepère, lace, Cicéri, Winslow Homer valentine |
| Wikimedia Commons, PD/CC0 files only | Read per file from the API (`LicenseShortName`) | Owen Jones, Curtis's Botanical Magazine, Charles Martin, Mucha, printer's fleurons, Linotype border book |
| Biodiversity Heritage Library | Public domain items free for commercial reuse; attribution appreciated | botanical plates (fallback source) |
| ambientCG / Poly Haven | **CC0** (already used in the repo) | Paper 006 (aged beige), Paper 003 (creased) |
| Pexels / Unsplash | Free licences; "don't sell unaltered copies / cannot be sold without significant modification" | only as composited props/backgrounds, as today |
| Google Fonts (OFL, from `google/fonts` METADATA) | **OFL** | IM Fell English and IM Fell DW Pica (Igino Marini, from the 17th-c. Fell types), Pinyon Script, Cormorant Garamond, Playfair Display, EB Garamond (already self-hosted) |
| Phosphor Icons (installed) | MIT | has Seal, Stamp, Scroll, Envelope(Open), FlowerTulip, Feather, PenNib, Cake, Gift, Balloon, Confetti, Champagne, Crown, Diamond, Butterfly, StarFour |
| Tabler Icons | MIT | not needed (Phosphor covers it); fallback only |
| React Bits | **MIT + Commons Clause** (use in an app allowed; can't sell or redistribute the components themselves) | SplitText / FoldText (GSAP: already installed), BounceCards / StickerPeel / Folder (React + CSS only), Stack / CircularText (`motion`) |
| Magic UI | MIT ("Copyright (c) Magic UI") | Confetti (`canvas-confetti`, ISC), Blur Fade, Text Animate, Sparkles Text |
| Motion Primitives | MIT | Morphing Dialog, Spinning Text, Text Effect, Tilt (all on `motion`) |
| Motion (framer-motion) | MIT | the one new runtime library the above need |
| Uiverse Galaxy (GitHub) | MIT | searched all 727 cards: **no envelope component** |
| CodePen (public pens) | MIT by default (CodePen docs) | possible envelope source; would be adapted, needs approval |

### Rejected or blocked

| Source | Why |
|---|---|
| Freepik / Magnific | Free use requires attribution. Its terms forbid use in items "aimed to be resold, in which the content is the main element", and they **name greeting cards and apps**; "in case of doubt… deemed main element". Not suitable for a paid greeting product. |
| rawpixel | Licence page behind a bot wall (couldn't verify). Third-party reports conflict on attribution and monetisation. Its public-domain scans come from the same museums, so we use those originals instead. |
| Heritage Type | Paid licences. Graphic elements can't be used "to create new digital products". Needs a purchase decision, and isn't needed. |
| Transparent Textures | No licence stated on the site; each pattern has its own author. Not usable without per-author terms. |
| SVG Repo | Licence page behind a bot wall. Licences vary per item; the default SVG Repo License restricts redistribution/resale. Use only an item whose own page says CC0/MIT, recorded per file. Probably unnecessary. |
| Aceternity UI | Proprietary: end products allowed, but it forbids creating "themes, templates, or derivative products". The project's design arsenal already bans it from theme work. MIT equivalents exist for everything we'd use. **Owner decision if you want it anyway.** |
| CC BY-SA scans (e.g. a Verneuil pochoir scan) | Share-alike obligations; avoided. |

## 3. Proposed vintage identity per world

Shared brand layer: QR Starr wine wax seal, aged paper (ambientCG Paper 006), a postmark ring of circular text "QR STARR · თბილისი · {world}" (React Bits CircularText or Motion Primitives Spinning Text, static under reduced motion), and Phosphor icons.

| World | Direction | Artwork (source · licence) | Ornament / frame | Type (Latin · Georgian) | Motion component |
|---|---|---|---|---|---|
| **Romantic** | antique love letter | P.-J. Redouté, *Les Roses* plate (1817–24), Cleveland MA · **CC0**; honeysuckle engraving (existing, CC BY 4.0) | antique lace edge from CMA "Lace Towel End" · **CC0**; Linotype "Benedictine" border · PD | IM Fell English + Pinyon Script sign-off · Noto Serif Georgian | React Bits **SplitText** (GSAP): letter lines "inked" in; Motion Primitives **Morphing Dialog** for photo keepsakes |
| **Birthday** | Victorian greeting card | E. B. Comins greeting-card illustrations (1861–97), Boston Public Library · PD | Linotype "Louis XV" gold border · PD; ribbon banner from the same book | Playfair Display + IM Fell · Noto Serif Georgian | Magic UI **Confetti** (gold-paper shapes) at the finale only; React Bits **BounceCards** photo fan |
| **Minimal** | letterpress & printer's flowers | printer's fleurons / Aldus leaf, Commons "Fleurons" category · PD | Linotype "Bodoni dashes" rule · PD | IM Fell DW Pica · Noto Serif Georgian | Magic UI **Blur Fade** only (restraint is the identity) |
| **Wedding** | engraved invitation | *Curtis's Botanical Magazine* plate 3089 (1831), orange blossom · PD; olive branch (existing, PD) | CMA lace as doily border · CC0; Linotype "Caslon" border · PD | Cormorant Garamond + Pinyon Script · Noto Serif Georgian | Motion Primitives **Text Effect**; React Bits **Stack** (photo prints you can leaf through) |
| **Celebration** | Belle Époque fireworks poster | Charles Martin, *Feu d'artifice* pochoir (1914) · PD; A.-L. Lepère, *Festival of 14 July* (1880), Cleveland MA · CC0 | gold stars and rays from the Martin plate; Owen Jones gold border · PD | Playfair Display · Noto Serif Georgian | Magic UI **Confetti** (gold) + React Bits **ClickSpark** on taps |
| **Elegant** | Art Nouveau gold | Alphonse Mucha, decorative panels (borders and floral headers only, no figures) · PD | Owen Jones *Grammar of Ornament* (1868) gold frieze · PD | Cormorant Garamond SC · Noto Serif Georgian | Motion Primitives **Spinning Text** postmark; **Tilt** on the card (pointer only, off on touch/reduced motion) |

## 4. Across the journey

| Screen | Proposal |
|---|---|
| Screen #1 (now in scope) | Keep the photographed stationery. Add a Redouté botanical, a postmark ring and a Linotype rule; the headline set in IM Fell; and "what can go inside" as four postage stamps (Phosphor icons inside a perforated stamp frame). Behaviour and routing unchanged. |
| Picker | Each world as a **collectible postcard** with its artwork as the stamp. The hero shows the postcard front with the world's frame. |
| Create | Letter on aged paper with the world's corner ornament. Memories in a **keepsake folder** (React Bits Folder), each photo a print, the voice note a labelled reel. |
| Media | Upload rows as mounted prints / film / reel with stamp-style status marks (ready ✓, failed). |
| Preview / checkout | The sealed envelope with a postmark; the order slip as a period receipt with a printed rule and a "PAID" handstamp after payment (shown only on the real paid state). |
| Success | Wax seal + postmark dated today. |
| Sealed / opening / closing | The world's artwork on the envelope's sheet. In the closing, keepsakes as prints in a Stack and the letter with ink-in, then the seal. |
| Errors / unavailable | Postal motifs: "return to sender" (not found), "held at the post office" (draft in progress). Copy stays plain and helpful. |

## 5. Gaps needing your approval (I have not built anything for these)

1. **Envelope and wax seal.** No licensed third-party envelope component exists in React Bits, Magic UI, Motion Primitives, the free Aceternity list, or Uiverse (727 cards checked). Options: **(a)** keep the existing custom envelope/seal (built and approved before this brief; recommended), **(b)** adapt an MIT CodePen envelope, **(c)** a photographed wax seal (CC0/Unsplash) cut out as a raster.
2. **Georgian vintage typeface.** Google Fonts has only Noto Serif/Sans Georgian and Google Sans. The one candidate, **BPG Glaho**, has an inconsistent licence (GPL + font exception per CentOS; "non-free" per openSUSE). Options: confirm with BPG, or stay on Noto Serif Georgian with ornamental initials and rules.
3. **New dependencies.** `motion` (MIT; lazy-loaded on the screens that use it, ~30–35 KB gz full / ~5 KB with LazyMotion where the component allows), `canvas-confetti` (ISC, ~6 KB gz, Birthday and Celebration finales only) and `@gsap/react` (GSAP no-charge licence, tiny). Approve or veto each.
4. **Aceternity**: confirm it stays excluded.
5. **Scope of "no custom decoration".** Perforation edges, deckled paper and paper shadows are CSS styling of licensed assets, not new illustrations. Confirm this is acceptable.

## 6. Performance plan

- Each world's art is an AVIF (≤ 60 KB, ~1200 px), loaded only for that world and preloaded only where it paints first.
- Borders are cleaned scans traced to small SVG or `border-image` strips (≤ 10 KB).
- Fonts are subset Latin woff2 per world (~20–30 KB each), loaded with the world.
- `motion` and `canvas-confetti` are code-split and never on the sealed screen's critical path.
- Everything respects `prefers-reduced-motion` (confetti off, ink-in off, tilt off).
- Budget: recipient sealed screen ≤ +40 KB over today; the 2.0 numbers (554 KB JS, LCP ≈ 110 ms) are the baseline to beat.

## 7. After approval

Integrate per world, add each asset to `public/customer/LICENSES.md` and a component register (`World/Screen | Component or Asset | Source URL | Licence | Integration method`, marking *integrated as-is* vs *adapted*), capture every world at 320–1440, run typecheck, lint, build and e2e, then produce the before/after review. No push, merge or deploy.

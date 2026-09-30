# QR Starr — Customer Design Resources

Research and planning for the customer experience (sender flow, recipient flow,
greeting themes, customer-facing payment and success states). **Planning only:**
nothing here has been installed, downloaded or applied yet, except where it says
"already in the repo".

Scope excludes Admin, Partner and internal screens. Business logic, routes,
payments, pricing, auth, the QR lifecycle and the localisation architecture are
out of scope.

Evidence produced for this document:
`docs/design/research/typography-specimen/` holds a specimen page set in real
`ka.json`/`en.json` strings, plus renders at desktop and 390px. Every Georgian
line's actual rendering font was read back from Chromium via the DevTools
protocol (`CSS.getPlatformFontsForNode`). Nothing was guessed from Latin samples.

---

## 1. Current visual-resource inventory (what exists today)

| Area | What exists | Where |
|---|---|---|
| Fonts | Google Sans (UI, Latin + Latin-ext + Georgian subsets), Newsreader (EN display, roman + italic), Noto Serif Georgian (KA display). Self-hosted WOFF2, split by `unicode-range`, **292 KB total**, OFL licence files included. | `public/fonts/`, `@font-face` in `src/app/globals.css` |
| Type tokens | `text-display`, `text-h1`, `text-body`, `text-label`, `text-caption`, `text-eyebrow`, with dedicated `:lang(ka)` sizes and line-heights for Georgian | `globals.css` |
| Brand mark | Starr spark: custom single-path SVG (`SPARK_PATH`), plus the `Logo` component | `src/components/ui/logo.tsx` |
| Icons | Customer UI: **Phosphor** (`@phosphor-icons/react` 2.1.10) via a semantic vocabulary. Admin/Partner: Lucide. | `src/components/customer/icons.ts` |
| Customer design-language seed | `cx-*` tokens: wine palette, paper, radii, depth, motion timing, film grain (inline SVG), atmosphere, primary action, capability marks, entry hero | `globals.css` ("Customer design language" section), `src/components/customer/` |
| Illustration | **All CSS/SVG, no raster art.** Entry hero (layered envelope, card, wax seal), `ThemeSwatch` (card-and-envelope miniature), recipient `Envelope`, `paper-card`, particle layer (petals / confetti / stars / sparkles) | `components/customer/entry-hero.tsx`, `components/greeting/{theme-swatch,envelope,particles}.tsx` |
| Greeting themes | 6 themes: romantic, birthday, wedding, celebration, elegant, minimal. **Each theme is a palette plus a particle type on one shared layout and one shared typography**, i.e. largely recolours. | `src/lib/themes/registry.ts` |
| Motion | CSS keyframes only (`rise`, `fade`, `pop`, `card-arrive`, `cx-*` entrance). A global `prefers-reduced-motion` rule collapses them. No Lottie or motion library. | `globals.css` |
| Raster/media assets | None besides the Next.js template leftovers (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`), which are unused by the UI | `public/` |

**Takeaway:** the foundations (tokens, fonts, icons, motion rules) are solid and
lightweight. The gaps are **material quality** (realistic paper, envelope and wax
are CSS approximations) and **theme variety** (themes differ in colour, not in
typography, composition or artwork).

---

## 2. Icon strategy (decided — unchanged)

- **Library:** Phosphor Icons for all customer UI, one family, imported per icon (`dist/csr/*`) through `components/customer/icons.ts`, which maps meanings to glyphs (Text → PenNib, Photo → Image, Price → Tag, Continue → ArrowRight, …).
- **Weights:** `regular` by default; `bold` only for tiny icons on dark fills (e.g. the CTA arrow); `fill`/`duotone` only for meaningful states (a playing voice note, a completed step).
- **Separation:** Lucide stays in Admin/Partner, and the two never mix on one screen.
- **Brand mark:** the Starr spark remains custom.
- **Technical note, not a problem:** per-icon Phosphor modules use React context, so the vocabulary file is a client module. Server components can still render the icons with plain props. No change recommended.

---

## 3. Typography candidates

### What the catalogues actually offer for Georgian

- **Google Fonts:** of 1,946 families, **only 3 ship a Georgian subset**: Google Sans, Noto Sans Georgian and Noto Serif Georgian. Source: `fonts.google.com/metadata/fonts`, queried 2026-09-29.
- **Fontshare:** of its full catalogue (100 families; ITF FFL or OFL), **0 support Georgian**. Source: `api.fontshare.com/v2/fonts`.
- **Outside those catalogues, openly licensed:** FiraGO (bBox Type, OFL). BPG families (GPL with a font exception or a Bitstream Vera-style licence, varying per font). TBC Contractica (OFL is claimed by third-party mirrors, but no official source has been verified).

So "a beautiful Georgian display font" is the scarce resource. Every Latin
display font below needs a Georgian partner.

### Shortlist

| Candidate | Georgian | English | Intended role | Strengths | Weaknesses | Licence / source |
|---|---|---|---|---|---|---|
| **Google Sans** *(current)* | ✅ native (verified) | ✅ | **UI / functional** | Warm and rounded; its Georgian is drawn in the same voice as the Latin, so bilingual UI feels like one family; wght 400–700 plus opsz/GRAD axes; already self-hosted and subset (Georgian file 18 KB) | Slightly generic next to the display type; no italic Georgian (none exists for Mkhedruli anyway) | OFL · Google Fonts |
| **Noto Sans Georgian** | ✅ native | ✅ (Noto Sans) | UI fallback | Very complete; wght 100–900 plus width axis | Wider and more utilitarian; reads "system", not premium | OFL · Google Fonts |
| **FiraGO** | ✅ native (Georgian by Akaki Razmadze) | ✅ (Fira) | UI alternative | Excellent Georgian drawing; many weights | Technical/humanist tone (feels "product UI"); web files are about **250 KB per weight** (all scripts), so it would need subsetting | OFL · github.com/bBoxType/FiraGO |
| **Noto Serif Georgian** *(current KA display)* | ✅ native | ✅ (Noto Serif) | **Display / emotional (KA)** | The only well-made OFL Georgian serif; wght 100–900 (300 looks notably more editorial than 400); pairs cleanly with Newsreader and Fraunces | Its Latin is weaker than Newsreader, so keep it for the Georgian glyphs only; no expressive or script cut | OFL · Google Fonts |
| **Newsreader** *(current EN display)* | ❌ (pairs with Noto Serif Georgian) | ✅ | **Display / emotional (EN)** | Best pairing in the specimen (similar colour and rhythm to Noto Serif Georgian); opsz axis; has an italic | Literary rather than celebratory | OFL · Google Fonts |
| **Fraunces** | ❌ (pairs with Noto Serif Georgian) | ✅ | Alternative EN display; theme typography (warm/celebratory themes) | Soft, warm and characterful ("wonk" and soft axes); pairs well at weight 300 | Very characterful, so best reserved for themes rather than all headings | OFL · Google Fonts |
| Instrument Serif | ❌ | ✅ | ~~display~~ | Fashionable, elegant | **Rejected for shared use:** too condensed; the EN line runs visibly narrower than the KA, so bilingual layouts look inconsistent | OFL · Google Fonts |
| Cormorant Garamond | ❌ | ✅ | Possible EN-only theme accent (Wedding/Elegant) | Refined high contrast | **Rejected for shared use:** tiny x-height clashes with the Georgian partner | OFL · Google Fonts |
| Gambetta / Zodiak | ❌ | ✅ | ~~display~~ | Good quality | Adds a second licence family (ITF FFL) for no gain over Newsreader/Fraunces | ITF FFL · Fontshare |
| Pinyon Script (and scripts generally) | ❌, no Georgian partner of similar style exists openly | ✅ | ~~theme script~~ | Romantic | **Rejected:** a script EN heading next to a serif KA heading makes the same theme feel different by language; no openly licensed Georgian calligraphic face was found | OFL · Google Fonts |
| TBC Contractica | claimed | ✅ | — | Designed for Georgian readability | **Licence unverified:** only third-party mirrors found; do not use until an official OFL source is confirmed | unknown |
| BPG families | ✅ | varies | — | Historic Georgian coverage | Older designs; GPL-family licences that vary per font. Not recommended. | GPL / Vera-style |

### Recommended typography hierarchy

- **UI / functional:** Google Sans for KA and EN (unchanged).
- **Display / emotional:** Newsreader (EN) with **Noto Serif Georgian (KA)**. Consider Noto Serif Georgian at weight **300** for large display sizes, since it's more editorial at 30px and above.
- **Theme typography (optional, later):** **Fraunces** (EN) with Noto Serif Georgian (KA) for warm or celebratory themes. No other families without a new review.
- **Rule:** any theme heading font must render Georgian natively or have an explicit Georgian partner. Verify with the specimen method in `docs/design/research/typography-specimen/`.

That keeps QR Starr at **three families today (four with Fraunces)**, all OFL and self-hostable.

---

## 4. Georgian typography evaluation (method and findings)

- **Strings:** real ones from `ka.json`: `sender.entry.title` "აალაპარაკეთ ეს საჩუქარი", `sender.entry.subtitle`, `sender.entry.cta`, the facts line, and `themes.romantic.opening` "ეს სპეციალურად შენთვის შეიქმნა".
- **Sizes:** each candidate was rendered at display (34px), body (16px), button (17px), caption (13px) and card (22px), at desktop width and at 390px.
- **Verification:** the font that actually rendered each Georgian line was read from Chromium. Google Sans, Noto Sans Georgian, FiraGO and Noto Serif Georgian each rendered all 23 Georgian glyphs natively. Every Latin-only display font would otherwise fall back to a system font, which is why each needs the explicit Noto Serif Georgian partner (as the current `--font-serif` stack already does).
- **Practical rules for KA:**
  - line-height ≥ 1.12 for display and ≥ 1.5 for body. Mkhedruli has tall ascenders/descenders and no capitals, so the tight EN tracking must not carry over.
  - no uppercase transforms or wide tracking on Georgian (already enforced by the `:lang(ka) .text-eyebrow` rule).
  - Georgian strings run 30–50% longer than English, so layouts must wrap rather than truncate.

---

## 5. Visual asset sources (identified, **nothing downloaded**)

| Source | What for | Notes |
|---|---|---|
| **Magnific** (formerly Freepik, rebranded 2026-04-28) | Premium envelope/stationery illustrations, wax seal vectors, paper textures, ribbon, botanical accents, 3D gift objects | Largest single catalogue. **Premium subscription recommended** (no attribution; the free tier requires attribution). **Beware PSD "mockups":** mockup licences are for showcasing a design and may not cover use as product artwork. Prefer vectors, illustrations or 3D renders. |
| **Unsplash** | Macro paper/fabric/material photography for textures; editorial mood imagery | Free commercial use, no attribution. Avoid Unsplash+ items unless licensed. |
| **Haikei** | Simple generated SVG decoration (only if genuinely needed) | Free, no account, commercial use allowed. **Use sparingly:** its blobs, waves and meshes are exactly the "generic SaaS" look QR Starr should avoid. |
| **Own SVG / CSS** | Grain (feTurbulence, already in use), light and shadow, gradients, geometry, spark motifs | Zero licence risk, tiny size. |
| **Commissioned custom art** (recommended for signature pieces) | The QR Starr wax seal with the spark emboss; signature envelope/card composition; theme artwork sets | Only way to get brand-owned, non-stock signature assets. |
| Envato Elements / Adobe Stock / Creative Market | Alternatives to Magnific | Licence terms **not verified in this session**; review per item before use. |

---

## 6. Greeting-theme resource strategy

**Problem today:** six themes, one layout, one type system, differing only in
palette and particle, so they read as recolours.

**Proposal:** a theme is a *kit*, not a colour:

| Layer | Varies per theme | Constant across all themes (QR Starr DNA) |
|---|---|---|
| Composition | Card framing (deckle / gilt edge / photo corner / minimal rule), how the card sits (tilted, flat, layered) | The *card* as the object; the envelope → card reveal structure |
| Artwork | 1–2 raster/vector artwork layers per theme (e.g. Romantic: soft rose watercolour wash; Birthday: paper confetti cut-outs; Wedding: ivory linen + fine botanical line; Corporate: embossed geometric; Thank You: pressed-paper stamp) | Restraint: artwork frames the words, never covers them |
| Typography | Heading voice: Newsreader / Fraunces with Noto Serif Georgian, weight/size/italic per theme | Google Sans for all UI; KA always native |
| Colour | Full palette per theme (not forced to wine) | Starr spark and seal as the signature; cream/paper tone somewhere in every theme |
| Motion | Reveal accent (petal drift / confetti burst once / light sweep / ink bloom) | The same 6-beat reveal choreography and timing tokens; reduced-motion respected |
| Texture | Paper stock (cotton, linen, laid, kraft) | Tactile paper always present |

**Suggested taxonomy to design toward** (research list, not the product catalogue):
- Romantic, Birthday, Celebration, Elegant, Minimal, Wedding (existing)
- Anniversary, Thank You, Friendship, Family, Corporate, Seasonal (new)
- Flowers appear only as the contextual artwork of some themes, never as brand identity.

**Guardrail against chaos:** every theme kit uses the same token slots (palette,
paper, artwork layers, heading voice, reveal accent), so themes vary inside one
system.

---

## 7. Motion resource strategy

- **CSS/native first:** hover, press, fade, slide, scale, card movement, envelope opening, the entrance sequence. Already the house style, and it collapses under `prefers-reduced-motion`.
- **Lottie only where it clearly beats CSS.** Candidates:
  - (1) the payment/activation success moment
  - (2) a once-only celebratory accent on Birthday/Celebration reveals
  - (3) possibly a paper-confetti burst
  - Envelope opening, theme selection, preview transition and replay should stay CSS: they're compositional, and CSS keeps them crisp and theme-aware.
- **Runtime cost, if adopted:**
  - `lottie-web` light build (MIT): **~46 KB gzipped** (168 KB raw); the full build is ~76 KB gzipped.
  - `@lottiefiles/dotlottie-web` (MIT): uses a WASM renderer and is much heavier.
  - Recommendation: `lottie-web` light, **lazy-loaded only on the success/reveal screens**, never on the first-scan entry screen.
- **Sources:** LottieFiles (Lottie Simple License: free commercial use, no attribution, no reselling or redistributing the files), or commissioned animations.
- **Never:** looping backgrounds, bouncing UI, long blocking sequences, confetti on every screen.

---

## 8. Background / texture strategy

- **Page atmosphere:** CSS radial light plus the inline SVG grain (already built, ~0 KB).
- **Paper stock textures:** one small **seamless WebP tile per paper type** (256–512 px, ~15–40 KB), used as `background-image` on cards. Sources: Unsplash macro paper photos (free) or Magnific (Premium).
- **Theme artwork:** WebP/AVIF, responsive `srcset` (roughly 640/1080/1600 widths), lazy-loaded below the fold, with dimensions reserved to avoid CLS.
- **Avoid:** blob scenes, gradient meshes, generic waves, stock "startup" illustrations.

---

## 9. Licensing matrix

| Resource | Licence | Commercial use | Attribution | Account | Cost | Redistribution |
|---|---|---|---|---|---|---|
| Google Sans, Noto Sans/Serif Georgian, Newsreader, Fraunces | SIL OFL 1.1 | ✅ | Not required (keep the OFL text with self-hosted files, as today) | No | Free | Allowed with the licence; can't sell the fonts alone |
| FiraGO | SIL OFL 1.1 | ✅ | Not required | No | Free | As OFL |
| Fontshare families | ITF FFL / OFL | ✅ (web, apps, self-host allowed) | Not required | No | Free | No selling or redistributing derivative fonts |
| Phosphor Icons | MIT | ✅ | Not required | No | Free | ✅ |
| Magnific (Freepik) | Magnific licence | ✅ | **Required on the free tier**; not required on Premium/Pro | Yes | Free tier or subscription | ❌ no resale, sublicensing or stock-library inclusion; ❌ no trademark/logo use; physical-merch limits |
| Unsplash | Unsplash License | ✅ | Not required | Optional | Free | ❌ can't sell unaltered or build a competing library |
| LottieFiles (free animations) | Lottie Simple License | ✅ | Not required | Account to download | Free | ❌ no standalone redistribution or resale |
| Haikei | Haikei terms | ✅ personal and commercial | Not required | No | Free (Pro plan exists) | ❌ can't build a competing generator |
| lottie-web (runtime) | MIT | ✅ | — | — | Free | ✅ |
| TBC Contractica | **unverified** | ? | ? | ? | ? | **Do not use until verified** |
| BPG fonts | GPL / Vera-style, per font | varies | varies | No | Free | varies. Not recommended. |

---

## 10. Performance rules

- **First-scan budget (entry screen):** no raster hero over ~60 KB, no Lottie runtime, fonts limited to the current subset files (KA ≈ 18 KB UI + 65 KB display, EN ≈ 36 KB + 58 KB). The LCP element should be text or a CSS/SVG composition.
- **SVG:** icons, brand, geometry, simple decoration.
- **WebP/AVIF:** complex art and textures, with `srcset`, explicit width/height, and `loading="lazy"` off-screen.
- **Preloading:** only the one font file the LCP headline needs, per locale.
- **Animation:** transform/opacity only; no animated `filter`/`box-shadow` loops; at most one ambient idle animation per screen, and it must be imperceptible.
- **Lottie:** lazy-loaded; light build; one animation per moment; ≤ ~100 KB JSON.
- **New fonts:** subset to Latin + Georgian (FiraGO in particular); `font-display: swap`; keep a `unicode-range` split so EN users never download Georgian glyphs.

---

## 11. Accessibility rules

- **Decorative art:** `aria-hidden` / `alt=""`; any meaning lives in real text (as the entry hero already does).
- **Contrast:** ≥ 4.5:1 for body text and ≥ 3:1 for large display text, including text on theme artwork (add a scrim if needed).
- **Motion:** every animation respects `prefers-reduced-motion`; no information is conveyed only by motion.
- **Interaction:** visible focus on every interactive element; touch targets ≥ 44px; semantic structure (one `h1`, lists for lists, real buttons).
- **Georgian:** set `lang="ka"` correctly (already via `<html lang>`) so screen readers and `:lang(ka)` typography rules apply.

---

## 12. Proposed asset-directory structure (not created yet)

```
public/customer/
  brand/          wax-seal, spark variants (SVG), signature envelope/card layers
  textures/       paper-cotton.webp, paper-linen.webp, paper-kraft.webp (tiles)
  illustrations/  shared customer art (e.g. entry hero layers if moved to raster/SVG)
  decoration/     restrained SVG accents (rules, corners, botanical line art)
  motion/         *.json Lottie files (success, celebration accents)
  themes/
    romantic/     artwork@{640,1080,1600}.webp, paper.webp, theme.json (credits)
    birthday/
    …
LICENSES.md       one row per external asset: source URL, licence, date, attribution
```

- Fonts stay in `public/fonts/`.
- Each asset folder records its source and licence in `LICENSES.md` at the time it's added.

---

## 13. Reference-image workflow

When you supply an approved screenshot or mockup, it's art direction for
hierarchy, composition, proportions, density, depth, material, lighting, tone
and polish.

**Never copied:**
- generated text (KA or EN)
- prices
- features the product doesn't have
- generated logos
- AI artefacts
- irrelevant decoration

**Always from the product:**
- text comes from `ka.json`/`en.json`
- prices come from the pricing logic
- features come from what the product actually does

Each implemented screen is compared side by side with the reference at
320/390/430 and desktop, in KA and EN.

---

## 14. QR Starr visual DNA

- **Is:** premium, emotional, tactile, editorial, warm, modern, slightly cinematic, memorable, gift-oriented.
- **Is not:** generic SaaS, childish, overly feminine, flower-shop, template-like, AI-generated, noisy.
- **Recurring motifs, used with restraint:** the card, the envelope, the Starr spark, the wax seal, paper, subtle ribbon, light and shadow.
- **App shell:** warm cream/paper with deep wine. **Themes** are free to leave that palette but keep the paper, spark and card motifs.

---

## 15. Missing resource categories

1. **Premium material assets:** a realistic-but-restrained envelope/card/wax set (today's CSS versions are good approximations but not "materially real").
2. **Paper texture tiles:** cotton / linen / laid / kraft.
3. **Per-theme artwork kits:** there are none; themes are recolours.
4. **Theme typography:** none yet (Fraunces proposed).
5. **Expressive Georgian display type:** no openly licensed option found beyond Noto Serif Georgian. A distinctive Georgian display face would require a paid licence or a commission; separate research needed if wanted.
6. **Celebration motion assets:** success/activation, once-only celebration accents.
7. **Asset licence register:** `LICENSES.md`.
8. **Branded wax seal art:** the spark emboss as a real asset.

---

## 16. Recommended resource stack

| Layer | Recommendation | Cost |
|---|---|---|
| Icons | Phosphor (done) | Free |
| UI type | Google Sans (done) | Free |
| Display type | Newsreader (EN) with Noto Serif Georgian (KA), weight 300 for large display | Free |
| Theme type | Add Fraunces (EN) with Noto Serif Georgian (KA) when themes are redesigned | Free |
| Textures | Own SVG grain (done) plus 3–4 WebP paper tiles from Unsplash (free) or Magnific | Free / subscription |
| Signature art | Commission: QR Starr wax seal and signature envelope/card layers (SVG or layered WebP) | Paid (one-off) |
| Theme artwork | Magnific Premium vectors/illustrations as the base, curated and art-directed per theme kit | Subscription |
| Motion | CSS for everything structural; `lottie-web` light (lazy) plus LottieFiles or commissioned JSON for success and celebration only | Free (+ optional commission) |
| Decoration | Own SVG; Haikei only if a specific need appears | Free |

---

## 17. `docs 2/` finding

- **What it is:** a byte-for-byte copy of `qr-starr-screen-1-review.zip`, meaning the same 20 PNGs under `visual-walkthrough/entry-redesign-v2/`. It's what macOS produces when that ZIP is unzipped in the project root (it names the folder `docs 2` because `docs/` already exists). Created 2026-09-29 21:32.
- **Overlap with `docs/`:** 5 files are identical to the current ones; 15 differ because those screenshots were re-captured after the Phosphor icon swap. So `docs 2/` is the **pre-Phosphor snapshot** of Screen #1.
- **References:** nothing in the code, tests, scripts, CI or docs refers to it.
- **Status:** left untouched, as instructed. It's untracked; it can be deleted, or moved out of the repo, whenever you choose.

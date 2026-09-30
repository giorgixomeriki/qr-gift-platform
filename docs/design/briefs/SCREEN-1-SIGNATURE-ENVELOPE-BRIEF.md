# Asset brief — QR Starr signature envelope set

**For:** an illustrator or 3D/vector designer (preferred), or as selection
criteria for a stock licence (Magnific, the stock site formerly called Freepik)

**Owner:** QR Starr · **Status:** draft for approval · **Date:** 2026-09-29

**Attachments** (in `docs/design/briefs/attachments/`):
- `starr-spark.svg`: the exact brand mark, which **must** be used for the seal emboss
- `current-css-hero-mobile-ka.webp`, `current-css-hero-desktop-en.webp`: the current CSS-drawn version, for structure only (not style)
- `current-entrance-sequence.webp`: how the layers animate today

---

## 1. What we need, and why

A **layered illustration of an open envelope with a greeting card half drawn
out of it, sealed with a wax seal bearing the QR Starr spark.**

It's the first thing a customer sees after scanning the QR card on a physical
gift. It must say *"something personal is waiting to be written"*, and it must
feel **tactile and special** within one second, on a phone.

Today this object is drawn in CSS. It reads correctly, but it doesn't feel like
real paper and wax. This asset replaces it.

## 2. Where it will be used

| Use | Size on screen | Notes |
|---|---|---|
| **Screen #1: available-card entry hero** (first) | ~70% of a 320–430 px phone width; ~420–560 px on desktop | Sits on a dark wine "stage" panel drawn by us in CSS; the asset itself is transparent |
| Recipient reveal: the envelope the recipient opens (later) | full-width on phones | Needs the same layers so the card can be drawn out |
| Theme picker thumbnails (later) | 80–160 px | Needs to stay legible very small |

## 3. Composition

- **Envelope:** open, facing the viewer, tilted about **−2°**. The **flap stands open behind the card** and shows its lining.
- **Card:** portrait card, tilted about **+3°** relative to the envelope, drawn out so that about **55%** of its height shows above the envelope's front pocket. The front pocket covers the lower part.
- **Wax seal:** sits where the pocket's diagonal folds meet (the V point), slightly overlapping the card edge area. It's embossed with the **Starr spark** (attached SVG), exact geometry, no redrawing.
- **Shadow:** soft contact shadow under the envelope. Light comes from the **upper left**, soft, diffuse and warm.
- **Proportions:** the envelope is about **5:3** (w:h). With the flap and card, the whole object fits roughly a **4:3** box.
- **Surface:** the card face is **blank**. We set its words live in HTML in Georgian or English, so no text, fake writing or lines should appear on the card beyond an optional faint inner border (deckle).

Rough layout (object within a 1600 × 1200 artboard):

```
            ╱╲  flap (open, lined)     ← behind card
        ┌──────────┐
        │   card   │                    ← blank face, safe area for live text
   ┌────┤          ├────┐
   │ ╲  │          │  ╱ │               ← front pocket with V fold
   │   ╲└──────────┘╱   │
   │      ◉ wax seal    │               ← Starr spark emboss
   └────────────────────┘
      ~~ soft shadow ~~
```

## 4. Art direction

**Feel:** premium stationery, soft studio light, tactile paper with a fine
tooth, restrained, editorial, warm. Somewhere between a fine-paper product
photograph and a refined illustration.

**Do:**
- Matte cotton or laid paper with subtle fibre texture.
- Crisp, clean fold edges, with a hint of paper thickness on the edges.
- A soft, believable wax seal: slight irregular edge and a gentle highlight. The emboss must be readable, with the spark crisp even at a 36 px seal size.
- A lining pattern that's calm: fine diagonal pinstripe or a very subtle paper pattern.
- Keep detail meaningful at 320 px wide.

**Don't:**
- Photoreal glossy 3D, hard reflections, plastic look, or heavy depth-of-field blur.
- Cartoon or flat-clip-art style, outlines, or kawaii touches.
- Flowers, hearts, confetti, ribbons or glitter. The object must work for **every** occasion: birthday, romance, wedding, thank-you, corporate. Theme decoration is added separately.
- Any text, logos (other than the spark), stamps or postmarks.
- Background scenery. The asset is transparent; we provide the stage.

## 5. Colour (starting palette — the current QR Starr tokens)

| Part | Colour |
|---|---|
| Envelope paper | `#E8D6CA` → `#EFE1D6` (warm cream-rose); fold shading `#DCC4B6` |
| Envelope front pocket | `#F5EBE2` highlights, `#EAD9CC` side panels |
| Card paper | `#FFFDF9` → `#FBF6EF`, edge line `#E8D9CB` |
| Flap lining | blush `#F3CCCD` → `#E0A3AE`, pinstripe in wine `#7A3244` at ~15% |
| Wax seal | `#B04A63` highlight → `#7A3244` → `#4A1827` shadow; emboss highlight `#F9E3DC` |
| Stage it sits on (ours, not in the asset) | radial wine `#94435A` / `#7A3244` / `#4A1827` / `#220B13` |

**Theming (important for later):** keep the **lining** and **seal** as separate
layers, and if vector, use **flat fills or simple gradients we can recolour**.
Different greeting themes will change the lining and seal colours (e.g. ivory
and gold for Wedding, ink blue for Corporate) without redrawing.

## 6. Layers (deliverable structure)

All layers share **one artboard (1600 × 1200 px at 1×)** and must stack in this
order with pixel-perfect alignment.

| # | Layer | Why separate |
|---|---|---|
| 01 | `shadow` (soft contact shadow) | fades in separately |
| 02 | `flap-and-lining` (open flap incl. lining) | recolourable lining; sits behind the card |
| 03 | `envelope-back` (inside back panel) | behind the card |
| 04 | `card`: **drawn complete, full height** (including the part normally hidden in the pocket) | the card **slides up out of the pocket** in the entrance animation |
| 05 | `envelope-front-pocket` (front with V fold) | covers the card's lower part while it slides |
| 06 | `wax-seal` (with spark emboss) | scales in last; recolourable |
| 07 | *(optional)* `paper-grain` tile, 512 × 512 seamless | subtle texture overlay we can reuse on the card |

The entrance animation we'll run (for reference, not a deliverable):
1. the envelope rises into place
2. the **card is drawn up** out of the pocket (~35% of its height)
3. the seal settles
4. the card's words fade in

See `current-entrance-sequence.webp`.

## 7. Card safe area

On the card face, keep a **clear area of at least 70% of the card width ×
45% of the card height**, in the visible part above the pocket. That's where our live
text goes: up to two lines of Georgian, about 34 characters, at roughly 15 px
on a 390 px phone.

No texture should be so strong that small text on it loses contrast. Wine text
`#5A2A37` on the card must stay at least 4.5:1.

## 8. Formats and file-size budget

This is the **first thing loaded after a QR scan**, so size matters.

- **Strongly preferred: vector (SVG) per layer.**
  - Flat fills and simple gradients; blur only for the shadow.
  - No embedded raster; no complex filters.
  - Target: **≤ 30 KB total gzipped** for all layers.
  - Paper tooth can come from our shared grain texture instead.
- **If the style needs raster (painted or 3D-rendered):**
  - transparent PNG masters at **2× (3200 × 2400)**; we convert to AVIF/WebP at 640 / 1080 / 1600 widths
  - the combined layers at 1080 px must fit **≤ 90 KB (AVIF)**
  - the vector option is still preferred for the first screen
- **Source files:** the layered master (Figma, Illustrator, Affinity, or PSD; Blender scene if 3D), with named layers matching the table above.
- **Colour space:** sRGB.

## 9. Variants

1. **Master:** QR Starr wine and blush (as above).
2. **Neutral lining:** plain ivory lining with a fine grey pinstripe (proves the lining swaps cleanly).
3. **Small-size check:** the full object exported at 160 px wide, to confirm it still reads in theme thumbnails.

## 10. Accessibility and implementation notes (for the designer's awareness)

- The illustration is **decorative**; its meaning is carried by the page's real text, so it will be hidden from screen readers.
- Motion is added by us and disabled for users who prefer reduced motion. The static composition must look complete on its own.

## 11. Rights and licensing

**For a commissioned designer (preferred):**
- **Rights:** full transfer of copyright, or an exclusive, perpetual, worldwide, irrevocable licence for commercial use.
- **Scope of use:** the web and mobile app, marketing, printed materials, and modification or derivative works (theme variants).
- **Source files:** included.
- **Third-party elements:** no stock elements unless the designer discloses them and they're licensed for this use.
- **AI-generated content:** none, unless disclosed, with the rights confirmed.
- **Credit:** optional (by agreement).

**For the Magnific stock route (interim or fallback):**
- **Search phrases:**
  - "open envelope with card vector"
  - "wax seal envelope illustration"
  - "blank greeting card envelope vector"
  - "stationery envelope wax seal"
- **Filters:** Vectors or Illustrations; *exclude* PSD **mockups** (mockup licences cover showcasing a design, which may not include use as product artwork); exclude AI-generated if the licence treats it differently.
- **Licence:** a **Premium** subscription at the time of download (no attribution required; the free tier requires attribution).
- **Record keeping:** the asset URL, licence or download record and date go into `public/customer/LICENSES.md`.
- **Limitations:**
  - stock isn't brand-exclusive; others may use the same envelope
  - the seal must still be modified to carry our spark (the licence allows modification)
  - the asset can't be used as a logo or trademark

## 12. Acceptance criteria

- [ ] Layers align exactly when stacked; the card slides out of the pocket with no visible seams or gaps.
- [ ] Looks tactile and premium on the dark wine stage at **320, 390, 430 px** and on desktop.
- [ ] Georgian and English card text both fit inside the safe area and stay readable (≥ 4.5:1).
- [ ] The spark on the seal matches `starr-spark.svg` exactly and stays crisp at a 36 px seal.
- [ ] The lining and seal recolour cleanly (neutral variant supplied).
- [ ] Within the size budget (SVG ≤ 30 KB gz total, or raster ≤ 90 KB AVIF at 1080 px).
- [ ] Contains no text, flowers, confetti, hearts or background scenery.
- [ ] Rights documentation received (transfer or licence agreement, or a stock licence record).

## 13. Integration plan (ours, after delivery)

1. Add the files under `public/customer/brand/envelope/`, with a `LICENSES.md` entry.
2. Replace the CSS-drawn layers in `components/customer/entry-hero.tsx` with the delivered layers, keeping the same entrance choreography and reduced-motion behaviour.
3. Re-verify Screen #1 at 320/360/390/430/tablet/desktop, KA/EN, performance (LCP) and the E2E tests.
4. Then reuse the set for the recipient reveal and theme thumbnails.

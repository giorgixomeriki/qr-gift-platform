# Screen #1 v7 — art-direction pass

Visual only. The v6 interaction, motion timeline, card-layer engineering, seal,
pricing, routing, copy and CSP are unchanged.

## Resource decision table

| Category | Resource | Source | Licence | Format shipped | Visual value | Perf cost | Decision | Reason |
|---|---|---|---|---|---|---|---|---|
| Botanical (upper-right) | Dried gypsophila, "white flower in close up photography" — Annie Spratt | Unsplash `zo7-ZyvplAI` | Unsplash License (free, not Unsplash+) | 720×1920 multiply/screen sprite, AVIF 18 KB / WebP 26 KB | High: the reference's main edge detail | Desktop only | **Use** | Pale, neutral, soft depth of field; its wall divides out cleanly |
| ~~Botanical (lower-left)~~ | Dried grasses, "brown grass on white surface" — Annie Spratt | Unsplash `YmoKERxSpso` | Unsplash License (free) | 420×846 sprite, AVIF 2 KB / WebP 4 KB | Medium-high: foreground depth | Negligible | **Removed** (correction pass) | Read as a blurred stain rather than framing |
| Shadow | Window-plant shadow | Derived from the gypsophila sprite | as above | none (no extra request) | Medium: the reference's cast light | Zero bytes; one blurred layer | **Use** | Falls from the window side, where the scene's light comes from |
| Botanical | Gypsophila + eucalyptus (`p_gmESo9Fco`, `HD3HH_TeGWs`) | Unsplash | free | — | — | — | Reject | Orange eucalyptus reads as florist |
| Material edge | Cream linen folds (`B99QPn0T_7Q`) — Julissa Santana | Unsplash | free | — | Low | — | Reject | Cool/green cast; a fabric at the edge competed with the kraft envelope |
| Material edge | Ribbons / bows (search "cream ribbon") | Unsplash | free | — | — | — | Reject | Gift-wrap product shots; wedding/packaging connotation |
| Botanical shadow photos | "dried flower shadow wall" results | Unsplash | free | — | — | — | Reject | Vases in frame; a derived shadow matches our light better |
| Paid libraries | Adobe Stock, Envato, Creative Market, Freepik | — | paid | — | — | — | Not needed | The free assets above met the brief |
| Font | Noto Serif Georgian (current), wght 250 at desktop display | Google Fonts, self-hosted | OFL | existing file (no new bytes) | High | 0 | **Use (refined)** | Best Georgian rendering in the study; lighter + larger at desktop |
| Font | Noto Serif Georgian wdth 75–87.5 | Google Fonts | OFL | — | Elegant | +file | Reject | Narrower cuts break the phrase as "…ეს / საჩუქარი" |
| Font | BPG Nateli, BPG Chveulebrivi | Debian `fonts-bpg-georgian` | GPL-2, **no font exception** | — | Nateli: high contrast | — | Reject | Licence risk for web embedding; Nateli's card line gets spindly |
| Font | GNU FreeSerif | Debian `fonts-freefont` | GPL-3 + font exception | — | Low | — | Reject | Heavy and dated at display size |
| Font | FiraGO Light | bBoxType (GitHub) | OFL | — | Low (sans) | — | Reject | Product-UI voice, not editorial |
| Font | Other Google Fonts / Fontshare | catalogues re-queried 2026-10-01 | — | — | — | — | n/a | Google: 3 Georgian families (unchanged); Fontshare: 0 |
| Texture | ambientCG Paper001 tooth (existing) | ambientCG | CC0 | existing | — | 0 | Keep | Unchanged; the window-plant shadow sits under the tooth layer, so the paper runs through it |

## Sheets

Committed as WebP (q82); full-size PNGs and the raw per-viewport captures
are kept out of git.

- `_compare-v7-final-desktop.webp`, `_compare-v7-final-mobile.webp`: the correction pass (current state)
- `_compare-v6-v7-desktop.webp`, `_compare-v6-v7-mobile.webp`
- `_v7-contact-sheet.webp`: every viewport, KA/EN, reduced motion, focus (before the correction pass)
- `_v7-typography-study.webp`: nine candidates set in the real headline, lede and card line, plus the live v6 vs v7 result
- `_v7-material-details.webp`, `_v7-responsive-art-direction.webp`
- `_v7-motion-desktop.webp`, `_v7-motion-mobile.webp` (the v6 timeline, unchanged)

## Correction pass

- Lower-left grass removed (read as a stain; the composition is cleaner without it). Its asset is deleted.
- Gypsophila: nearer-the-lens softness, backdrop haze lifted, florets lit from the window side, stems desaturated.
- Window-plant shadow laid along the photograph's diagonal light, back into the upper-left corner.
- Capability strip edged by the window light instead of a border; CTA shadow cast away from the light; facts set as printed serif metadata; strip-to-action gap 40 → 32px.

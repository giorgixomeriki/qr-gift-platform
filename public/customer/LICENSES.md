# Customer asset licence register

Every external asset under `public/customer/` is listed here. Add a row when an
asset is added; remove it when the asset is removed. No unlisted assets.

## illustrations/

### `entry-stationery-{mobile,desktop}-{width}.{avif,webp}`

| Field | Value |
|---|---|
| Files | `entry-stationery-mobile-640/960/1280.{avif,webp}`, `entry-stationery-desktop-1200/1800.{avif,webp}` |
| Source | Unsplash — "White paper and brown envelope" |
| Creator | Kate Macate (@katemacate) |
| Source URL | https://unsplash.com/photos/white-paper-and-brown-envelope-xmddEHyCisc |
| Licence | Unsplash License — https://unsplash.com/license (free Unsplash photo, not Unsplash+) |
| Commercial use | Allowed |
| Attribution | Not required (credited here) |
| Acquired | 2026-09-30, via the photo page's public "Download free" link (original 4608×3456 JPEG) |
| Modifications | Colour-graded warmer and lighter (midtone lift, warm white balance, −6% saturation) to match QR Starr's paper palette; cropped (mobile: x 18–90% / y 10–94%; desktop: x 17–100%); resized; encoded to AVIF (q70) and WebP (q84) |
| Where used | Screen #1 — available-card entry hero (`src/components/customer/entry-scene.tsx`). The card's words and the wax seal are live HTML/SVG layered on top; no text is baked into the image. |

### `entry-gypsophila.{avif,webp}`

| Field | Value |
|---|---|
| Files | `entry-gypsophila.avif` (18 KB), `entry-gypsophila.webp` (26 KB, fallback) — one 720×1920 sprite |
| Source | Unsplash — "white flower in close up photography" (dried gypsophila) |
| Creator | Annie Spratt (@anniespratt) |
| Source URL | https://unsplash.com/photos/white-flower-in-close-up-photography-zo7-ZyvplAI |
| Licence | Unsplash License — https://unsplash.com/license (free Unsplash photo, not Unsplash+; verified `premium: false`, `plus: false` on the photo record) |
| Commercial use | Allowed |
| Attribution | Not required (credited here) |
| Acquired | 2026-10-01, from Unsplash's public image CDN (`images.unsplash.com/photo-1619422305621-cd7f0763d5d0`, 2400px JPEG) |
| Modifications | Divided by a smooth fit of its own backdrop wall, leaving only the plant's effect on the light; split into a darkening half (top, used with multiply) and a brightening half (bottom, used with screen); 35% desaturated and warmed toward the scene's window light; cropped; a keep-clear mask baked in so it can never cover the stationery; encoded to AVIF (q52) and WebP (q72). Not a cut-out: no edge of the original photograph is shown. |
| Where used | Screen #1, desktop only — out-of-focus foreground at the photograph's top-right edge (`.cx-scene__botanical`), and, greyed and blurred, as the window plant's cast shadow on the upper paper (`.cx-atmosphere__shadow`), both in `src/app/globals.css` |

_Removed in the v7 correction pass: `entry-grass.{avif,webp}` (Unsplash `YmoKERxSpso`, Annie Spratt). It read as a blurred stain in the lower-left rather than framing; the composition was stronger without it._

## textures/

### `paper-tooth-256.{avif,webp}`

| Field | Value |
|---|---|
| Files | `paper-tooth-256.avif` (12 KB), `paper-tooth-256.webp` (17 KB, fallback) |
| Source | ambientCG — "Paper 001" |
| Creator | ambientCG (no per-asset author listed; the library is run by Lennart Demes). Released 2018-01-20; height-field photogrammetry |
| Source URL | https://ambientcg.com/a/Paper001 |
| Licence | Creative Commons CC0 1.0 Universal — https://docs.ambientcg.com/license/ |
| Commercial use | Allowed |
| Attribution | Not required (credited here) |
| Acquired | 2026-09-30, via the asset page's public 2K-JPG download (`Paper001_2K-JPG.zip`) |
| Modifications | From the Color and NormalGL maps: a 1024px square, high-passed colour luminance mixed with the normal map lit from upper-left, made seamless (half-offset blend), downscaled to 256px, stored as grey around 50%, encoded to AVIF (q40) and WebP (q55) |
| Where used | Screen #1 — the page ground (`.cx-atmosphere--table::after`) and the capability strip (`.cx-keepsake__sheet`) via the `--cx-paper-tooth` token in `src/app/globals.css`, blended with soft-light |

## Custom QR Starr assets (not external — listed for completeness)

| Asset | Where | Notes |
|---|---|---|
| Wax seal with the Starr spark | `src/components/customer/wax-seal.tsx` (inline SVG) | Drawn for QR Starr; uses the brand `SPARK_PATH` from `src/components/ui/logo.tsx`. Recolourable via `--cx-seal-*` tokens. Press animation in `globals.css`. |
| Blind-embossed Starr maker's mark | `src/components/customer/starr-emboss.tsx` (inline SVG filter) | Drawn for QR Starr from `SPARK_PATH`; no ink, edges only. |

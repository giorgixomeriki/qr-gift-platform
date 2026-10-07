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

### `linen-rough-256.{avif,webp}`

| Field | Value |
|---|---|
| Files | `linen-rough-256.avif` (9 KB), `linen-rough-256.webp` (15 KB, fallback) |
| Source | Poly Haven — "Rough Linen" |
| Creator | Poly Haven (texture scanned by the Poly Haven team) |
| Source URL | https://polyhaven.com/a/rough_linen |
| Licence | Creative Commons CC0 1.0 Universal — https://polyhaven.com/license |
| Commercial use | Allowed |
| Attribution | Not required (credited here) |
| Acquired | 2026-10-02, via the public asset API (`rough_linen_disp_1k.png`, the 1K displacement map) |
| Modifications | Displacement normalised, resized to a 256px seamless tile, high-passed and stored as grey around 50% (relief only, no colour), encoded to AVIF (q50) and WebP (q70). Replaces ambientCG Fabric036 (`linen-weave-256`), whose uniform weave read as a pattern rather than cloth |
| Where used | Screen #2 theme worlds — Romantic and Elegant grounds, via `--linen` in `src/components/themes/theme-world.css`, blended with soft-light |

### `window-light-900.{avif,webp}`

| Field | Value |
|---|---|
| Files | `window-light-900.avif` (2 KB), `window-light-900.webp` (4 KB, fallback) |
| Source | Unsplash — "white painted wall" |
| Creator | Bernard Hermant (@bernardhermant) |
| Source URL | https://unsplash.com/photos/PrZw3_3xUxI |
| Licence | Unsplash License — https://unsplash.com/license (free Unsplash photo) |
| Commercial use | Allowed |
| Attribution | Not required (credited here) |
| Acquired | 2026-10-01 |
| Modifications | Divided by its own wall to leave only the window light, converted to a grey light map, resized to 900px, encoded to AVIF/WebP. Used as a luminance mask (light, not a picture) |
| Where used | Screen #2 theme worlds — Romantic's window light (`.tw__light`) |

## engravings/

Period engravings adapted as single-colour masks, so they print in each
world's own ink; the plates themselves are never shown.

### `honeysuckle-440.{webp,avif}`, `honeysuckle-seal-112.{avif,webp}`

| Field | Value |
|---|---|
| Files | `honeysuckle-440.webp` (11 KB), `honeysuckle-440.avif` (19 KB), `honeysuckle-seal-112.{avif,webp}` (3–4 KB) |
| Source | Wellcome Collection — "Two sprigs of flowers, including tulip and honeysuckle", engraving, 1775 (Wellcome V0044075) |
| Source URL | https://commons.wikimedia.org/wiki/File:Two_sprigs_of_flowers,_including_tulip_and_honeysuckle,_mean_Wellcome_V0044075.jpg |
| Licence | Creative Commons Attribution 4.0 — https://creativecommons.org/licenses/by/4.0/ |
| Commercial use | Allowed |
| Attribution | **Required**: "Honeysuckle, engraving, 1775. Wellcome Collection (CC BY 4.0)" — credited here and in `docs/design/theme-professional-components.md`; adapted (see below) |
| Acquired | 2026-10-02, from Wikimedia Commons (3100×2190 JPEG) |
| Modifications | Right-hand (honeysuckle) spray cropped; paper background removed against a blurred estimate of the sheet; isolated paper specks removed (connected-component filter); stored as an alpha-only mask (440px; 112px for selector seals) |
| Where used | Screen #2 — Romantic world (`.tw--romantic .tw__engraving`) and its selector seal |

### `olive-branch-640.{avif,webp}`, `olive-seal-112.{avif,webp}`

| Field | Value |
|---|---|
| Files | `olive-branch-640.avif` (17 KB), `olive-branch-640.webp` (19 KB), `olive-seal-112.{avif,webp}` (4–7 KB) |
| Source | "Olea cuspidata, Wall." — W. H. Fitch del. et lith., plate XXXVIII of D. Brandis, *The Forest Flora of North-West and Central India* (1874) |
| Source URL | https://commons.wikimedia.org/wiki/File:Olea_europaea_ssp_cuspidata_Bra38.png |
| Licence | Public domain (published 1874; artist died 1892) |
| Commercial use | Allowed |
| Attribution | Not required (credited here) |
| Acquired | 2026-10-02, from Wikimedia Commons (1202×1722 PNG, line art on alpha) |
| Modifications | Upper-right spray cropped; ink × alpha extracted; specks removed; stored as an alpha-only mask (640px; 112px for selector seals) |
| Where used | Screen #2 — Wedding world, printed pale olive with a faint impression (`.tw--wedding .tw__engraving`), and its selector seal |

## scenes/

Real footage used as light inside the theme scenes (Screen #2 immersive
pass). Each loads only when its scene plays; a still of its last frame is
the world's rest state.

### `romantic-leaves.mp4`, `romantic-leaves-rest.webp`

| Field | Value |
|---|---|
| Files | `romantic-leaves.mp4` (79 KB, 8 s, 400×500, H.264, no audio), `romantic-leaves-rest.webp` (3 KB, last frame) |
| Source | Pexels — "A Shadow of Leaves Swaying in the Wind" (video 8516625) |
| Source URL | https://www.pexels.com/video/a-shadow-of-leaves-swaying-in-the-wind-8516625/ |
| Licence | Pexels License — https://www.pexels.com/license/ (free to use and modify, commercial use allowed, no attribution required) |
| Commercial use | Allowed |
| Attribution | Not required (credited here) |
| Acquired | 2026-10-04, from the public preview file (videos.pexels.com) |
| Modifications | First 8 s; cropped to 4:5; converted to greyscale; contrast raised; re-encoded. Used as a light map (multiplied, warmed in CSS), never shown as a picture |
| Where used | Romantic world — the leaf shadows at the window (`.tw__leaves`, `.tw__leaves-film`) |

### `celebration-sky.mp4`, `celebration-sky-rest.webp`, `celebration-room.webp`

| Field | Value |
|---|---|
| Files | `celebration-sky.mp4` (185 KB, 7 s, 400×500, H.264, no audio), `celebration-sky-rest.webp` (29 KB, last frame), `celebration-room.webp` (12 KB, the same frame darkened for the room) |
| Source | Mixkit — night sky / Milky Way time-lapse (video 1610) |
| Source URL | https://mixkit.co/free-stock-video/stars/ (asset 1610) |
| Licence | Mixkit Stock Video Free License — https://mixkit.co/license/#videoFree (commercial use allowed; not to be redistributed as standalone footage) |
| Commercial use | Allowed |
| Attribution | Not required (credited here) |
| Acquired | 2026-10-04, from the public 360p file (assets.mixkit.co) |
| Modifications | 7 s from 4 s; cropped to 4:5; contrast raised; re-encoded; screened faintly into the midnight ground and partly desaturated in CSS |
| Where used | Celebration world — the night sky (`.tw__sky`, `.tw__sky-film`) and Celebration's room on Screen #2 |

## Custom QR Starr assets (not external — listed for completeness)

| Asset | Where | Notes |
|---|---|---|
| Wax seal with the Starr spark | `src/components/customer/wax-seal.tsx` (inline SVG) | Drawn for QR Starr; uses the brand `SPARK_PATH` from `src/components/ui/logo.tsx`. Recolourable via `--cx-seal-*` tokens. Press animation in `globals.css`. |
| Blind-embossed Starr maker's mark | `src/components/customer/starr-emboss.tsx` (inline SVG filter) | Drawn for QR Starr from `SPARK_PATH`; no ink, edges only. |

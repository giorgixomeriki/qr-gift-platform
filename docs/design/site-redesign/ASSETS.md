# Home page asset register

Every image, ornament, texture and font the redesigned home page uses (`src/components/site/home`). Last updated 2026-10-22 (luxury-vintage pass). Re-check a source before reusing an asset elsewhere.

## Hero image: owner-supplied, in `public/site/photos/`

| File | Source | Rights | Subject | Processing |
|---|---|---|---|---|
| `hero-bouquet` | `Burgundy Roses and Digital Love Note.png`, the owner's final approved hero image (2026-10-29), kept as `docs/design/site-redesign/sources/hero-love-note.png` (1312×1199 PNG, sha256 `d2eff3642d43780a5b68…`) | AI-generated, commissioned by the owner; not stock, no third-party photographer. Usage rights follow the generator's terms as accepted by the owner | Dark burgundy roses in champagne paper with a wine ribbon, a QR Starr card tied on with string, a phone showing a greeting (letter, couple photos, voice note) | Georgian text corrected (below), then cut out of its background: Apple Vision foreground mask (`sources/hero-lift.swift`), then `sources/hero-cutout.py` tightens and decontaminates the edge, keeps a contact shadow from the photo's own table darkening plus a soft silhouette occlusion, and fades the ribbon where the source frame cuts it. The master is `sources/hero-bouquet-cutout.png` (RGBA 1247×1194, trimmed). The pixels are not regraded. AVIF q54 with alpha / WebP q80 (alpha q80) at 640, 960 and 1247 wide (45–92 KB AVIF) |

The QR code and phone screen in this image are painted pixels, not working UI, and the code has not been verified as scannable; nothing uses it.

Georgian correction (owner-approved 2026-10-29): the AI-rendered Georgian was misspelled, so `sources/hero-fix-georgian.py` erases those lines and re-sets them in the site's Google Sans Georgian (SIL OFL, `public/fonts/OFL-googlesans.txt`) at the original angle, size and colour. The card now reads "შენი მილოცვა გელოდება" and the phone note "ყველა ჩვეულებრივი / დღე შენთან ერთად / უფრო ლამაზია.". All three message lines are re-set; the original third line was also misspelled (roughly "ლაშაშია"). The period comes from the Latin cut of the same family, because the Georgian subset has no ".". It also redraws the note's two faint ruled lines (measured from the original), only where they were missing. Only pixels inside the two text areas change. The result is `sources/hero-love-note-corrected.png`, and the cutout is made from it with the same mask.

The bouquet runs off the source's right edge, so the hero places that edge against the viewport's right edge.

It replaces the layered hero (photo, Redouté plate, CSS card and CSS phone). Before it: `hero-roses` (an owner-supplied rose still life, commit a049c84), and before that `hero-tulips` (Unsplash 6-12MRO2ru0, Slava). Both sets of files were removed.

## Photographs: Unsplash (23), in `public/site/photos/`

Each photo page was checked one by one and reads "Free to use under the Unsplash License" (https://unsplash.com/license); none is Unsplash+. Commercial use is allowed and attribution is not required (credited here anyway).

Restrictions honoured:
- The photos are not sold as stand-alone files.
- No photo implies endorsement or is presented as a QR Starr customer, partner or shop.
- Photos showing third-party brand marks or shop names were rejected (`3BvVFcZIL7I`, `ayUGdxRvjV4`, `T2NBdcVUN78`).

Processing: downloaded from each photo's own `images.unsplash.com` file; then a uniform warm grade (red +2.5% / blue −3%, contrast −4%, saturation −6%), crops (see `encode.py` in the design notes), a mild denoise on textured images, and responsive AVIF/WebP. Total 3.3 MB across all widths; a page load fetches only the widths it needs.

| File | Source | Photographer | Subject | Used for |
|---|---|---|---|---|
| `gift-hands-cafe` | https://unsplash.com/photos/FDTlWHmwIz8 | Vitaly Gariev (@silverkblack) | hands presenting a gift box in a cafe | Video tile poster; keep-screen video |
| `gift-parcel` | https://unsplash.com/photos/zYPixh1jN9w | Liana S (@cherstve_pechivo) | hand holding a small paper package | Occasions: Just because |
| `occasion-birthday` | https://unsplash.com/photos/d8s13D29QiE | Aneta Pawlik (@anetakpawlik) | hand lighting candles on a birthday cake | Occasions: Birthdays |
| `occasion-love` | https://unsplash.com/photos/J181M95wE8Y | Arjun Lama (@arjun_lama) | hand holding a bouquet | Occasions: Flowers and love |
| `occasion-wedding` | https://unsplash.com/photos/30UOqDM5QW0 | Olivia Bauso (@ohhbee) | bride and groom, beige bouquet (no faces) | Occasions: Weddings |
| `occasion-celebration` | https://unsplash.com/photos/xzKtOI1Cnxo | Alexander Naglestad (@alexandernaglestad) | champagne poured into flutes | Occasions: Celebrations |
| `keepsake-picnic` | https://unsplash.com/photos/tvbxqXI5mmo | Simi Iluyomade (@simisola) | friends laughing on a picnic blanket | Prints in the phone; photo stack |
| `keepsake-hug` | https://unsplash.com/photos/0-uzdU3gUYw | Omar Lopez (@omarlopez1) | two women hugging at a beach | Prints in the phone; photo stack; paper-to-screen |
| `bouquet-garden` | https://unsplash.com/photos/aiNU4cA4UzQ | jessie daniella (@jessiedaniella) | person holding beige and white flower bouquet | Moments; photo stack; paper-to-screen |
| `recipient-admiring` | https://unsplash.com/photos/d0w4p-8Y1c0 | Volodymyr Lymariev (@vlmrv) | woman in pink dress admiring a pink bouquet | After the scan (desktop): the recipient moment |
| `florist-peonies` | https://unsplash.com/photos/tkTf8ADH3XY | Volodymyr Lymariev (@vlmrv) | hands arranging peonies, natural light | How it works 01 |
| `florist-roses` | https://unsplash.com/photos/1HCKc_xNHMA | Volodymyr Lymariev (@vlmrv) | hands arranging pink roses | Partners gallery 1 |
| `bouquet-peonies` | https://unsplash.com/photos/8nddjqlxvJ8 | Volodymyr Lymariev (@vlmrv) | lush pink and white roses and peonies | Moments; partners gallery 2 |
| `flower-stall-dusk` | https://unsplash.com/photos/iBKEda7Y9SI | Jeffrey Zhang (@jeffreyzhang_920) | illuminated flower stall at dusk, Krakow | Partners gallery 3 |
| `wax-seal-ribbon` | https://unsplash.com/photos/kkIyF9RvnKk | Abigail Ybarra (@creativecoast) | marbled wax seal on olive ribbon, dried flowers | Moments; finale postcard |
| `envelope-seal` | https://unsplash.com/photos/WURF-2BWgPI | Abigail Ybarra (@creativecoast) | envelope, wax seal, white flowers on green ribbon | Product mockup base (QR Starr card composited): How it works 02, pricing |
| `sealed-letter` | https://unsplash.com/photos/n6OJ0y4pNDg | Raymond Petrik (@raymondpetrik) | sealed letter with wax seal, calligraphy supplies | Paper-to-screen (paper side); scan screen camera view |
| `roses-envelope` | https://unsplash.com/photos/eGiuBAObqK8 | Stacy (@stacysuxx) | pink roses arranged in an envelope | Moments; finale postcard |
| `roses-vintage` | https://unsplash.com/photos/Su_sl-WPAJ4 | Heather Newsom (@native7photo) | peach roses on dark vintage background | Final CTA background |
| `gift-wrapping` | https://unsplash.com/photos/72J7m5LM7bE | Cemrecan Yurtman (@cmrcn_) | hands wrapping kraft gifts with red ribbon | Moments |
| `gift-opening` | https://unsplash.com/photos/_sOXcL35PlU | Teddy Bae (@sharehows) | person opening a gift box with red ribbon | Moments |
| `reader-tulips` | https://unsplash.com/photos/2uce1_9O2Ao | Anna Keibalo (@anyutakejbalo) | woman reading with flowers nearby | How it works 03 |
| `roses-hands` | https://unsplash.com/photos/5dPvQ2WoOxQ | Khaled Ali (@khkar) | hands touching a red and cream rose bouquet | Occasions: Anniversaries |

Replaced in this pass (no longer shipped): recipient-smile, recipient-street, florist-arranging, florist-shop, florist-display, card-flatlay, gift-box-held, occasion-anniversary, occasion-justbecause.

## Public-domain artworks, in `public/site/vintage/`

All are museum open access, CC0 (no rights reserved), confirmed on each record. Images are cropped to the plate and encoded to AVIF/WebP.

| File | Work | Source | Licence | Used for |
|---|---|---|---|---|
| `redoute-josephine` | Pierre-Joseph Redouté, ‘Empress Josephine’ rose, *Les Roses*, 1817–24 | https://www.metmuseum.org/art/collection/search/762055 | Met Open Access, CC0 | Hero plate; Flowers-and-love postcard |
| `redoute-pompon` | Redouté, Pompon Rose, 1817–24 | https://clevelandart.org/art/1943.142 | CMA Open Access, CC0 | Birthday postcard; finale |
| `redoute-gallica` | Langlois after Redouté, Rosa Gallica Purpurea Velutina Parva | https://clevelandart.org/art/1965.293 | CC0 | Anniversary postcard; finale |
| `redoute-cabbage` | Redouté, Cabbage Rose | https://clevelandart.org/art/1959.14 | CC0 | Just-because postcard; finale |
| `redoute-moss` | H. J. Redouté, Moss Rose | https://clevelandart.org/art/1943.141 | CC0 | Wedding postcard |
| `ruotte-bouquet` | Louis Charles Ruotte, bouquet of foxglove, peony and poppy, 1805 | https://clevelandart.org/art/1951.419 | CC0 | Celebration postcard |
| `lace-valentine` | Esther Howland, Valentine with lace paper and faux pearls, c.1855 | https://www.metmuseum.org/art/collection/search/775454 | CC0 | Lace mat under the pricing card |

## Ornaments (SVG, unmodified; shown as masks over gold foil)

| File | Source | Licence | Used for |
|---|---|---|---|
| `corner-art-nouveau.svg` | https://commons.wikimedia.org/wiki/File:Art_Nouveau_flourish.svg | Public domain | Gold corners: hero photo, FAQ card, postcard dialog |
| `divider-vine.svg` | https://commons.wikimedia.org/wiki/File:Flourish-1348158.svg | CC0 | Divider above "From paper to screen" |
| `flourish-harpel.svg` | https://commons.wikimedia.org/wiki/File:Harpel%E2%80%99s_flourish_5.svg | Public domain | Section label flourish (every section) |

## Textures

| File | Source | Licence | Modification |
|---|---|---|---|
| `gold-foil-512` | ambientCG Foil002, https://ambientcg.com/a/Foil002 | CC0 | Colour map greyscaled, autocontrast, colourised to the Signature gold, 512px |
| (existing) `paper-tooth-256`, `linen-rough-256` | see `public/customer/LICENSES.md` | CC0 | unchanged |

## Fonts

| Font | Source | Licence | Use |
|---|---|---|---|
| Cormorant Garamond (variable, normal + italic, Latin subset) | Google Fonts, https://fonts.google.com/specimen/Cormorant+Garamond | SIL OFL 1.1 (`public/fonts/OFL-cormorantgaramond.txt`) | Latin display on the home page only |
| Noto Serif Georgian, Google Sans, Newsreader | existing | SIL OFL 1.1 | unchanged; Georgian display stays Noto Serif Georgian |

## Product mockups

The QR Starr card on the home page is always our own live artwork: logo, a real QR code for `https://qrapp.ge` (never a greeting token), wax seal and the "Scan me" line. It is composited onto licensed photographs (`envelope-seal`, `sealed-letter`). No stock card is presented as the product.

## Icons

Phosphor Icons (MIT), already a dependency. One family across the page.

## Product media (functional, `public/site/media/` and `public/site/designs/`)

| File | Source | Licence | Notes |
|---|---|---|---|
| `design-<theme>-<ka|en>-{400,720}` | Captured from QR Starr's own theme picker (`/g/<token>`, design step), 2026-10-22 | QR Starr's own product | The six real greeting designs, in both languages |
| `video-bouquet-720.mp4`, `video-bouquet-poster-*` | Mixkit, "Girl in love smells a bouquet of flowers" (#42596), https://mixkit.co/free-stock-video/girl-in-love-smells-a-bouquet-of-flowers-42596/ | Mixkit Stock Video Free License: the clip page states free download "for commercial or personal use" (checked 2026-10-22; several other gifting clips were Restricted and rejected) | Re-encoded 1280×720 H.264, silent, slight warm grade, 9 s, 0.96 MB; loads only when opened |
| `voice-sonnet43.m4a`, `.peaks.json` | LibriVox, "Sonnet 43" by Elizabeth Barrett Browning, reader "CG", https://archive.org/details/sonnet_43_librivox | Public domain (LibriVox; item licence creativecommons.org/licenses/publicdomain) | Demo only, in English (no licensed Georgian greeting recording exists in Commons, Lingua Libre, Freesound CC0 or LibriVox). Trimmed to the poem (43 s), loudness-normalised, AAC 80 kbps; peaks computed from the file. Replace with a real Georgian greeting when available |

Library: wavesurfer.js 7.12.12 (BSD-3-Clause, https://wavesurfer.xyz), imported on demand.

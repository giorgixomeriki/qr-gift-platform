# Home page asset register

Every image and icon set used by the redesigned home page (`src/components/site/home`). External photographs live in `public/site/photos/` as AVIF + WebP at the widths in `photos.ts`. Re-check a photo's page before reusing it elsewhere.

## Photographs (Unsplash)

All 19 were checked one by one on 2026-10-21/22, on each photo's own Unsplash page. Each page reads "Free to use under the Unsplash License" (https://unsplash.com/license), and none is Unsplash+. Commercial use is allowed and attribution is not required; photographers are credited here anyway.

Restrictions honoured:
- The photos are not sold as stand-alone files.
- They are not used to imply endorsement, so none is captioned or presented as a QR Starr customer, partner or shop.
- Photos showing third-party brand marks on products were rejected (Olivia Bollen's branded gift boxes, `3BvVFcZIL7I` and `ayUGdxRvjV4`). So was `BU6NyF2OOOE`, whose page describes a lingerie studio shoot.

Source: `https://images.unsplash.com/<CDN id>?w=2400&q=85` (the photo's own CDN file), downloaded 2026-10-22.

Modifications applied to all photos:
- a uniform grade (red +2.5% / blue −3%, contrast −4%, saturation −6%);
- crops as listed;
- a mild denoise on four textured images (card-flatlay, occasion-justbecause, florist-display, florist-shop);
- resized and encoded to AVIF (q44–52) and WebP (q66–76).

| File | Unsplash page | Photographer | Description | Crop | Used for |
|---|---|---|---|---|---|
| `hero-tulips` | https://unsplash.com/photos/6-12MRO2ru0 | Slava (@slava27) | flower petals on brown paper bag | none | Hero: the gift in the campaign composition |
| `recipient-street` | https://unsplash.com/photos/Bh1GOs-HE_w | Good Faces (@goodfacesagency) | woman walking with a bouquet | none | How it works step 03; moments ribbon |
| `gift-hands-cafe` | https://unsplash.com/photos/FDTlWHmwIz8 | Vitaly Gariev (@silverkblack) | hands presenting a gift box in a cafe | none | Moments ribbon; video tile poster; keep-screen video; final CTA background |
| `gift-box-held` | https://unsplash.com/photos/IPx7J1n_xUc | Kira auf der Heide (@kadh) | person showing brown gift box | none | Moments ribbon |
| `gift-parcel` | https://unsplash.com/photos/zYPixh1jN9w | Liana S (@cherstve_pechivo) | hand holding a small paper package | none | Moments ribbon |
| `florist-arranging` | https://unsplash.com/photos/3DyfEiITFz4 | Viktoriia Yatsentiuk (@gloriaviktoriia) | woman arranging flowers in a flower shop | y 5–90% | How it works step 01; partners gallery |
| `florist-shop` | https://unsplash.com/photos/HdSf03uqn28 | Danny Greenberg (@by_danny_g) | sunlit flower shop | y 8–85% | Partners gallery |
| `florist-display` | https://unsplash.com/photos/IVpYduh-odI | Hazel J (@hhj8861) | vibrant flower display in a shop | none | Partners gallery |
| `occasion-birthday` | https://unsplash.com/photos/d8s13D29QiE | Aneta Pawlik (@anetakpawlik) | hand lighting candles on a birthday cake | y 12–82% | Occasions: Birthdays |
| `occasion-love` | https://unsplash.com/photos/J181M95wE8Y | Arjun Lama (@arjun_lama) | hand holding a bouquet | y 10–85% | Occasions: Flowers and love; moments ribbon; photo stack |
| `occasion-anniversary` | https://unsplash.com/photos/3fADmsc0Eeg | Vitaly Gariev (@silverkblack) | couple holding hands at candlelit dinner | none | Occasions: Anniversaries |
| `occasion-wedding` | https://unsplash.com/photos/30UOqDM5QW0 | Olivia Bauso (@ohhbee) | bride and groom, beige bouquet (no faces) | none | Occasions: Weddings |
| `occasion-celebration` | https://unsplash.com/photos/xzKtOI1Cnxo | Alexander Naglestad (@alexandernaglestad) | champagne poured into flutes | none | Occasions: Celebrations |
| `occasion-justbecause` | https://unsplash.com/photos/AiBDL8E8ojg | Jennie Razumnaya (@jennie_ra) | tulips and an envelope on a table | y 10–85% | Occasions: Just because |
| `card-flatlay` | https://unsplash.com/photos/a8wqOHD1nCA | Jennie Razumnaya (@jennie_ra) | sunflower and a card on a table | none | Product mockup base (QR Starr card composited onto its blank card): step 02, pricing, scan screen |
| `keepsake-picnic` | https://unsplash.com/photos/tvbxqXI5mmo | Simi Iluyomade (@simisola) | friends laughing on a picnic blanket | y 15–75% | Photo prints inside the phone; photo stack |
| `keepsake-hug` | https://unsplash.com/photos/0-uzdU3gUYw | Omar Lopez (@omarlopez1) | two women hugging at a beach | none | Photo prints inside the phone; photo stack |
| `recipient-smile` | https://unsplash.com/photos/NtFfR3xULbQ | Vitaly Gariev (@silverkblack) | woman smiling at her smartphone | none | After-the-scan stage (desktop) |
| `bouquet-garden` | https://unsplash.com/photos/aiNU4cA4UzQ | jessie daniella (@jessiedaniella) | person holding beige and white flower bouquet | y 5–90% | Moments ribbon; photo stack |

## Product mockup (composite)

`CardComposite` (`objects.tsx`) lays QR Starr's own card artwork over the blank card in `card-flatlay`. The artwork is live HTML: logo, a real QR code for `https://qrapp.ge`, a wax seal and the line "Scan me". It sits in the photograph's own coordinates (x 54.6%, y 51%, width 33.8%). The QR code points to the public site, never to a greeting token. Nothing presents an unrelated card as the product.

## Previously licensed assets (unchanged, see `public/customer/LICENSES.md`)

`textures/window-light-900` (hero light), `textures/paper-tooth-256` and `textures/linen-rough-256` (paper and linen).

## Icons

| Set | Licence | Use |
|---|---|---|
| Phosphor Icons (`@phosphor-icons/react` 2.1.10, already a dependency) | MIT | All home-page icons. SSR modules (`dist/ssr/*`) in server components; CSR modules in the carousel arrows |
| QR Starr Spark and WaxSeal (own artwork, `components/ui/logo.tsx`, `components/customer/wax-seal.tsx`) | QR Starr | Logo, card, seals |

No Tabler or Lucide icons are used on the home page. The Aceternity carousel's `@tabler/icons-react` arrows were replaced with Phosphor, so the page uses one icon family.

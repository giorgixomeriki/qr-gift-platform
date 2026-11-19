# Partner locations — “Where to Find QR STARR” / „სად ვიპოვო QR STARR?“

A home-page section that helps customers find the physical partner shops where
QR STARR cards are sold, plus the Super Admin tools to manage those shops.

Branch `feat/partner-locations-map`, cut from production `3aa41b3`. Not pushed,
merged or deployed.

## What the visitor gets

- The section sits after **Pricing** and before **Trust/FAQ** and the final CTA:
  price → where to buy → reassurance → conversion. It comes after How It Works
  (Steps), as the brief asked.
- Search by shop, branch, city, district, address or shop type, in Georgian or
  English. The search ignores case, accents and punctuation.
- Shop-type filter chips. Only types that actually have shops are shown.
- **Near me** sorts by distance and shows “1.2 km”. The browser computes this
  from its own location, and the location is never sent to QR STARR or anyone
  else. Permissions-Policy now allows `geolocation=(self)`; it was `()`.
- Each card shows the shop type, name, branch, address, district and city, and
  optionally hours and phone. It also shows availability when it is supported
  by inventory data (see below).
- **Get directions** opens Google Maps directions to the pin
  (`google.com/maps/dir/?api=1&destination=lat,lng`). This needs no key and
  opens the Maps app on phones. **Show on map** flies the map to the shop.
  **Call** is a `tel:` link.
- On the map, each pin is a real `<button>`. Selecting a pin highlights its card
  and scrolls the card into view; selecting a card highlights the pin.
  Filtering hides pins that aren't listed and frames the rest. The first frame
  is the city with the most shops, so dense Tbilisi pins don't stack at
  country zoom.
- **Phones (Pixel 6 / iPhone):** search → chips → a fixed-height map (no layout
  shift) → a horizontal, snap-scrolling row of cards. The map uses cooperative
  gestures: one finger scrolls the page, two fingers move the map, with a
  localized hint. Touch targets are ≥ 44 px.
- **Desktop:** the list is a scrolling column beside a 30–36 rem map.
  Ctrl/⌘ + scroll zooms the map. Rotation and pitch are disabled.
- **Accessibility:** the list is server-rendered and complete without the map.
  The result count is announced (`aria-live`), chips and toggles use
  `aria-pressed`, and there are focus rings throughout. Reduced motion turns
  off map animation and transitions.
- **If there are no public locations**, the section is not rendered at all. The
  home page never shows an empty or invented map; this is the state production
  is in today. If the database errors, the section is hidden and the error is
  logged, so the page still renders.

## Data model — migration `0028_partner_locations.sql`

The existing schema had nothing to reuse. Partners have no address, and the
owner's registered address must never be used. So one new admin-only table was
added; existing tables were not changed.

`partner_locations` columns (many rows per partner = branches):

- `partner_id` → partners, on delete restrict
- `branch_name`, `category` (FLOWERS, GIFTS, CONFECTIONERY, BOOKS, JEWELRY, CAFE, OTHER)
- `address_ka`/`_en`, `city_ka`/`_en`, `district_ka`/`_en` (English falls back to Georgian)
- `latitude`, `longitude`, `phone`, `hours_ka`/`_en`
- `stocks_cards`: the admin's per-branch switch
- `is_public`, `is_mock`
- `coordinates_verified_at`, `coordinates_verified_by`
- `created_at`, `updated_at`

Rules enforced by the database, not just by the app:

| Rule | How |
|---|---|
| Public only if verified | `CHECK (not is_public or coordinates_verified_at is not null)` |
| New rows start hidden and unverified, whatever the caller sends | trigger `partner_locations_guard`, for `app_runtime` inserts |
| Moving a shop (pin, address, city, district) un-verifies and hides it | same trigger on update |
| Admin-only read/write | RLS policies `TO app_runtime USING (app_is_admin())`. Partners, users and anonymous visitors read nothing. |
| Data API stays closed (SEC-01) | explicit revokes from anon/authenticated/service_role/PUBLIC on the table and both functions |
| The only public read | `app_public_partner_locations(p_include_mock)`, SECURITY DEFINER with a fixed `search_path`. It returns display columns only: partner *name*, never the id, commission, members, audit fields or stock flags. |

Public = `is_public AND coordinates_verified_at IS NOT NULL AND partner.status = 'ACTIVE' AND (NOT is_mock OR p_include_mock)`.
Suspending a partner removes all of its shops at once.

### Availability (never invented)

The value is derived inside the same SQL function:

- **AVAILABLE** (“Cards in stock”): the branch is marked as stocking cards
  **and** the partner holds ≥ 1 card that is `DISTRIBUTED` (physically handed
  over, partner/admin-confirmed) **and** still `AVAILABLE` (unsold).
- **OUT** (“Temporarily out of cards”): an admin marked this branch as not
  stocking cards.
- **UNKNOWN**: no claim is shown.

The platform records distribution per *partner*, not per branch. That is why the
per-branch admin switch is part of the rule, and why no counts are shown
publicly. The admin page shows the partner-level count. True per-branch stock
would need batch→branch allocation; that is out of scope and would be a
separate migration.

### Numbering and integration

Production holds 0000–0027 (last `0027_qr_handover_immediate`, journal
`when` 1795507200000). This migration is `0028` with `when` 1795593600000, so
drizzle applies it next. It was first written as 0023 on 3aa41b3 and renumbered
when rebased onto live 89a78ef (2026-11-26).

- `src/db/migrations/meta/_journal.json`: keep both entries, idx 22 then 23.
- `src/lib/security/csp.ts`: keep Our Song's `opts`/`frame-src` and this
  branch's `connect-src … ${MAP_TILE_ORIGIN}` + `worker-src 'self' blob:`.

`package.json` may also conflict: both branches add scripts. Keep all of them.

The migration was tested only on an isolated database (`qr_partnermap` on the
local qrgate2 stack). It was not applied to the shared `postgres` database or
to production. Applying it in production is a deploy step and needs approval.

## Admin management

Location management lives in **Admin → Partners → (partner) → Shop locations**,
behind the existing `requireAdmin` (signed in, admin, MFA aal2). The page shows
the partner's distributed-unsold card count and each location's badges:
Public/Hidden, Pin verified/not, the availability it will show, and Test
fixture. The actions are:

- **Add / Edit:** Georgian and English fields. Paste the pin as
  `lat, lng` from Google Maps (right-click the shop entrance), or drag the pin
  on the preview map. A pin outside Georgia shows a swapped-lat/lng warning.
- **Check in Google Maps**, then **Mark pin as verified**.
- **Show on / Hide from home page.** Publishing is disabled until the pin is
  verified. Mock rows can never be published.
- **Mark out of cards / Mark as stocking cards.**
- **Delete**, only while the location is hidden.

Every action runs through a server action (`lib/partner-locations/actions.ts`)
and then `admin.ts`. `admin.ts` re-checks `app_is_admin()` in the transaction,
locks the row, refuses stale edits (optimistic `updatedAt`), and writes one
`audit_logs` row: `PARTNER_LOCATION_{CREATED, UPDATED, VERIFIED, PUBLISHED,
HIDDEN, STOCKED, OUT_OF_STOCK, DELETED}`. Each change revalidates `/`.

Partners do not manage their own locations. The table is admin-only by design
for now.

## Mapping technology

- **MapLibre GL JS 6.16.0** (BSD-3), loaded on demand. The 295 KB gzip library
  and the 148 KB gzip worker are fetched only when the section comes within
  600 px of the viewport. If the visitor has Save-Data on, nothing loads until
  they tap “Show the map”. Without WebGL, the list is the experience.
- **Tiles: OpenFreeMap** (`tiles.openfreemap.org`). It is free, needs no API key
  or registration, allows commercial use, and has no view limits. Attribution
  is required: “OpenFreeMap © OpenMapTiles © OpenStreetMap”. It is always
  visible on the map, with links. Data is © OpenStreetMap contributors (ODbL).
- **Own basemap style** (`components/maps/map-style.ts`): only the layers a shop
  finder needs, painted in the home page's ivory/wine palette. There is no
  sprite request. Labels follow the page language (`name:ka` or `name:en`);
  OpenFreeMap's Noto Sans glyphs include Georgian.
- **No MapLibre CSS on the home page.** The ~40 rules the map needs are in
  `locations.css`. The admin page imports the full stylesheet.
- **Worker:** the bundled build can't locate its worker, so
  `maplibre-gl-worker.mjs` is copied byte-for-byte to
  `public/vendor/maplibre-gl-6.16.0/`, together with its licence, and set with
  `setWorkerUrl`. `verify:partner-locations` 7l fails if the copy and the
  installed version ever diverge. **When upgrading `maplibre-gl`**, re-copy
  the worker into a new versioned folder and bump `MAPLIBRE_VERSION`.
- **CSP** (`lib/security/csp.ts`):
  `connect-src … https://tiles.openfreemap.org` (manifest, tiles, glyphs) and
  `worker-src 'self' blob:`. The second is needed because `'strict-dynamic'`
  script-src ignores `'self'` for workers. `img-src`, `script-src` and
  `frame-src` are unchanged.
- **Cost to the home page's first load:** one ~6.5 KB chunk (loader and style)
  plus the explorer component and ~10 KB of CSS. Nothing else.

## Mocks: testing without real shops

`npm run dev:seed-partner-locations` inserts 7 locations for 3 partners named
`TEST · …`, with `is_mock = true`. Every address reads “test address” or
„სატესტო მისამართი“. Coordinates are neighbourhood centres, not businesses.
Rose Atelier gets 3 distributed, unsold TEST cards, so “Cards in stock” is
derived exactly as in production. `--remove` deletes everything the script
created.

Mocks reach the page only when **both** hold:

1. the server runs with `PARTNER_MAP_MOCKS=1`, and
2. it is not a hosted deployment (`VERCEL`, `RENDER`, `APP_HOSTED`).

A hosted deployment with the flag set **refuses to boot**
(`partnerMapMockProblems` in `lib/env.ts`). The seed script refuses
non-loopback databases. Every mock card carries a **Test / სატესტო** badge, and
admins can't publish a mock.

## Tests

- `npm run verify:partner-locations`: 48 DB/unit checks. They cover
  visibility, payload columns, availability derivation, the verification
  trigger, RLS (anonymous, user, partner OWNER), Data-API privileges, the admin
  service (verify→publish→stock→conflict→hide→delete with audit rows), helpers,
  validation, the mock guard, the CSP and the vendored worker.
- `e2e/partner-locations.spec.ts`:
  - Public: list, search, filters, directions link, map sync, Georgian copy,
    no horizontal overflow, 44 px targets, hidden/unverified rows never shown.
    The public tests skip themselves when no mocks are seeded.
  - Access: a partner can't reach location management.
  - Admin: the full add → (swapped-coordinate warning) → verify → publish →
    visible on `/` → hide → gone flow, with its audit trail. This uses a
    throwaway admin, so the shared dev admin's MFA factors are never touched.

## Files

| Area | Files |
|---|---|
| DB | `src/db/migrations/0028_partner_locations.sql`, `meta/_journal.json`, `src/db/schema/partner-locations.ts` |
| Server | `src/lib/partner-locations/{shared,flag,public,admin,actions}.ts`, `src/lib/validation/partner-locations.ts`, `src/lib/env-guards.ts` + `env.ts` (mock guard) |
| Public UI | `src/components/site/home/locations/{section,explorer,use-locations-map,labels}.tsx/ts`, `locations.css`, `src/app/page.tsx` (one import, one line) |
| Map | `src/components/maps/{map-style,load-maplibre}.ts`, `public/vendor/maplibre-gl-6.16.0/` |
| Admin UI | `src/components/admin/{partner-locations-manager,location-pin-map}.tsx`, `src/app/(admin)/admin/partners/[partnerId]/page.tsx` |
| Copy | `src/messages/site/{ka,en}.json` → `landing.locations`, `src/messages/{ka,en}.json` → `admin.locations` |
| Security headers | `src/lib/security/csp.ts`, `next.config.ts` (geolocation=(self)) |
| Scripts/tests | `scripts/verify-partner-locations.ts`, `scripts/dev-seed-partner-locations.ts`, `e2e/partner-locations.spec.ts`, `eslint.config.mjs` (ignore `public/vendor`) |

## Before going live

1. Merge Our Song (0022), then rebase this branch onto the verified production
   revision. Resolve the journal, CSP and package.json conflicts described
   above.
2. Re-run `verify:partner-locations`, `verify:data-api-lockdown` and the e2e
   suite on the rebased branch.
3. Apply `0028` in production. This is an approval-gated deploy step.
4. Add real partner branches in the admin. Use the shop's actual entrance,
   check it in Google Maps, verify, then publish. The section appears on the
   home page only after the first location is public.
5. Never set `PARTNER_MAP_MOCKS` on Render. Boot refuses it anyway.

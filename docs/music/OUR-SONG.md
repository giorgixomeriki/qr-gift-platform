# "Our Song" / „ჩვენი სიმღერა" — Spotify song or playlist on a greeting

Status: implemented on `feat/our-song-music` (branched from live `1371844`). **Not deployed.**
Embedded Spotify playback: **OFF** (feature flag), pending Spotify's confirmation (see §4).

## 1. What it does

- **Sender (Create step, Signature UI):** an optional "Our song" field under Memories.
  Paste a Spotify **track** or **playlist** link → validated instantly (KA/EN reasons) →
  saved to the draft at once. Saved row: kind, "Open in Spotify" (to check it), Replace, ×.
  One per greeting; adding again replaces it. No Spotify account needed.
- **Preview / checkout:** contents line lists "song"; "See it as the recipient" shows the
  same keepsake as the recipient.
- **Recipient:** one extra beat after voice ("Our Song" card: cream stock, burgundy record,
  gold label, gold hairline) and a numbered keepsake in the closing. One action:
  **Listen on Spotify** → `https://open.spotify.com/<kind>/<id>` in a new tab (the
  Spotify app opens where installed via universal/app links). A quiet note says Spotify
  may ask to sign in and that the item may no longer be available.
- Greetings without a song render exactly as before (no beat, no keepsake).

## 2. Data model

No schema change. `greeting_content` row: `type = 'music'`, `slot = 0`, `status = 'READY'`,
`text_value = 'spotify:<track|playlist>:<22-char base62 id>'`.

- Migration `0022_music_content_type.sql`: data-only `INSERT` of the `content_types` row
  `('music','link')` (FK target), idempotent; also in `db/seed.ts`.
- `SUPPORTED_CONTENT_TYPES` gains `"music"` (not a media/upload type).
- RLS: `greeting_content` policies are per greeting, not per type → unchanged and already
  correct (edit only while DRAFT with the edit token; public read only when ACTIVE).
- Never stored: the sender's raw input, titles, artwork, audio, or anything fetched from Spotify.

## 3. Security

- `src/lib/music/spotify.ts` reduces input to `{kind, id}`; every emitted URL is rebuilt
  on the fixed origin `https://open.spotify.com`. Sender text never reaches an `href`/`src`.
- Accepts `open.spotify.com` / `play.spotify.com` (incl. `/intl-xx/`, `?si=`, `/embed/`)
  and `spotify:track|playlist:<id>`. Rejects other hosts and look-alikes, `spotify.link`
  short links (redirects are not followed — no SSRF), albums/artists/podcasts, credentials,
  ports, non-http(s) schemes, whitespace/control chars, malformed ids, > 512 chars.
- Server re-validates (`setGreetingMusic`), checks the edit token, rate-limits
  (20/min/greeting), serializes per greeting (advisory lock → always exactly one row).
- Stored values are re-parsed strictly on every read; anything non-canonical = no music.
- CSP unchanged while the flag is off (frames fall back to `default-src 'self'`). With the
  flag on, only `frame-src https://open.spotify.com` is added.

## 4. Spotify compliance (reviewed 2026-11-19)

Sources: Developer Policy (eff. 15 May 2025), Developer Terms v10 (eff. 15 May 2025),
Embeds docs + iFrame API reference, Design guidelines, Widget Terms v2.0 (27 May 2014).

| Topic | Finding | What we do |
|---|---|---|
| Commercial use | Policy IV.2: "commercial uses are not permitted for SDAs"; III.10 "Spotify is for personal, non-commercial use". | We are not a Spotify SDA: no API, no SDK, no client id, no streaming. A plain link only. |
| Embeds | Embeds page: "By using Spotify Embeds, you accept the Spotify Developer Terms". Widget Terms IV.3(e): the *Play Button* "may not be used for commercial purposes". No page explicitly clears embeds in a paid product. | **Embed disabled** (`SPOTIFY_EMBED_ENABLED` unset). |
| Premium | Policy IV.1: streaming only for Premium subscribers. Logged-out/free behaviour of the embed is not documented. | We never promise playback, full songs or autoplay. |
| Caching | Terms IV.3: don't store/cache Spotify Content; Widget Terms IV.2(c). | Only the id is stored; no metadata/artwork/audio. |
| Linking / wording | Design guide allows "OPEN SPOTIFY / PLAY ON SPOTIFY / LISTEN ON SPOTIFY". Logo must be unmodified, ≥ 70 px, green only on black/white. | Text-only "Listen on Spotify" (no logo — our cream/burgundy surfaces can't host the logo per the colour rules). |
| Naming | App name must not include "Spotify". | The feature is "Our Song". |

This is an engineering reading of the published terms, not legal advice. The link-only
mode is the conservative choice: it shows no Spotify Content (the design guide's
"attribute content from Spotify with the logo" applies to displayed metadata/artwork,
which we don't show). The owner's legal review should confirm before launch.

**To enable the embed** (`SPOTIFY_EMBED_ENABLED=1` on the server; no rebuild): get written
confirmation from Spotify (developer support / partner contact) that showing the official
embed inside a greeting customers pay for is permitted under the Developer Terms + Widget
Terms. Ask specifically: (1) is the iFrame embed a "Widget" under the Widget Terms; (2)
does Widget Terms IV.3(e) or Policy IV.2 apply when the embed is one optional element of a
paid personalised greeting; (3) attribution requirements. Keep the reply in `docs/legal/`.

When enabled, the embed is loaded **only on tap** ("Play here"), never on open. Its
controls can't be driven without Spotify's script, so coexistence is explicit: opening it
pauses page audio/video; any voice/video starting closes it (which stops it).

## 5. Audio coexistence

Nothing autoplays (unchanged for voice/video, and the song is a link). "Listen on
Spotify" pauses any playing voice note / video before leaving. No audio is ever synced to
the envelope or animations.

## 6. Known limitations

- `spotify.link` short links are refused with guidance (open, then copy the full link).
  Resolving them server-side would mean following redirects — deliberately not done.
- No title/artwork on the card (would require fetching and displaying Spotify Content).
- Legacy wizard (`SIGNATURE_UI=0`) has no music field; a saved song is still preserved and
  rendered.
- No analytics event for music in v1 (avoids touching the analytics taxonomy).
- Availability can't be checked without Spotify's API; the recipient card carries the fallback note.

## 7. QA

`npm run verify:music` (parser/CSP, 65 checks), `npm run verify:music-db` (real DB + RLS,
20 checks), `e2e/our-song.spec.ts` (8 tests: invalid links, persist/replace/remove,
music + photo + video + voice, Preview/checkout, activation, recipient EN/KA, Pixel 7
Chromium, iPhone 13 WebKit). Emulated devices only — not a physical-device test.

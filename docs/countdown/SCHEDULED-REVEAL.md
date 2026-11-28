# Scheduled Reveal + Celebration Countdown

Branch `feat/scheduled-reveal-countdown-0030` (on `release/legal-guard-model-c`, base prod `ed81138`). Migration **0030** — after Refund Model C's 0029, whose `app_greeting_refund_suspended()` it reuses for the SUSPENDED state (owner assigned 0029 to Model C, 2026-11-26).
Not deployed. No production database, payment or BOG setting was touched.

## What it does

| | Scheduled Reveal | Celebration Countdown |
|---|---|---|
| Sender sets | date, time, time zone | occasion, name, date, time, zone, style (3), optional line |
| Recipient before | locked envelope tied with a ribbon + live countdown; no greeting data in the page | — |
| Recipient after | the ribbon slips off, "It's time", the page asks the server and the real envelope is there to open | its own beat after the memories, before the ending |
| At zero | the server decides; the page never unlocks itself | "Today is the day" for 24 h, then "This day has come" — never negative numbers |

Both are independent and can be combined (the countdown must fall after the opening; the server refuses otherwise).

## Security model

One authority: `app_greeting_public_state(greeting_id)` (SECURITY DEFINER, database clock):

- `OPEN` — ACTIVE greeting, ACTIVE QR, unlock reached, not refunded
- `SCHEDULED` — as OPEN but `unlock_at > now()`
- `SUSPENDED` — **Refund Model C**: an order REFUNDED and no PAID order. Checked *before* the schedule, so a countdown or unlock can never re-open a refunded greeting. Content is retained.
- `UNAVAILABLE` — anything else

Enforced in four places, all on the same clock:
1. `resolveQrState` → `scheduled` / `suspended` resolutions (page shows lock / suspended notice).
2. `loadActiveGreetingForRecipient` and `signRecipientVoiceUrl` re-check — no content row read, no signed media URL while not OPEN.
3. **RLS**: the public branch of `greeting_content_select` requires `= 'OPEN'` (scoped `TO app_runtime`, as 0020 requires). Even a bug in app code cannot read a locked greeting's content.
4. `loadScheduledGreetingShell` returns only theme, moment, zone and the DB clock (verified: no message/countdown/media in the payload).

Schedule is editable only while DRAFT (edit token + existing RLS) and **frozen by trigger** afterwards (even for the superuser). Conversion from wall time to instant happens on the server; a skipped DST hour is refused, a repeated hour resolves to the first occurrence.

Clock: the countdown anchors on the server's `now()` and advances with `performance.now()` — changing the phone's clock does nothing (e2e sets it a year ahead). After sleep, the wall/monotonic gap is added; the lock screen also re-renders from the server on return. Unlock is always a server round trip (`?from=lock`); if the device was early, the server answers "not yet" with a fresh clock.

Refund Model C note: it was not implemented anywhere in code before this branch. Here it is the access rule above only (no change to refund/payment code). Prod has 0 refunded orders, so no existing greeting changes behaviour.

## Design

- **Lock screen** is the greeting's own opening: same room, same envelope, same position — tied with a satin ribbon in the world's accent. At the moment the ribbon is drawn away and the line crossfades to "It's time"; the greeting arrives with `data-continuation` so the envelope doesn't "drop" again.
- **Three countdown directions** (each carries its own material, so it works in all 7 worlds, light or dark):
  - *Editorial* — printed page, Newsreader, days set large, h/m/s as a quiet ruled row, dateline; digits roll.
  - *Atelier* — ivory stationery with paper tooth, champagne double rule, drawn ornament, Cormorant; digits dissolve.
  - *Midnight* — charcoal plate, gilded lining numerals that catch the light as they change, spaced capitals, one pool of light.
- Georgian: no uppercase (would become Mtavruli), Noto Serif Georgian, „…“ quotes, genitive city names ("თბილისის დროით"). Date names come from our own tables (headless/older browsers lack Georgian locale data → hydration mismatch and English months).
- Sender: native date/time inputs (system wheels on iOS/Android, accessible), 16px to avoid iOS zoom, live miniatures of the three styles, autosave, Continue explains when a countdown is half-filled.
- Reduced motion: no ribbon/digit/arrival animation; the unlock still happens.
- Accessibility: `role="timer"` with a label updated once a minute; ticking digits are decorative; switch is `role="switch"`; radios are real inputs.

## Libraries

No dependency added. Evaluated:

| Library | Licence | Decision |
|---|---|---|
| Motion 12 (in repo) | MIT | Not used: it is lazy-loaded only for Luxury Vintage; using it here would pull its runtime (tens of kB) into every recipient page. CSS keyframes do the three digit transitions. |
| GSAP 3.15 (in repo) | GSAP standard no-charge licence | Not needed for these motions. |
| NumberFlow (`@number-flow/react`) | MIT | Strong runner-up for digit rolls; rejected to keep per-style transitions and zero new weight. |
| Motion+ AnimateNumber | paid | Not used. |
| Magic UI NumberTicker, Aceternity, React Bits counters | MIT / MIT + Commons Clause | Generic look (count-up tickers), not countdowns; not adopted. |
| shadcn/ui + Radix, react-day-picker | MIT | Not adopted: native date/time pickers are better on phones; the Signature UI has its own tokens. |

## Tests

- `npm run verify:scheduled-reveal` — 84 checks: DST/zone arithmetic, bounds, stored-countdown validation, real draft→paid→activated greetings, lock/RLS-as-app_runtime/media signer, exact-instant unlock, freeze trigger, both features, repeated scans, Refund Model C through the real admin refund service.
- `npx playwright test -c playwright.countdown.config.ts` — 5 tests × desktop Chromium, Pixel 7 (reduced motion), iPhone WebKit: full sender flow with payment, lock with device clock +1 year, automatic unlock into the envelope and countdown beat, refund suspension, 320 px layout. Isolated config (no globalSetup — it resets the shared dev admin's MFA).
- Lab: `/lab/countdown/{sheet,beat,scheduled}` (404 unless `NEXT_PUBLIC_LAB=1`).

## Deployment plan (needs owner approval at each gate)

1. Owner reviews the design (screens / lab).
2. Ship only after the Legal Guard + Model C release (0029) is live; rebase on the then-live prod (journal `when` 1795766400000 must exceed the last applied).
3. Verified backup (`pg_dump` via ops-env), ledger fingerprint.
4. Apply 0030 (additive; requires 0029; old code keeps working with it: RLS hides content only for a future `unlock_at`, which old code cannot create, or a REFUNDED order, of which prod has none).
5. Deploy the code. Smoke: an immediate greeting opens; a TEST/admin scheduled greeting on a test card shows the lock; RLS check as app_runtime.
6. Rollback: redeploy the previous Render deploy, then `docs/countdown/rollback-0030.sql` (refuses while scheduled greetings are pending; restores the exact 0029 state — Model C's function and policy are kept).

## Known limits

- No real-device runs yet (emulated Chromium/WebKit only).
- Legacy wizard (`SIGNATURE_UI=0` rollback path) has no timing UI; its greetings simply open immediately.
- No "add to calendar" for the recipient (follow-up).
- `localStorage`/push reminders not in scope; the recipient must scan again or keep the page open.

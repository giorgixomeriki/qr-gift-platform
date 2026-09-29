# Mobile QA Execution Matrix

A literal, fill-in-the-blanks execution sheet for `docs/MOBILE_QA_CHECKLIST.md`
— one row per scenario, structured so a human tester can run it directly and
record a real result. This document contains **zero completed rows**: no
device testing has been performed as part of this engagement. Every "Pass/Fail"
cell below is a template column, not a claim.

Duplicate the "Device / OS / Browser" block once per physical device tested
(per the checklist's own "repeat for BOTH devices, in BOTH ka and en"
requirement — that's a minimum of 4 full passes: iPhone×ka, iPhone×en,
Android×ka, Android×en).

## Device / OS / Browser block (fill in per run)

| Field | Value |
|---|---|
| Device model | |
| OS version | |
| Browser + version | |
| Locale tested (ka / en) | |
| Tester name | |
| Date | |
| QR token / partner used | |

## Scenario table

| # | Precondition | Steps | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|---|
| 1 | A real printed QR card from an actual batch export | Scan with the phone's native camera app (not a screen-displayed code) | Camera recognizes the code and offers to open the link | | |
| 2 | Scenario 1 passed | Tap the camera's detected link | Opens in the phone's default browser, lands on Sender Entry | | |
| 3 | On Sender Entry | Observe layout at natural phone width | No horizontal scroll, no clipped text, tap targets comfortably sized | | |
| 4 | On Sender Entry | Tap the locale switcher | Whole page re-renders in the chosen language without a manual reload | | |
| 5 | In the creation wizard's message step | Type a message including Georgian characters if testing `ka` | On-screen keyboard doesn't cover the input/Continue button; autocorrect behaves reasonably | | |
| 6 | In the theme step | Tap through theme options | No accidental double-selection; selection is visually clear | | |
| 7 | In the media step | Upload a photo via "choose existing" (gallery) | Pick → upload progress → thumbnail appears | | |
| 8 | In the media step | Upload a photo via live camera capture | Same as above, using the live camera instead of gallery | | |
| 9 | In the media step | Upload a video file | Upload completes; note file size and time taken on real mobile data | | |
| 10 | In the media step | Start a voice recording | Browser's microphone-permission prompt appears | | |
| 11 | Permission granted | Record, then play back before finalizing | Audio actually captured — verify by listening, not by assuming | | |
| 12 | Permission prompt shown | Decline the microphone permission | Clear, non-crashing fallback ("or upload a file" path) appears | | |
| 13 | All content added | Reach the Preview step | Photo/video/voice all play back correctly with real device audio (not muted) | | |
| 14 | At checkout | Observe layout | Renders correctly at phone width | | |
| 15 | At checkout, TEST provider | Simulate a payment | Transitions to the Recipient/Sender-success view | | |
| 16 | At checkout, real provider configured (if applicable at test time) | Complete a real-provider hosted payment page flow on mobile | Provider page is usable; returning lands back on this app correctly | | |
| 17 | Greeting activated | Open as a genuine recipient (different device/session than the sender) | Full reveal sequence (opening → message → photo → video → voice → ending) plays on real phone speaker | | |
| 18 | Reveal sequence finished | Tap "Watch again" | Replay works from the start | | |
| 19 | Mid reveal sequence | Rotate the phone to landscape and back | Layout doesn't break; reveal doesn't restart unexpectedly | | |
| 20 | Weak/throttled network (phone's own throttling, airplane-mode-reconnect, or a real weak-signal spot) | Start a media upload | Shows real progress; recovers from a brief drop rather than silently failing | | |
| 21 | Weak/throttled network | Submit checkout | Does not double-submit; button disables while pending | | |
| 22 | Weak/throttled network | Let a request genuinely time out | Real error message shown, not a blank screen | | |
| 23 | Any network | Rapidly retry a failed upload/checkout many times in a row | Eventually shows the rate limit's friendly "too many requests" message, not a crash or blank screen (new control — see `docs/OBSERVABILITY.md`/Phase 1 of the pilot-readiness pass) | | |
| 24 | Sender revisits their own already-activated Greeting | Open the same QR link again as the original sender | Small "your gift is live" banner shown; cannot re-edit | | |

## Honest reporting

Every row must end as PASS, FAIL (with what happened and a screenshot if
visual), or NOT TESTED (with why — e.g. "no Android device available this
cycle"). A row marked NOT TESTED is more valuable and more honest than a row
checked off without the device work actually happening. This matrix, as
delivered, has all 24 rows × however many device/locale combinations
untested — that work is explicitly still required before the pilot goes
live with real hardware in the field.

# Real-Device Mobile QA Checklist

Browser automation in this project cannot genuinely verify narrow mobile
viewports or hardware permissions (microphone, camera) — `resize_window`
does not change the actual rendered viewport, and there is no real
microphone/camera to grant. **Every box below must be checked on an actual
phone before it is marked done.** Do not check a box because the equivalent
desktop-browser flow worked, and do not check a box "by inspection of the
code" — these are pass/fail on real hardware only.

Record, for each run: device model, OS version, browser + version, date,
tester name, and the QR token or partner used. Attach screenshots for any
failure.

## Devices to cover

- [ ] iPhone, Safari (most recent iOS, and if available one OS version behind)
- [ ] Android, Chrome (a mid-range device, not just a flagship — this is
      what most recipients will actually be holding)

## Golden path — repeat for BOTH devices above, in BOTH ka and en

### Scan and entry
- [ ] Scan a real printed QR code (not a screen-displayed one — actual paper,
      actual lighting) with the phone's native camera app
- [ ] The camera's QR-detected link opens correctly in the default browser
- [ ] Sender Entry renders correctly at the phone's actual width (no
      horizontal scroll, no clipped text, tap targets are comfortably sized)
- [ ] Locale switcher (ქარ / EN) works and the whole page re-renders in the
      chosen language

### Creation wizard
- [ ] Typing in the message field: the on-screen keyboard doesn't cover the
      input or the Continue button; autocorrect/autocapitalize behave
      reasonably for Georgian and English text
- [ ] Theme selection is comfortable to tap (no accidental double-selection)
- [ ] Photo upload via **"choose existing photo"** (camera roll / gallery)
      works end to end (pick → upload progress → thumbnail appears)
- [ ] Photo upload via **live camera capture** (not just gallery) works
- [ ] Video upload (existing file) works; note actual file size and upload
      time on a real mobile connection
- [ ] Voice recording: the browser's microphone-permission prompt appears
      and can be granted
- [ ] After granting permission, recording actually captures audio (play it
      back before finalizing) — do not assume it worked without listening
- [ ] Declining the microphone permission shows a clear, non-crashing
      fallback (the existing "or upload a file" path)
- [ ] Preview step plays back photo/video/voice content correctly with
      real device audio (not muted, not silently failing)

### Checkout and activation
- [ ] Checkout screen renders correctly at phone width
- [ ] (TEST provider) Simulated payment completes and the page transitions
      to the Recipient/Sender-success view
- [ ] (If a real provider is configured by the time this is run) the
      provider's own hosted payment page is usable on a real mobile browser,
      and returning from it lands back on this app correctly

### Recipient experience
- [ ] Full reveal sequence (opening → message → photo → video → voice →
      ending) plays correctly on a real phone speaker
- [ ] "Watch again" replay works
- [ ] Rotating the phone to landscape and back does not break layout or
      restart the reveal from the beginning unexpectedly

### Network conditions
- [ ] Throttle the connection (phone's own "weak network" / airplane-mode-
      then-reconnect testing, or a real weak-signal location) and confirm:
  - [ ] Media uploads show real progress and recover from a brief drop
        rather than silently failing
  - [ ] Checkout does not double-submit if the network is slow (button
        disables while pending)
  - [ ] A timed-out request shows a real error message, not a blank screen
  - [ ] Repeatedly retrying a failed upload/checkout in quick succession
        (e.g. tapping retry many times on a flaky connection) eventually
        shows the rate-limit's friendly "too many requests, try again
        shortly" message rather than a generic crash or blank screen — this
        is a new server-side control added in the pilot-readiness pass and
        has not yet been exercised on real hardware

## Honest reporting

For each box, write PASS, FAIL (with what happened), or NOT TESTED (with
why — e.g. "no Android device available this cycle"). A checklist with
"NOT TESTED" rows is more valuable and more honest than one where every box
is checked without the device work actually happening.

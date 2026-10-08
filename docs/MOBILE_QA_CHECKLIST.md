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

## Mobile Experience pass — real-device acceptance (2026-10)

Software-side fixes from the Mobile Experience pass that browser emulation
could exercise only partly. Run on **a real iPhone in Safari** (ideally one
small/older and one 6.1"+ with Dynamic Island) and **a real mid-range
Android in Chrome**, in ka and en. About 25 minutes per device.

### Viewport, safe areas, browser chrome
- [ ] Every screen, portrait: nothing under the notch/Dynamic Island, the
      home indicator or Android's navigation bar; primary action reachable
      with the thumb without scrolling on Entry and Theme Picker
- [ ] Scroll a long Checkout so Safari's toolbar collapses and expands:
      the sticky Pay button never jumps or hides behind the toolbar
- [ ] Rotate to landscape on Entry, Message, Preview and the recipient
      reveal (iPhone with the notch on the left, then the right): text and
      buttons stay clear of the notch; Open/Continue remain on screen
- [ ] Recipient reveal on a dark world (Romantic, Celebration): pull down
      and up hard — no cream strip appears (iOS rubber-band); Android's
      toolbar takes the world's colour, and returns to cream after leaving
- [ ] Theme Picker: the Android toolbar follows the chosen world's room

### Keyboard
- [ ] Message step, Georgian keyboard then English, emoji, paste a long
      text, switch keyboard language mid-sentence: the caret stays visible
      while typing at the end of a long message
- [ ] Android: with the keyboard open, Continue sits just above it
- [ ] iPhone: the keyboard covers Continue (expected); "Done" restores the
      layout with no jump and no zoom-in on focus
- [ ] Type a message, switch to another app for a minute (or lock the
      phone), come back — even after the tab reloads, the text is still there

### Touch and motion
- [ ] Double-tap "Open" on the sealed greeting: the message is shown, it is
      not skipped
- [ ] Tap Continue rapidly through photo beats: each tap moves exactly one beat
- [ ] Ending: the finale finishes before "Watch again" (and in Preview the
      Activate button) rises in — never during it
- [ ] Android only: a faint tick when breaking the seal and when starting/
      stopping a recording (none on iPhone — expected)
- [ ] Settings → Accessibility → Reduce Motion ON: every world still opens
      to a finished, beautiful state; nothing needed is missing

### Media
- [ ] Photo from camera and from library (incl. an iPhone HEIC and a large
      Android photo): the tile reacts instantly (preparing), then progress
- [ ] Turn on airplane mode mid-upload: the tile keeps the photo with Retry;
      turn it off, tap Retry once — it completes without re-picking
- [ ] Cancel an upload in progress (X on the tile): the slot is empty again
- [ ] Replace an existing photo with airplane mode on: the current photo stays
      on the tile throughout ("Your current photo is kept"), Retry works once
      back online; reload mid-replacement still shows the current photo; Preview
      shows the new photo only after it finished uploading
- [ ] Checkout with a long message full of emoji (ka and en): two clean lines
      ending in "…", no emoji fragment under the second line, none cropped at
      the top
- [ ] Portrait phone video in the reveal: shown at its own portrait shape,
      no black side bars; inline playback (not forced fullscreen on iPhone)
- [ ] Voice: deny the mic → clear fallback; allow → record; receive a phone
      call (or open Siri) mid-recording → the recording stops and is kept,
      playable, with the right length
- [ ] Record a voice note on Android and play it on the iPhone (and the
      reverse): it plays on both
- [ ] Voice playback on mobile data: the play button shows a spinner until
      sound starts; the waveform tracks the voice smoothly

### Network
- [ ] Wizard steps on a weak connection: Back/Continue between Theme,
      Message and Media respond instantly; Android back gesture returns to
      the previous step, not out of the flow
- [ ] A card page that fails on the server (ask a developer to stop the
      database briefly on staging) shows the calm "Something went wrong /
      Retry" screen in the right language, never a raw error page. (A full
      reload while completely offline shows the browser's own offline page —
      expected; there is no service worker.)

## Honest reporting

For each box, write PASS, FAIL (with what happened), or NOT TESTED (with
why — e.g. "no Android device available this cycle"). A checklist with
"NOT TESTED" rows is more valuable and more honest than one where every box
is checked without the device work actually happening.

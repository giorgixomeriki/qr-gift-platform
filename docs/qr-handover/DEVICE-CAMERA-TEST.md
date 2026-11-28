# Real-device camera test — Admin QR scanner

Automated tests used a fake camera (Chromium) and manual entry (WebKit). This checklist is the real-device
verification. Run it once on **Android + Chrome** and once on **iPhone + Safari**, signed in as the admin
(MFA) at `https://qrapp.ge/admin/inventory` → *QR ბარათების სკანირება და მინიჭება*.
Use the printed smoke/central-stock cards. Record: device, OS version, browser version, PASS/FAIL, notes.

| # | Check | Expected |
|---|---|---|
| 1 | Open the scanner from Inventory (tap the button) | Scanner page loads; *კამერის ჩართვა* button visible |
| 2 | Tap *კამერის ჩართვა*, choose **Allow** | Rear camera preview with frame; no reload needed |
| 3 | Scan card 1 | Green flash + "✓ QR ამოცნობილია და დაემატა"; counter 1 / 20; Android vibrates (iPhone: no vibration, by OS design) |
| 4 | Keep camera on, scan cards 2…N one after another (20 if available) | Each adds within ~1 s; no camera restart; counter correct |
| 5 | Hold card 1 in view again | "ეს ბარათი უკვე დამატებულია"; count unchanged |
| 6 | Scan any non-QR STARR QR (e.g. a shop QR) | "ეს არ არის QR STARR-ის ბარათი"; nothing added; no navigation |
| 7 | Scan a card of another holder after the first card | Refused: "ბარათი ეკუთვნის … — ამ გადაცემის წყარო სხვაა" |
| 8 | Switch camera button (if 2+ cameras) | Front/rear switch; scanning continues |
| 9 | Low light / slight angle / card crease | Still decodes; note how many tries |
| 10 | Airplane mode on, scan a new card, airplane mode off | Warning "კავშირის პრობლემა…"; card checks automatically when back online |
| 11 | Remove one card from *არჩეული ბარათები* | Count drops; card can be re-scanned |
| 12 | Leave to Inventory and come back | Selection kept |
| 13 | *არჩევის დასრულება* → From/partner/count correct → create | "გადაცემის მოთხოვნა შექმნილია" |
| 14 | Lock the phone during scanning, unlock | Camera stops while hidden; tap *კამერის ჩართვა* to resume |
| 15 | Deny test: browser site settings → Camera **Block** → reload → start | "კამერაზე წვდომა უარყოფილია" + retry; manual entry still works. Re-allow afterwards (Android: lock icon → Permissions; iPhone: Settings → Safari → Camera, or aA → Website Settings) |
| 16 | Open any public page (e.g. `/`) and a card `/g/…` URL | No camera prompt anywhere outside the scanner |

Pass criteria: 1–14 and 16 PASS on both devices; 15 shows the recovery message on both.

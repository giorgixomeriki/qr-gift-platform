# BOG website readiness report (2026-11-07)

Scope: the public site as it would look after this branch is deployed **with the owner-approved `MERCHANT_*` values** (`MERCHANT_PROFILE_FINAL.md`). BOG publishes **no** website checklist (`BOG_MERCHANT_REQUIREMENTS.md`, finding C1/C3). The items below are card-scheme and consumer-law practice (C2), which BOG may check during its ≤3-working-day review.

Evidence: 58/58 page/locale/viewport checks (KA+EN × mobile 390 px + desktop 1280 px, `next dev` with the owner values on the isolated DB `qr_bog_integration`). Screens and `visual-results.json` are in `/Users/Shared/qr-starr-device-tests/2026-11-06-bog-readiness/screens/` (outside the repo, which is public). Re-run on the committed tree: see `PRODUCTION_RELEASE_CHECKLIST.md` §Tests.

## Page matrix

| # | Page | KA | EN | Status | Remaining |
|---|---|---|---|---|---|
| 1 | Landing `/` | ✓ | ✓ | READY | — |
| 2 | About `/about` | ✓ | ✓ | READY | — |
| 3 | How it works `/how-it-works` | ✓ | ✓ | READY | M1 payment-method wording (in Service doc) |
| 4 | Pricing `/pricing` | ✓ | ✓ | READY | 10 ₾, VAT not-registered notice, no "VAT included". Open: M1, M2 |
| 5 | Contact `/contact` | ✓ | ✓ | READY (partial identity) | Seller name, email, phone, hours, VAT and the contact address (labelled as such) are shown. **ID code and registered legal address pending** (W1). M6 response time |
| 6 | Terms `/terms` | ✓ | ✓ | DRAFT, "not yet in effect" | Seller, 18+, 12-month availability, technical-failure refund present. Lawyer review items + D6 |
| 7 | Privacy `/privacy` | ✓ | ✓ | DRAFT, "not yet in effect" | Controller, categories, Render + Supabase (Frankfurt) as processors, no auto-deletion claim. Lawyer review + D1, D8, M4 |
| 8 | Delivery & Refunds `/delivery-and-refunds` | ✓ | ✓ | DRAFT, "not yet in effect" | Payment outcomes, technical failure → recover then full refund, complaints, interruptions/expiry. Lawyer review (withdrawal right, deadlines) + M5, M6, C4 |
| 9 | Checkout (`/g/<token>` pay step) | ✓ | ✓ | READY in code; **disabled in prod** (`CHECKOUT_ENABLED=false`, provider TEST) | Brand + seller, total in ₾, VAT line, 18+ line, Terms/Privacy/Refunds links. No consent checkbox (legal question D3) |
| 10 | Payment success / failed / cancelled / pending | ✓ | — | READY (simulated provider) | Real BOG redirects not yet exercised (needs sandbox). E3 payment reference on success screen still open |
| — | Footer | ✓ | ✓ | READY | Confirmed seller details + policy links on every site page |
| — | Expired greeting screen | ✓ | ✓ | NEW | 12-month rule, neutral message, nothing deleted |

## Card-scheme style items (C2)

| Item | Status |
|---|---|
| W1 Legal name / form / ID code / address | **Partial**: name + form shown; ID code + legal address pending registry extract |
| W2 Customer-service contact | DONE (email, phone, hours) |
| W3 Country + correspondence address | DONE (contact address, Georgia) |
| W4 Service description | DONE |
| W5 Refund / cancellation policy before purchase | DONE in copy + linked at checkout; **needs lawyer sign-off** |
| W6 Delivery policy (digital, immediate) | DONE |
| W7 Prices in GEL | DONE |
| W8 Terms | Drafted, needs lawyer sign-off + `LEGAL_EFFECTIVE_DATE` |
| W9 Privacy notice | Drafted, needs lawyer sign-off |
| W10 HTTPS | DONE (qrapp.ge) |
| W11 Card / BOG logos | NOT DONE: ask BOG which marks are required (C3) |
| W12 Receipt to customer | On-screen confirmation only; fiscal-receipt question for accountant (C3) |
| W14 Site complete and reachable during review | Reachable. Policies still "not yet in effect"; whole site is `noindex` (`src/app/layout.tsx`): not a known BOG rule, but a reviewer searching for the merchant will not find it. Owner decision |

## Verdict for the website alone

**GO for deploying this branch's merchant-content release** (copy, contact, footer, checkout disclosures, expiry screen) once the owner approves the public values. Checkout stays disabled. **Not yet complete for BOG review**: ID code + registered legal address, lawyer sign-off and `LEGAL_EFFECTIVE_DATE`, and the logo question.

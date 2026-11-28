# Merchant profile: final state (2026-11-07)

Branch `integration/bog-merchant-readiness` (base: production `f819c91` + `feat/merchant-identity-ie` a4d7561 + `docs/bog-merchant-readiness` b609363). Code commit: see `PRODUCTION_RELEASE_CHECKLIST.md`.

**The repository is public.** The owner-confirmed values are therefore kept **outside git**, in `/Users/Shared/qr-starr-device-tests/2026-11-06-bog-readiness/merchant.env` (no secrets in it). They go into the Render environment only after the owner approves the public-facing information. This file records which fields are set, not their values.

## Fields

| Env variable | Status | Source / note |
|---|---|---|
| `MERCHANT_ENTITY_TYPE` = `IE` | SET | Public Registry evidence, registered 2026-10-13 |
| `MERCHANT_LEGAL_NAME_KA` | SET | Registered Georgian name (ინდივიდუალური მეწარმე …) |
| `MERCHANT_LEGAL_NAME_EN` | SET, **provisional** | EN pages show the Georgian registered name first, then the owner-proposed English rendering in brackets. The English form is not yet checked against official English registry or bank documents |
| `MERCHANT_ACTUAL_ADDRESS_KA/EN` | SET | **Contact / operating address**, labelled "Contact (operating) address". Never shown as the legal address |
| `MERCHANT_LEGAL_ADDRESS_KA/EN` | **PENDING** | The registered address is the older registry address. Needs the official extract; never guessed |
| `MERCHANT_ID_CODE` | **PENDING** | 11-digit personal number of the IE. Needs the extract and the owner's consent to publish it |
| `MERCHANT_SUPPORT_EMAIL` | SET | Owner-confirmed |
| `MERCHANT_PHONE` | SET | Owner-confirmed, validated as +995 + 9 digits (any grouping) |
| `MERCHANT_SUPPORT_HOURS_KA/EN` | SET | Mon–Fri 10:00–19:00, Georgia time |
| `MERCHANT_VAT_STATUS` = `NOT_REGISTERED` | SET | Owner-confirmed. Display only, never changes a price |
| `LEGAL_EFFECTIVE_DATE` | **PENDING** | Set only after the lawyer signs off. Until then policies show "not yet in effect" |

`scripts/check-merchant-info.ts` validates the file. Required fields still missing: legal address and ID code, so `complete` stays false. Confirmed details are already shown (Contact page, footer) and missing rows are left out, never invented.

## Business rules implemented

| Rule (owner decision 2026-11-06) | Implementation |
|---|---|
| Price 10 GEL, partner commission 30 %, configurable, historical snapshots immutable | Already in place (`verify:partner-pricing` 70/70, `verify:payment-integrity` 45/45) |
| Not VAT-registered: no 18 % added, no "VAT included" | `MERCHANT_VAT_STATUS`, VAT notice on checkout and in Pricing/Terms via `{{merchant.vatNotice}}`. Basket VAT fields are not sent |
| Greeting available 12 months after payment-verified activation | `src/lib/greetings/availability.ts`, derived from `greetings.activated_at`. No migration, no deletion. Expired codes show a neutral "availability has ended" screen. The recipient API refuses signed media URLs (`verify:greeting-availability` 14/14) |
| Minimum age 18 | Terms "eligibility" section + checkout line. Flagged for legal review: a declaration is not verification |
| Activation only after server-side payment verification | Already in place (payment-integrity, bog-integration suites). Copy in Delivery & Refunds "Payment outcomes" |
| Technical-failure rule: recover first, then full refund + commission reversal | Delivery & Refunds copy; reversals verified by `verify:chargebacks` 22/22 and `verify:payout-items` 49/49 |

## Not invented (open)

M1 payment-method wording, M2 physical-card supply, M4 content-access roles, M5 refund on moderation block, M6 response times, D1 retention periods, D6 court/ADR, D7 report channel, D8 data-request handler, C4 bank refund time. See `LEGAL_CONTENT_REVIEW_KA_EN.md`.

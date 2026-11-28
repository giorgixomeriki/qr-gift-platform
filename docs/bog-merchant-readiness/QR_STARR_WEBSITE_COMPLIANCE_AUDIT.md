# QR Starr website compliance audit (live qrapp.ge)

Audited 2026-11-06 against **live build f819c91** (Render deploy `dep-dbmb6je8bjmc739rvup0`, 2026-11-05 16:51 UTC).

Method:
- Headless Chromium crawl of every public page with `NEXT_LOCALE=ka` and `=en`.
- Code reading on branch `docs/bog-merchant-readiness` (= f819c91).
- Production environment variable **names** read via the Render API. Values were read only for non-secret flags.
- Page text snapshots are in `evidence/qrapp_ge_live_*.txt`.

Statuses: **COMPLETE · PARTIAL · MISSING · OWNER INFO · BANK CONFIRMATION**. Requirement classes (C1/C2/C3) refer to `BOG_MERCHANT_REQUIREMENTS.md`.

## 0. Global findings

| # | Finding | Evidence |
|---|---|---|
| G1 | **No merchant identity anywhere on the site.**<br>Production has no `MERCHANT_*` variables. The footer says "Our registered company details are being finalised…".<br>`/contact` has no email, phone, address or legal name. The public-content rule (PR #16) hides unset values instead of showing markers. | Render env (names): no `MERCHANT_*`; `evidence/qrapp_ge_live_en_contact…txt`; `src/lib/merchant/info.ts`, `src/components/site/merchant-details.tsx` |
| G2 | **Every public page sends `robots: noindex, nofollow`.** The three policies and How it works show a "**Not yet in effect**" draft banner. `LEGAL_EFFECTIVE_DATE` is unset. | crawl log; `docs/merchant/MERCHANT_INFORMATION.md` |
| G3 | Several policy sections are **blank under their heading** (content pending decisions): Terms §2, §5, §11 partly, §12 partly; Delivery §5, §7; Privacy §7, §9, §11. | `evidence/qrapp_ge_live_en_terms…`, `…privacy…`, `…delivery-and-refunds…` |
| G4 | KA and EN have the same structure and links (tested by `verify:site-content` 51/51 today; `e2e/site-pages.spec.ts`). | local run 2026-11-06 |
| G5 | HTTPS: Google Trust Services certificate valid to 2027-01-14; HSTS 2 years, includeSubDomains; http and www redirect 301 to `https://qrapp.ge`; CSP, `X-Frame-Options: DENY`. | curl 2026-11-06 |
| G6 | **Availability.** The service runs on Render **Free**. The first 2 of 20 crawl requests returned **503** (`/`, `/about` in KA); retries returned 200 in 1–2 s. A reviewer can hit a cold start or 503. | crawl log; Render API `plan: free` |
| G7 | Unknown routes 404 (`/refund-policy`, `/faq`). The refund page is `/delivery-and-refunds`. | crawl |

## 1. Pages

| Page (KA + EN) | URL | Status | Evidence / gap |
|---|---|---|---|
| Landing | https://qrapp.ge/ | **PARTIAL** | Product, flow and footer links to all policies are present. No merchant identity (G1). Not indexed (G2). |
| About us | https://qrapp.ge/about | **PARTIAL** | Explains the service, the partner-shop card and the 4 steps. No company identity (who operates QR Starr). |
| How it works | https://qrapp.ge/how-it-works | **PARTIAL** | Limits are rendered from code constants. Draft banner. Retention text pending (D1). |
| Pricing | https://qrapp.ge/pricing | **COMPLETE** (content) · **OWNER INFO** (tax) | "10 ₾ per greeting, one-time activation", read from the `prices` table checkout uses. Partner prices may differ; the card shows its own price before payment. VAT wording withheld until C6 is answered. |
| Contact | https://qrapp.ge/contact | **MISSING** (values) | Page exists, but has no email, phone, address, legal name or hours (G1). |
| Terms | https://qrapp.ge/terms | **PARTIAL** | 12 sections. Blank: who can use (age D2), right of withdrawal (⚖️ D3), courts (D6), prevailing language (⚖️). Draft banner. No merchant name in §1. |
| Privacy | https://qrapp.ge/privacy | **PARTIAL** | Purposes, cookies, rights and security are written. Blank: retention (D1), how to make a request (no contact, D8), children/age (D2). The processor list names Supabase and BOG but **not Render** (hosting, Frankfurt) (M3). No controller identity. |
| Delivery & refunds | https://qrapp.ge/delivery-and-refunds | **PARTIAL** | Digital immediate delivery, no shipping, refund cases (not activated / duplicate) and process are written. Blank: after-activation withdrawal (⚖️), **how to request a refund (no email shown)**, response time (M6), refund timing at BOG (C4). |
| Footer | every public page | **PARTIAL** | Links to About, Contact, How it works, Pricing, Terms, Privacy, Delivery & refunds, plus "All prices are in GEL". Merchant block is a placeholder. No card-scheme/BOG marks (W11, BANK CONFIRMATION). |

## 2. Sender and payment flow (`/g/[token]`)

| Step | Status | Evidence |
|---|---|---|
| QR scan → sender entry | **COMPLETE** | Verified 2026-11-05 on 5 production codes, emulated iPhone/Android, 0 errors. `src/app/g/[token]/page.tsx` |
| Theme selection (7 designs) | **COMPLETE** | same test |
| Greeting creation | **COMPLETE** | same test; limits in `lib/validation/*` |
| Preview | **COMPLETE** | same test |
| Price shown before payment | **COMPLETE** | sender entry `priceLabel` + checkout order slip `checkout-amount` from the server (`signature-checkout.tsx`) |
| Links to Terms / Refund policy at checkout | **MISSING** | No link or consent text in `src/components/greeting/signature-checkout.tsx`, nor anywhere under `src/components/greeting` or `signature` (grep). Known as R11 in `docs/merchant/BOG_WEBSITE_REQUIREMENTS.md`. |
| Consent to immediate digital delivery / loss of withdrawal right | **MISSING** · lawyer decision D3 | Same file |
| Checkout (production) | **Closed by design** | `PAYMENTS_PROVIDER=TEST`, `CHECKOUT_ENABLED=false`, `ALLOW_TEST_PAYMENTS=false` in Render env. Live screen: "გადახდა მალე ჩაირთვება". No order is created (`lib/payments/checkout-gate.ts`). |
| Success / failed / cancelled / still-verifying screens | **COMPLETE** (UI) · **UNVERIFIED with real BOG** | `signature-checkout.tsx` states `checkout-still-verifying`, `payment-failed-message`, `payment-cancelled-message`, retry. Success = `sender-success-banner` (`recipient-view.tsx`). |
| Payment confirmation to customer | **PARTIAL** · BANK CONFIRMATION | On-screen success only. The sender gives no email (no email field or mail sender in `src/`), so there is no emailed receipt and no order reference shown. Whether BOG emails a receipt: C3 (W12). |
| Admin dashboard: sales trace, refund, chargeback, reconcile, pricing | **COMPLETE** (code) | `components/admin/sales-trace.tsx` (refund + chargeback), `reconcile-activations-button.tsx`, `partner-pricing-manager.tsx` |
| Partner dashboard: no greeting content, commissions | **COMPLETE** | RLS 0012, `verify:partner-privacy` |

## 3. Classification against requirements

| Req | Status |
|---|---|
| W1 legal identity | **OWNER INFO** (code done: `MERCHANT_*` env) |
| W2 support contact | **OWNER INFO** |
| W3 merchant country/address | **OWNER INFO** |
| W4 service description | **COMPLETE** |
| W5 refund/cancellation before purchase | **PARTIAL**: policy exists but is incomplete; not linked from checkout |
| W6 delivery policy | **COMPLETE** (wording) / PARTIAL (draft) |
| W7 prices in GEL | **COMPLETE** |
| W8 terms | **PARTIAL** |
| W9 privacy | **PARTIAL** (controller identity, retention, Render processor, request contact) |
| W10 HTTPS | **COMPLETE** |
| W11 logos/marks | **BANK CONFIRMATION** |
| W12 receipt | **BANK CONFIRMATION** + PARTIAL |
| W13 digital-goods rules | **BANK CONFIRMATION** |
| W14 live, complete, non-draft | **PARTIAL**: live and public, but draft banners, noindex and Free-plan 503s |

## 4. Rejection risks (reviewer's view)

1. No legal entity, address or contact on the site. This is the most common reason acquirers send a site back.
2. Policies marked "Not yet in effect" with empty sections; refund page lacks a way to request a refund.
3. Limited refunds after activation, without a pre-payment disclosure or consent at checkout. This is also a chargeback risk.
4. Business model: physical cards from third-party shops that earn commission. BOG may ask whether QR Starr acts for the shops (marketplace / payment facilitation). We don't use split payment; partners are paid by QR Starr from its own revenue (`lib/payments/payouts.ts`). Explain this up front.
5. Reviewer can't see a payment page (checkout closed). Be ready to demo on a sandbox/preview environment.
6. Free-tier cold starts / 503 during review.
7. "Partner sign in" in the public header with demo accounts still live (`demo-admin@`, `demo-partner@qrapp.ge`). Not a BOG rule, but a security and credibility issue.

# ⚠️ DRAFT legal pages: NOT APPROVED, NOT LEGAL ADVICE

Status: **drafts for owner and lawyer review (2026-10-16).** Nothing in this
folder is an approved policy. Nothing here is linked from the app or
published on qrapp.ge. They were written by an engineer (Claude) from the
product's actual behaviour, so that a lawyer has accurate facts to work from.
They are not a legal opinion.

Every `[[…]]` is a placeholder or an open decision. A page must not go live
while any remain. The Georgian texts also need native-speaker proofreading.

| File | Purpose |
|---|---|
| `TERMS_OF_SERVICE.ka.md` / `.en.md` | Terms for senders (customers) and recipients |
| `PRIVACY_POLICY.ka.md` / `.en.md` | Privacy policy, including cookies and the card-as-key model |
| `REFUND_POLICY.ka.md` / `.en.md` | Refund and cancellation policy |
| `COMPANY_DETAILS.md` | Footer and contact block (both languages) |

## 1. Why these pages are needed

| Requirement | Source | Status |
|---|---|---|
| Terms, privacy policy, refund/cancellation policy, delivery description, contact and company details in the footer, prices in GEL, all live on `https://qrapp.ge` | BOG acquiring onboarding (`docs/integration/BOG_MERCHANT_REQUIREMENTS.md` §A.4). BOG's own list governs | Drafted here |
| Personal data processing must be lawful and transparent. Data-subject rights; 72-hour breach notification to the Personal Data Protection Service | Law of Georgia on Personal Data Protection No. 3144 (adopted 14 June 2023, main provisions in force 1 March 2024); supervisor: Personal Data Protection Service | Privacy draft follows the product's real processing. **Lawyer to confirm legal bases, transfers, retention** |
| Pre-contract information for distance sales, and the right of withdrawal and its exception for digital content supplied immediately with consent | Law of Georgia on the Protection of Consumer Rights (2022) | **Unverified by us:** the exact article and wording on the digital-content withdrawal exception must be confirmed by the lawyer. The drafts and the checkout UI depend on it (see D3) |
| Fiscal receipt / VAT for online digital sales | Tax Code of Georgia; BOG question C6 | Open (accountant) |

## 2. Product facts the drafts rely on (verified in code, 2026-10-16)

- **What is sold.** Activating a digital greeting on a physical QR card. A partner (shop) hands out the card. The customer (sender) scans it, writes a message, optionally adds up to 3 photos, a video and a voice recording, chooses a design, previews it, and pays an activation fee. The greeting goes live on that card **immediately** after payment. The recipient scans the same card to open it.
- **Price.** Set by the platform in GEL and shown at checkout before payment. The default is 10.00 GEL; a partner may have a different price. It's a one-time payment with no subscription.
- **Payment.** On Bank of Georgia's hosted payment page. QR Starr never sees card numbers. It stores the amount, BOG's order reference, and the card brand plus last 4 digits.
- **Accounts.** Senders and recipients have **no account**. The sender's editing access is a cookie on their device (`qr_edit_…`, httpOnly, 14 days; after activation it only lets the sender see their own "sent by you" banner). Partners and admins have email/password accounts (Supabase Auth).
- **The card is the key.** Anyone holding an activated card (or its link) can open the greeting. There's no PIN. That is a product decision, and it **must** be stated plainly to senders.
- **No editing after activation.** The greeting is locked once paid.
- **Partners never see greeting content** (`docs/PRIVACY_MODEL.md`). Admins can see it only through moderation, and can block a greeting.
- **Cookies and storage.** `NEXT_LOCALE` (language, 1 year); `qr_edit_<id>` (sender editing access, 14 days, httpOnly); `active_partner_id` (partner accounts only, 90 days); Supabase auth cookies (partner/admin login only); browser `localStorage` key `qrs:message:<id>` (an unsent message draft on the sender's own device, cleared once saved). **No advertising or third-party analytics cookies.** Product analytics are first-party events tied to the card/greeting, with no personal identifier.
- **Technical data.** IP addresses are used for rate limiting and security, and appear in hosting logs.
- **Infrastructure (planned, not yet created):** Vercel (hosting, region Frankfurt `fra1`); Supabase (database and file storage, Frankfurt); Bank of Georgia (payments); Resend (account emails to partners/admins). Vercel, Supabase and Resend are US companies, so international-transfer wording is needed.
- **Retention.** **No automatic deletion is implemented today.** Greetings, media, orders and logs are kept indefinitely until a retention decision is made (D1).

## 3. Decisions the owner must make before publishing

| # | Decision | Draft assumption |
|---|---|---|
| D1 | **Retention**: how long an activated greeting and its media stay available (forever? 1, 2 or 5 years?); unpaid drafts; logs | Placeholders. Engineering must then implement deletion |
| D2 | Minimum age for senders | 16 [[confirm]] |
| D3 | Withdrawal right: rely on the digital-content exception (express consent + acknowledgement **before** payment)? If yes, the checkout needs a consent checkbox, which is a code change | Drafted as relying on it, **pending lawyer** |
| D4 | Refund window and cases beyond the legal minimum (e.g. "not satisfied" within N hours?) | Technical-failure cases only, plus legal rights |
| D5 | Company legal details, contact email/phone, support hours | Placeholders |
| D6 | Governing law and courts; ADR | Georgia; Tbilisi City Court |
| D7 | Content moderation and takedown contact; reporting abusive greetings | `abuse@` placeholder |
| D8 | Data-subject request handling: who answers, within how many days (the law sets the deadline) | Placeholder |
| D9 | Partner agreement (separate B2B contract: commission, payouts, chargebacks, privacy duties from `PRIVACY_MODEL.md`) | Not drafted here |

## 4. Engineering follow-ups these texts create (not done)

1. Footer links to the three pages plus company details, in KA/EN. (`/terms`, `/privacy`, `/refunds` routes are not built.)
2. Checkout: a link to the terms and refund policy next to the pay button, and the D3 consent checkbox if the exception is used.
3. Retention job(s) once D1 is decided.
4. A data-subject request procedure (export / delete a greeting by card), for D8.

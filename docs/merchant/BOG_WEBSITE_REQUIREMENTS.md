# Bank of Georgia merchant website requirements: checklist

This maps the website requirements for Bank of Georgia (BOG) Payment Manager
onboarding to the pages that address them. **It is not a BOG approval and not
a legal opinion.** BOG's own current list governs. It is supplied during
onboarding, and this checklist must be re-checked against it. The requirement
list below comes from our onboarding notes (`docs/integration/BOG_MERCHANT_REQUIREMENTS.md`
§A.4 on the `docs/launch-setup-and-bog-plan` branch, PR #4), plus checks typically
made of e-commerce merchant sites, marked *(typical)*.

Status categories:

- ✅ **Implemented and verified**: built, and checked by an automated test (`verify:site-content`, `e2e/site-pages.spec.ts`).
- 🟡 **Implemented, awaiting merchant approval**: built, but its content depends on a business decision (below).
- 🔴 **Missing information**: needs data only the merchant can supply (`docs/merchant/MERCHANT_INFORMATION.md`).
- ⚖️ **Requires legal review**: marked in the copy, must be confirmed by a lawyer before publication.

Every page shows a **draft banner** ("Draft: not yet in effect") for as long as
it contains a ⚖️ or 🟡 marker or references merchant information that isn't set.
For the three policies, it also shows until `LEGAL_EFFECTIVE_DATE` is set. The
banner disappears only when the markers are removed from the copy after review,
never through a flag.

## 1. Requirement → page

| # | Requirement | Where | Status |
|---|---|---|---|
| R1 | Terms of service | `/terms` (15 sections) | ✅ page, KA+EN · ⚖️ 5 provisions · 🟡 D1, D2, D6, M1, M5 |
| R2 | Privacy policy | `/privacy` (13 sections) | ✅ page, KA+EN · ⚖️ 7 provisions · 🟡 D1, D2, D8, M1, M3, M4 |
| R3 | Refund / cancellation policy | `/delivery-and-refunds` (11 sections) | ✅ page, KA+EN · ⚖️ 2 provisions · 🟡 C4, D4, M2, M5, M6 |
| R4 | Delivery description (digital greeting, activated instantly) | `/delivery-and-refunds` §2–3, `/how-it-works` §5 | ✅ digital delivery verified against the code · 🟡 M2 (physical card distribution) |
| R5 | Contact details and company details in the footer | Footer on `/` and every information page; `/contact` | ✅ footer + page built and tested · 🔴 all merchant details (§3) |
| R6 | Prices shown in GEL | `/pricing` (price card), footer currency line; the card's start screen and checkout already show the price | ✅ read from the `prices` table (same rows checkout uses), never hard-coded; tested against the database · 🟡 C6 (tax wording) |
| R7 | Description of the product/service | `/how-it-works`, `/about` | ✅ limits rendered from the code's own constants |
| R8 | Pages in Georgian and English | All pages, language switcher in the header | ✅ structure, tokens and links identical in both (tested) · Georgian proofreading by a native speaker recommended |
| R9 | Site live and reviewable at `https://qrapp.ge` | — | 🔴 not deployed by this change. Deploying is a separate, approved step |
| R10 | Secure connection (HTTPS) *(typical)* | Production config: HSTS header (`next.config.ts`) | ✅ configured in code. The certificate is the hosting provider's |
| R11 | Refund and terms links reachable before payment *(typical)* | Footer on public pages | 🟡 **not on the `/g/` checkout screen.** Adding policy links (and the D3 consent step, if required) to checkout changes the payment flow and is left to a separate, approved change |
| R12 | Card scheme logos / "payments by Bank of Georgia" mark *(typical)* | — | 🔴 BOG to specify which marks are required and supply the artwork |
| R13 | Customer support contact (email, phone) | `/contact`, footer, each policy's contact section | ✅ built · 🔴 values |
| R14 | Merchant legal identity (name, legal form, ID code, address) | `/contact`, footer, Terms §1, Privacy §1 | ✅ built · 🔴 values |

## 2. Decision register

Each ref below appears as a marker in the copy (`"type": "decision"`).
`verify:site-content` fails if a marker's ref isn't listed in this table.

| Ref | Decision needed | Where it appears | Notes |
|---|---|---|---|
| M1 | **Payment method statement.** Card payment through Bank of Georgia's hosted page is implemented in the stacked PR #6 (`feat/bog-payment-manager-r1`), not on `main`. On `main` the BOG adapter is a stub and production checkout fails closed. Confirm the payment method before publishing, then replace the markers with the final text. | How it works, Pricing, Privacy, Terms | Privacy already names Bank of Georgia as payment processor; adjust if that changes |
| M2 | **Physical card distribution.** The copy states that cards are handed out by partner shops with the gift and that QR Starr doesn't ship anything (true of the product today: there is no shipping feature). Confirm, and decide whether a partner may charge for the card itself. | How it works, Pricing, Delivery and refunds | |
| M3 | **Processors and data locations.** Hosting is Vercel (`vercel.json`, `fra1`) on `main` but Render in PR #10. The email provider (Resend planned), and the Supabase region for production. | Privacy | Supabase and Bank of Georgia are already named |
| M4 | **Staff access to greeting content.** Administrators have technical access through the database; there is no content viewer in the admin UI. State the access policy. | Privacy | |
| M5 | **Refunds and moderation.** Is the fee refunded when a greeting is blocked for a terms violation? Does a refunded greeting stay online? (Today: refunding doesn't take a greeting offline; blocking doesn't refund.) | Terms, Delivery and refunds | |
| M6 | **Support response time** for support and refund requests. | Contact, Delivery and refunds | |
| D1 | **Retention**: how long activated greetings and media stay available; unpaid drafts; payment records; logs. Nothing is deleted automatically today, and the copy says so. | How it works, Privacy, Terms | Engineering must implement deletion once decided |
| D2 | **Minimum age** of senders. | Privacy, Terms | Draft proposal: 16 (PR #8) |
| D4 | **Refund cases beyond the implemented ones** (technical fault, goodwill window). Implemented and stated: not activated / already paid / card paused / duplicate charge. | Delivery and refunds | |
| D6 | **Courts and alternative dispute resolution.** | Terms | Draft proposal: Tbilisi City Court (PR #8) |
| D7 | **Dedicated abuse-report channel.** Today reports go to the support email; there is no in-app report button. | Contact | |
| D8 | **Who handles data-subject requests, and within what deadline.** | Privacy | |
| C4 | **Refund timing at BOG** (BOG question C4). | Delivery and refunds | |
| C6 | **VAT / fiscal status of the price** (BOG question C6, accountant). The copy makes no tax claim until then. | Pricing | |

D3 (withdrawal-right consent before payment) is a ⚖️ marker in Terms §6 and
Delivery and refunds §5. If the lawyer confirms a consent step is needed, it
is a checkout code change (see R11).

## 3. Missing merchant information

A preview deployment can show the pages complete with clearly labelled
**fictional** details (`MERCHANT_PROFILE=demo`, refused on production). That is
for internal review only: demo data is not merchant information, and pages
showing it must not be submitted to BOG as the merchant's site.

See `docs/merchant/MERCHANT_INFORMATION.md`. Run `npm run ops:check-merchant-info`
against an environment to list what is still missing there. Required: legal
name (KA and EN), legal form, identification code, legal address (KA and EN),
support email, phone. Optional: actual address, support hours, a separate
privacy email, and the policies' effective date (set only after legal approval).

## 4. Legal review list (⚖️ markers)

| Page | Provision |
|---|---|
| Terms | Right of withdrawal for immediately supplied digital content (and the pre-payment consent it may require) |
| Terms | Scope and duration of the content licence |
| Terms | Remedies when a technical fault stops an activated greeting opening |
| Terms | Further limitation of liability and its enforceability |
| Terms | Which language version prevails |
| Privacy | Whether a data protection officer is required |
| Privacy | Legal basis for each processing purpose |
| Privacy | Legal basis for transfers to providers outside Georgia; data processing agreements |
| Privacy | Whether strictly necessary cookies need a consent banner |
| Privacy | Full list of data-subject rights, deadlines and exceptions (Law of Georgia on Personal Data Protection) |
| Privacy | Breach notification duties |
| Privacy | Whether material changes need advance notice |
| Delivery and refunds | Withdrawal right after activation (Law of Georgia on the Protection of Consumer Rights) |
| Delivery and refunds | Refusing a refund after activation for a change of mind |

## 5. What the copy states as fact (verified in code on this branch)

- Message required, up to 600 characters. Up to 3 photos (JPEG/PNG/WebP, 15 MB each), 1 video (MP4/MOV/WebM, 100 MB), 1 voice note (recorded up to 60 s, or uploaded MP3/M4A/WebM/OGG, 20 MB). These are rendered from the constants in `lib/validation/*`, so the copy can't drift.
- The number of designs comes from `SELECTABLE_THEMES`.
- Editing access lasts 14 days on the starting device (`EDIT_TOKEN_COOKIE_OPTIONS`). One card holds one greeting; there is no reset or reassign feature.
- Uploaded bytes are checked against the declared type.
- Activation happens only after payment confirmation. Failed payments activate nothing. A second charge on a settled order is returned (`refundCapturedPayment`); a charge for a greeting that can't be activated is routed to a refund (`refundIneligiblePayment`). Partial refunds aren't supported.
- The price is fixed at checkout (order snapshot). A partner-specific price, where configured, overrides the standard one, and the card's start screen and checkout show the applicable price.
- Partners can't see greeting content (RLS 0012, `verify:partner-privacy`). Media is in a private bucket, served through signed URLs that expire after 10 minutes.
- Cookies: `NEXT_LOCALE` (1 year), `qr_edit_<id>` (14 days, httpOnly), `active_partner_id` (90 days), Supabase auth cookies (partner/admin only). Local storage: `qrs:message:<id>`, cleared on save. No advertising or analytics scripts (CSP `default-src 'self'`).
- Analytics events carry no personal identifier.
- **Correction to the PR #8 drafts:** printed cards show no code text (only the QR, logo, headline and partner name), so customers are asked for the card's link, not "the code printed under the QR".

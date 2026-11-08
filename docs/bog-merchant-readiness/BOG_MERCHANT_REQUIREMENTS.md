# BOG merchant requirements: what is official and what is not

Researched 2026-11-06. Product: Bank of Georgia **Online Payments**, requested through **Payments Manager** in **Business Manager** (businessmanager.bog.ge) and integrated with the **Payments API** (api.bog.ge/docs/en/payments). Verbatim snapshots of the BOG pages are in `evidence/`.

## Classes

| Class | Meaning |
|---|---|
| **C1 Confirmed BOG** | Stated on an official BOG page (bankofgeorgia.ge, businessmanager.bog.ge, api.bog.ge). |
| **C2 Recommended** | Card-scheme rules, Georgian law or common acquirer practice. BOG has **not** published it as its own requirement. Do not treat as a BOG rule. |
| **C3 Confirm with BOG** | Not published. Ask BOG in writing, or BOG contradicts itself. |

## Headline finding

**BOG publishes no list of required website content** (terms, privacy, refund policy, contact details, logos) for online-payment merchants. The official pages cover who may apply, how to apply and how to integrate. A website review may still happen during the ≤3-working-day approval, but its checklist is not public. Everything in §3 is therefore C2 or C3 until BOG says otherwise. The site is still prepared to the card-scheme and Georgian-law standard, because that is what acquirers usually check.

## 1. Onboarding (official)

| # | Requirement | Class | Source |
|---|---|---|---|
| O1 | Any legal form may use online payments: individual entrepreneur (ი/მ), LLC, JSC, etc. | C1 | https://businessmanager.bog.ge/en/online-payment (FAQ); https://businessmanager.bog.ge/en/products/faq |
| O2 | No minimum turnover. | C1 | https://businessmanager.bog.ge/en/online-payment (FAQ, KA and EN agree) |
| O3 | A **BOG business account** is needed to reach Payments Manager ("If you don't have a business account, open your first business account and register to access the payments manager"). | C1 | https://businessmanager.bog.ge/en/online-payment; onboarding link https://bonline.bog.ge/onboarding |
| O4 | The **director** (or person authorised to manage the organisation) signs in first with Business Internet/Mobile Bank credentials, and can invite team members (accountant, programmer). | C1 | https://businessmanager.bog.ge/en/products/faq |
| O5 | Payment methods are **requested remotely** from Payments Manager; review takes **at most 3 working days**. The answer arrives by Business Manager notification and email. | C1 | https://businessmanager.bog.ge/en/products/faq |
| O6 | After approval, the **integration parameters** (`client_id`, `client_secret`) appear on the payment-method details page. `client_secret` can't be changed by the merchant and must not be shared. | C1 | https://businessmanager.bog.ge/en/products/faq; https://api.bog.ge/docs/en/payments/authentication |
| O7 | **Sandbox credentials** can be requested ("Request Sandbox Credentials"), including by non-customers. | C1 | https://api.bog.ge/docs/en/payments/authentication |
| O8 | Limits are agreed individually. | C1 | https://businessmanager.bog.ge/en/online-payment (FAQ) |
| O9 | Foreign cards: the feature and terms are agreed individually. | C1 (but terms unknown → C3) | same |
| O10 | **Deposit on account.** EN page: "Yes, depositing amount is needed… agreed individually." KA page: "არა, სტანდარტული პირობებით… არ მოითხოვება". **BOG contradicts itself.** | **C3** | https://businessmanager.bog.ge/en/online-payment vs https://businessmanager.bog.ge/ka/online-payment |
| O11 | **Settlement timing.** EN: "next calendar day after the transaction". KA: "რამდენიმე წუთში". **Contradiction.** | **C3** | same two pages |
| O12 | Refunds can also be made manually in Business Manager by the director or an accountant team member. Statements and a "full report" (including unfinished processes) can be downloaded. | C1 | https://businessmanager.bog.ge/en/products/faq |
| O13 | Available online methods: card, BOG authorisation, PLUS/MR points, Google Pay, Apple Pay, online installment, gift card, Buy Now Pay Later. Payment is protected by 3-D Secure. | C1 | https://businessmanager.bog.ge/en/online-payment |
| O14 | Cards from BOG and other banks: Visa, Mastercard, American Express. | C1 | https://api.bog.ge/docs/en/payments/introduction |
| O15 | Fees (merchant discount rate), contract/agreement text, MCC, documents to upload. | **C3**: not published | — |

## 2. Technical integration (official, api.bog.ge)

| # | Requirement | Class | Source |
|---|---|---|---|
| T1 | OAuth 2.0 client credentials: `POST https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token`, Basic auth (`client_id:client_secret`), `grant_type=client_credentials`. All calls over HTTPS. | C1 | https://api.bog.ge/docs/en/payments/authentication |
| T2 | Token lifetime: `expires_in`. The documented sample (1634719923245) is not a plausible number of seconds. | C3 | same |
| T3 | Create order: `POST https://api.bog.ge/payments/v1/ecommerce/orders`. Required: `callback_url` (HTTPS), `purchase_units.total_amount`, `purchase_units.basket[]` (`product_id`, `quantity` ≥1, `unit_price`). Optional: `Idempotency-Key` (UUID v4), `Accept-Language` ka/en, `ttl` 2–1440 min (default 15), `payment_method[]`, `capture` automatic/manual, `redirect_urls`, `external_order_id`. Currencies GEL/USD/EUR/GBP. | C1 | https://api.bog.ge/docs/en/payments/standard-process/create-order |
| T4 | The response holds `id`, `_links.details.href` and `_links.redirect.href` (where to send the customer). | C1 | same |
| T5 | Callback: POST to the order's `callback_url`, `event: "order_payment"`. `Callback-Signature` header = SHA256withRSA over the body, verified with BOG's published public key. **The merchant must return HTTP 200.** If the callback isn't received, use Get Payment Details. | C1 | https://api.bog.ge/docs/en/payments/standard-process/callback |
| T6 | Callback retry policy, timeout and source IPs. | C3: not published | — |
| T7 | Payment details: `GET https://api.bog.ge/payments/v1/receipt/:order_id`. Statuses: `created`, `processing`, `completed`, `rejected`, `refund_requested`, `refunded`, `refunded_partially`, `auth_requested`, `blocked`, `partial_completed`. | C1 | https://api.bog.ge/docs/en/payments/standard-process/get-payment-details |
| T8 | Refund: `POST https://api.bog.ge/payments/v1/payment/refund/:order_id`. Full, or partial with `amount` (repeatable up to the processed amount). `Idempotency-Key` supported. Response `request_received` (asynchronous). Methods: card, Apple Pay, Google Pay, BOG authorisation, loyalty points. | C1 | https://api.bog.ge/docs/en/payments/refund |
| T9 | Refund time limit after payment and refund fees. | C3 | — |
| T10 | Payment response codes 100–200 and refund action codes 161–179. | C1 | https://api.bog.ge/docs/en/payments/response-codes |
| T11 | Hosted-page host(s) used in `_links.redirect.href` (the adapter allows only `payment.bog.ge`). | C3 | — |
| T12 | Sandbox base URL, test cards, and how to simulate decline, 3-D Secure failure and timeout. | C3 | — |
| T13 | Basket `vat` / `vat_percent` fields exist but are optional. Whether BOG or the tax rules need them for this merchant is unknown. | C1 field / C3 obligation | create-order page |
| T14 | **Disputes / chargebacks.** No API is documented. | C3: process, deadlines and evidence format | — |

## 3. Website, legal and customer-facing rules (none published by BOG)

| # | Item | Class | Basis |
|---|---|---|---|
| W1 | Merchant legal name, legal form, ID code and address shown on the site | C2 / C3 | Card-scheme practice: Visa Core Rules & Visa Product and Service Rules, e-commerce merchant website section (reported as §5.8.4.1, edition 18 Apr 2026; secondary source https://web60.ie/blog/card-network-rules-website-payments). Official rules index: https://usa.visa.com/support/consumer/visa-rules.html. Ask BOG whether it checks this. |
| W2 | Customer-service contact (email and/or phone) | C2 / C3 | Same card-scheme section |
| W3 | Country of the merchant outlet, and an address for correspondence | C2 / C3 | Same |
| W4 | Complete description of the goods/service | C2 / C3 | Same; Law of Georgia on the Protection of Consumer Rights (pre-contract information for distance contracts): https://matsne.gov.ge/en/document/view/5420598 |
| W5 | Return/refund/cancellation policy, disclosed **before** the purchase decision, especially when refunds are limited | C2 / C3 | Card-scheme practice; Consumer Rights law (withdrawal right and its digital-content exception). **The articles must be confirmed by a lawyer.** |
| W6 | Delivery policy (here: digital, immediate) | C2 / C3 | Card-scheme practice |
| W7 | Prices with currency (GEL) | C2 / C3 | Card-scheme practice; Consumer Rights law |
| W8 | Terms and conditions | C2 / C3 | Common acquirer practice |
| W9 | Privacy notice covering purposes, recipients, retention and data-subject rights | C2 (legal duty) / C3 (BOG check) | Law of Georgia on Personal Data Protection: https://matsne.gov.ge/en/document/view/5827307 (verify the consolidated version and the current supervisory authority with a lawyer) |
| W10 | HTTPS for the whole site | C1 for API calls (T1); C2 for the site | https://api.bog.ge/docs/en/payments/introduction |
| W11 | Visa/Mastercard/BOG logos or a "payments by BOG" mark | C3 | Nothing published. Ask BOG for required marks and artwork. |
| W12 | Payment confirmation / receipt to the customer (email or on screen) | C3 | BOG doesn't say whether it emails cardholders a receipt. Fiscal receipt duty: ask the accountant. |
| W13 | Rules for digital goods / services (MCC, prohibited categories, refund expectations) | C3 | Nothing published |
| W14 | Site live, reachable and complete during review (not "draft", not gated) | C2 / C3 | Common acquirer practice |

## 4. Questions to send BOG (in writing)

1. Is there a website checklist for online-payment approval? Please send it (pages, merchant details, logos).
2. The deposit requirement (O10) and settlement timing (O11): the EN and KA pages differ. Which applies to us?
3. Fees: card (local/foreign), Apple Pay, Google Pay. Is the fee netted from settlement?
4. MCC / category for a digital greeting sold via physical QR cards from partner shops. Is QR Starr's model (we pay partner commission from our own revenue, no split payment) acceptable?
5. Foreign cards: terms.
6. Refunds: time limit, fees, is a callback always sent.
7. Chargebacks: notification channel, response deadline, evidence format, fees.
8. Callback: retry policy, timeout, source IPs, signing-key rotation notice; a **signed sample callback** for our test vector.
9. Hosted payment page host(s) and allowed `redirect_urls` domains.
10. Sandbox: base URL, test cards, simulation of decline / 3-D Secure failure.
11. Token lifetime and API rate limits; `Idempotency-Key` retention window.
12. Receipts and fiscal obligations: does BOG notify the cardholder? Are basket VAT fields needed?
13. Required marks/logos on the site.

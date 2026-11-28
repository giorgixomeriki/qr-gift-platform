# QR Starr — BOG payment readiness, 2026-11-16

Branch `feat/bog-payment-readiness`, built from the live commit 2e17037. Local only:
not pushed, not deployed. Production was **not changed**: PAYMENTS_PROVIDER=TEST,
CHECKOUT_ENABLED=false, ALLOW_TEST_PAYMENTS=false, no BOG_* variables.

Verdict: **code ready; LIVE NO-GO** until the external items in §6 are closed.

## 1. The bank's email (2026-11-16 14:57Z, E-Commerce Sales, application thread)

| Question | Answer from the email |
| --- | --- |
| Merchant approval | **Yes, e-commerce service activated.** Merchant name `qrapp.ge`; merchant ID and terminal ID were issued (kept out of the repo) |
| Production credentials | **Issued but not in the email.** OPAY client ID and secret are masked. Only the authorised person (the director, i.e. the owner) can see them in Business Manager → Payments Manager → Payment methods → the `qrapp.ge` object |
| Sandbox | **None offered.** BOG's Payment Manager docs describe no sandbox or test host. Instead the merchant is in a **100 GEL test limit on production**: every test payment is **real money** |
| API docs | https://api.bog.ge/docs/payments/introduction. The adapter matches the current docs: OAuth at `oauth2.bog.ge`, `POST /payments/v1/ecommerce/orders`, `GET /receipt/{id}`, `POST /payment/refund/{id}`, `Idempotency-Key`, `Callback-Signature` SHA256withRSA over the raw body |
| Callback requirements | Return HTTP 200; verify the signature before parsing; fall back to Get Payment Details. All three are implemented. BOG's published callback key was fingerprinted on 2026-11-16 and is pinned in `scripts/ops/bog-credentials-check.ts` |
| To lift the limit | Reply on the same thread when ready. The site must clearly show: about us; contacts (phone, email, address); product description; price and currency; delivery, return, cancellation and refund policy; privacy policy; terms |
| Pending documents | The Word application form is no longer needed: application 574176436 was approved |

## 2. What this branch changes (commit 1: checkout disclosure)

- The checkout now shows the seller's **registered identification code and legal
  address**, next to the registered name and country (`checkoutSeller` in
  `src/lib/merchant/info.ts`). Both values pass through the existing publication
  gates (`MERCHANT_PUBLISH_ID_CODE`, `MERCHANT_PUBLISH_LEGAL_ADDRESS` =
  `owner-approved`). A withheld value is null and is not rendered. The demo profile
  never reaches checkout, and no personal data is in the repository.
- A "Price in Georgian lari (GEL)" line next to the ₾ amount.
- **Required consent:** an unticked checkbox ("I agree to the Terms and the
  Delivery and Refunds policy, and I have read the Privacy Policy") sits directly
  above Pay, and Pay stays disabled until it is ticked. This applies in both
  checkout screens (Signature and legacy) and in TEST and real modes.
  Consent is not stored server-side (no migration). It gates the redirect to BOG.
- Production already has both gates set to `owner-approved` (the owner's
  2026-11-09 approval for the merchant website). **Deploying this commit
  therefore shows the ID and address on the checkout screen.** This is the gap
  Release A recorded as "fix before real payments".

Commit 2 adds `scripts/ops/bog-credentials-check.ts`, a non-financial
credential check (token + `GET /receipt/<random>` → 404; creates no order), and
this report.

## 3. Verification (local, 2026-11-16)

| Check | Result |
| --- | --- |
| tsc / eslint | pass |
| production build | pass |
| verify:site-content (4 new checkout-seller checks E16–E19) | 63/63 |
| verify:bog-adapter | 56/56 |
| verify:bog-integration (simulated BOG) | 42/42 |
| verify:payment-integrity | 45/45 |
| verify:reconciliation | 48/48 |
| verify:chargebacks | 22/22 |
| verify:commercial | 19/19 |
| verify:env-guards | 36/36 |
| e2e greeting-flow + Signature sender checkout (desktop + mobile) | pass. Asserts disclosure lines, GEL line, Pay disabled until consent |
| e2e Signature "reduced motion" recipient test | fails, **also fails on untouched 2e17037**. Pre-existing and unrelated (recipient reveal timing) |
| Visual check, 390 px | seller, ID, address, country, GEL, VAT, age, policy links; consent sits above Pay in the dock |

All of the above uses a **simulated** BOG. **No real BOG call has been made.** No
credentials exist on this machine yet.

## 4. Scenario coverage (simulated)

`verify:bog-integration` section numbers are in brackets.

| Scenario | Coverage |
| --- | --- |
| Success, single activation and commission | [3a–3b] |
| Duplicate, replayed and concurrent callbacks | [3c] one commission, one activation |
| Forged or unsigned callback | [4a–4b] 400, BOG not even queried |
| Callback body disagrees with receipt | [5a] receipt wins |
| Failed or declined | [6a] |
| Cancel at BOG (fail redirect) | `?payment=cancelled` UI; order settles from receipt [8a/14c] |
| Amount mismatch | [7a–7b] refused and audited |
| Return URL alone, interrupted redirect, refresh | [8a–8b] return URL never pays; status polled server-side; "still confirming" hold, never a second Pay button |
| Delayed or missed callback | [14c] reconciliation settles from the receipt |
| Refund lifecycle (request, pending, complete, replay, reject, 5xx retry, disabled) | [9a–13b] |
| Duplicate capture | [16a–16c] |
| Kill switch | [1a–1b] CHECKOUT_ENABLED=false: no order, no BOG call |

## 5. Real-credential test plan (replaces the "sandbox" plan)

BOG has no sandbox, so the only real test is a **small real-money run** under the
100 GEL cap, using a **staging copy** of the app rather than production:

1. **Owner:** copy the client ID and secret from Business Manager into
   `/Users/Shared/qr-starr-device-tests/2026-11-16-bog-live/bog.env` (mode 0600).
   Never paste them into chat, email or the repository.
2. Run `bog-credentials-check.ts` with that file. This is token and authorization
   only, no money (≈1 min).
3. Staging = this branch on the local idle stack (`qrkeys`, :56321), exposed through
   a quick Cloudflare tunnel. `NEXT_PUBLIC_APP_URL` = the tunnel URL, so BOG's
   per-order `callback_url` and `redirect_urls` point at staging.
   PAYMENTS_PROVIDER=BOG, CHECKOUT_ENABLED=true, BOG_REFUNDS_ENABLED=true **only
   there**. The production DB is never touched.
4. **Owner approval required, real card:**
   - T1: pay 10 GEL. Expect PAID, exactly one activation, a signed callback received, reconcile shows 0 anomalies.
   - T2: cancel on BOG's page. Expect the order to stay unpaid, then retry and pay.
   - T3: close the tab mid-payment, then reopen the card. Expect the status to come from the receipt.
   - T4: refund T1 from admin (aal2). Expect REFUNDED, commission reversed once.
   - T5: replay T1's captured callback. Expect no change.

   Exposure is about 20–30 GEL of charges, refunded in T4 and by follow-up refunds. Fees may not be returned.
5. Evidence (no secrets): order IDs, the callback log with signature-OK, receipt
   statuses, DB rows, screenshots.

## 6. Exact blockers before the first LIVE 10 GEL payment

| # | Blocker | Owner of the action |
| --- | --- | --- |
| B1 | BOG client ID and secret retrieved from Business Manager into a 0600 file | Owner (director-only view) |
| B2 | Approval for the real-money staging run (§5) and its refunds | Owner |
| B3 | **Policies show "not yet in effect"** (LEGAL_EFFECTIVE_DATE unset). Consent to terms that say they are not in force is not valid. A legal review or approval plus an effective date are needed | Owner / lawyer |
| B4 | Deploy this branch (disclosure and consent). Under the existing gate approval it publishes the ID and address on checkout | Owner approval |
| B5 | Reconciliation schedule: 4ddc640 (GitHub Actions, inert until `RECONCILE_SCHEDULE_ENABLED`) plus `CRON_SECRET` and `RECONCILE_ADMIN_USER_ID` (owner admin) on Render. Not set today, so the endpoint returns 404 | Owner approval |
| B6 | Hosting: Render **Free**. A cold start of about 31 s risks callback timeouts. Reconciliation covers missed callbacks, but Starter ($7/mo) is recommended before LIVE | Owner billing decision |
| B7 | Optional: `MERCHANT_VAT_STATUS` unset on Render | Owner / accountant |
| B8 | After B1–B6: email BOG to lift the 100 GEL limit (draft in §8; not sent) | Owner |

Owner admin MFA (1 TOTP factor) and demo-admin revocation were done on
2026-11-15 and are unchanged.

## 7. Release and rollback

1. Owner approves B4. Fast-forward `feat/render-low-cost-hosting` to this branch's
   head and push; on Render, a push is the deploy. Smoke-test /terms, /contact, /api/health
   and a checkout in closed mode (it shows "Payments open soon").
2. After B1–B3 and §5 pass: set on Render `PAYMENTS_PROVIDER=BOG`, `BOG_CLIENT_ID`,
   `BOG_CLIENT_SECRET`, `BOG_API_BASE_URL=https://api.bog.ge/payments/v1`,
   `BOG_WEBHOOK_SIGNING_KEY` (documented key), and keep `CHECKOUT_ENABLED=false`.
   Then deploy, run the credential check, and confirm health.
3. **Separate explicit approval:** `CHECKOUT_ENABLED=true`, then one owner-paid
   10 GEL production smoke test. Verify one activation, order PAID, ledger, and
   reconcile 0 anomalies. Refund only with separate approval.
4. **Rollback:** set `CHECKOUT_ENABLED=false` (instant kill switch, no code
   rollback). For the code, roll back to deploy dep-dbpku2jm8hqs73a13jc0 (2e17037), which
   has the same gates and footer behaviour, so no env cleanup is needed.

## 8. Draft reply to the bank (NOT SENT; for after B1–B6)

> გამარჯობა ბატონო დავით,
>
> გმადლობთ პარამეტრებისთვის. qrapp.ge-ზე ინტეგრაცია დასრულებულია და სატესტო ლიმიტის ფარგლებში ტრანზაქციები წარმატებით გაიარა (გადახდა, გაუქმება, თანხის დაბრუნება). ვებგვერდზე განთავსებულია: ჩვენ შესახებ, საკონტაქტო ინფორმაცია (ტელეფონი, ელ. ფოსტა, მისამართი), მომსახურების აღწერა, ფასი (10 ₾, GEL), მიწოდების/გაუქმების/თანხის დაბრუნების პოლიტიკა, კონფიდენციალურობის პოლიტიკა და წესები და პირობები.
>
> გთხოვთ, განიხილოთ სატესტო ლიმიტის მოხსნა.
>
> პატივისცემით,
> QR Starr

Send only after the tests in §5 have actually passed. Its wording claims that.

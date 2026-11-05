# Payment integration gap report: BOG Payments API

Code at the live commit f819c91. The payment code is unchanged since 894f2ac (PR #6 BOG R1 + PR #9 chargebacks, both in production).

## Statuses

- **VERIFIED**: proven against real BOG (sandbox or production). **Nothing is in this state yet**: no BOG credentials have ever existed.
- **IMPLEMENTED BUT UNVERIFIED**: built and tested locally against a simulator or a DB-backed suite, never against BOG.
- **PARTIAL**, **MISSING**, **BLOCKED** (waiting on BOG, the owner or an approval).

## Evidence

| Evidence | Kind | Result |
|---|---|---|
| `verify:bog-adapter` (`scripts/verify-bog-adapter.ts`) | **Local simulation**: mocked HTTP, real RSA keys generated in-test | **56/56** (local run 2026-11-06; CI run 42067185157 on f819c91) |
| `verify:bog-integration` | **Local simulation**: DB-backed, local BOG simulator | **42/42** (CI run 42067185157, 2026-11-05) |
| `verify:payment-integrity` | Local DB | **45/45** (same CI run) |
| `verify:chargebacks` | Local DB | **22/22** (same CI run) |
| `verify:env-guards` | Local | **36/36** (same CI run) |
| Live production | Read-only | `PAYMENTS_PROVIDER=TEST`, `CHECKOUT_ENABLED=false`, `ALLOW_TEST_PAYMENTS=false`; no `BOG_*` vars; `POST /api/webhooks/payments/BOG` → 404; `/api/cron/payments-reconcile` → 404 |
| Real BOG sandbox | — | **Never run.** No sandbox credentials. |

Note: the CI push run 42068210060 on `feat/render-low-cost-hosting` @ f819c91 **failed**. The failure was infrastructure, not tests: "Failed to resolve latest Supabase CLI release: rate limit exceeded". The PR run on the same commit passed. PR #17 pins the CLI to fix this.

## Matrix

| # | Area | Status | Where / why |
|---|---|---|---|
| 1 | Order creation | **IMPLEMENTED BUT UNVERIFIED** | `providers/bog-provider.ts` `createPayment`: amount from the order snapshot, GEL, `capture: automatic`, `ttl` 30, methods `card, google_pay, apple_pay`, `external_order_id` = our order UUID, `Idempotency-Key` per attempt, basket with one line. **Gaps:** no `vat` fields (C6); `external_order_id` is 36 chars, BOG shows only 25 in the description (cosmetic). |
| 2 | Payment redirection | **IMPLEMENTED BUT UNVERIFIED** | `_links.redirect.href` accepted only for https `payment.bog.ge` (open-redirect guard). The host is not confirmed by BOG (T11). |
| 3 | Status handling | **IMPLEMENTED BUT UNVERIFIED** | `providers/bog/receipt.ts` maps all 10 documented statuses. Unknown statuses → PENDING. A completed receipt without `transfer_amount` → error. |
| 4 | Server-side verification | **IMPLEMENTED BUT UNVERIFIED** | Browser return never counts as proof. `verifyAndReconcileOrder` asks BOG `GET /receipt/{id}` (`service.ts`). |
| 5 | Callback processing | **IMPLEMENTED BUT UNVERIFIED** | `app/api/webhooks/payments/[provider]/route.ts`: raw body first, per-IP rate limit 300/min, `lib/payments/webhook.ts`. Whether non-200 answers trigger BOG retries is unknown (T6). |
| 6 | Authenticity and replay | **IMPLEMENTED BUT UNVERIFIED** | `bog/signature.ts`: SHA256withRSA over the raw body with BOG's PEM key (`BOG_WEBHOOK_SIGNING_KEY`). Only `order_id` is taken from the callback; state and amount come from a fresh receipt, so a replay only restates the truth. **Needs BOG's signed sample** to confirm the encoding (Q8). |
| 7 | Idempotency | **IMPLEMENTED BUT UNVERIFIED** | Order and refund `Idempotency-Key`; DB uniques `payments_provider_payment_id_unique`, `orders_one_open_per_greeting`, ledger one-commission-per-order. |
| 8 | Activation only after verified payment | **IMPLEMENTED** (locally tested) | `confirmPaymentSuccess` → `settleConfirmedPayment` → `activatePaidOrder`; eligibility re-checked under lock; amount/currency mismatch refused and audited. |
| 9 | Duplicate payment prevention | **PARTIAL** (by design) | Each "Pay" creates a new BOG order for the same QR Starr order. Two tabs can both be paid. The second charge is recorded as DUPLICATE_CAPTURE and **refunded automatically only if `BOG_REFUNDS_ENABLED=true`**; otherwise it shows as an anomaly for manual refund in Business Manager. Acceptable, but keep refunds on before go-live. |
| 10 | Failed / cancelled / pending | **IMPLEMENTED BUT UNVERIFIED** | `recordProviderFailure`; UI states in `signature-checkout.tsx` (failed + retry, cancelled, still verifying, no second Pay button while verifying). |
| 11 | Refunds | **IMPLEMENTED BUT UNVERIFIED · switched off** | `refunds.ts` + `payment_refunds` (0019): async, one open refund per charge, completion by receipt/callback, partial refunds not offered. `BOG_REFUNDS_ENABLED` unset (refunds refused before reaching BOG). Admin button in `sales-trace.tsx`. |
| 12 | Chargebacks | **IMPLEMENTED** (manual) · BOG process **BLOCKED** | Admin "Chargeback" records the bank case, reverses commission and creates a clawback; evidence pack has no greeting content (`dispute-evidence.ts`). BOG's notification channel and deadlines are unknown (Q7). |
| 13 | Reconciliation | **PARTIAL** | `findPaymentAnomalies` (12 kinds), `npm run payments:reconcile`, admin button. **The schedule never runs on Render**: it's only in `vercel.json`, `CRON_SECRET` and `RECONCILE_ADMIN_USER_ID` are unset, and the route returns 404. There is no import of BOG's transaction listing; Business Manager "full report" (O12) must be compared by hand. |
| 14 | Audit logs | **IMPLEMENTED** | `lib/audit` used by `service.ts` (payment anomalies), `pricing-admin.ts`; logs carry ids and states only. |
| 15 | Pricing and commission snapshots | **IMPLEMENTED** (locally verified) | Order snapshot: gross, commission, platform share, rate; immutable (0013 triggers; `verify:partner-pricing`, `verify:commercial`). |
| 16 | Credentials and data security | **PARTIAL** | Good: secrets only in `lib/env.ts` (server-only), env guards fail closed, no card data stored (brand + last 4 only), errors never echo secrets (adapter test 9a), private media bucket, Data API locked (0020).<br>**Open P0 outside the adapter:** the legacy Supabase HS256 JWT secret leaked on 2026-10-18 is still trusted. Render still uses only legacy key names; the key migration is PR #17, not deployed.<br>**Also:** a super-admin demo account without MFA (the app has no MFA); demo partner account live; no off-site scheduled backups. |
| 17 | Production config and flags | **IMPLEMENTED** · **BLOCKED** on creds | Needs `PAYMENTS_PROVIDER=BOG`, `BOG_CLIENT_ID`, `BOG_CLIENT_SECRET`, `BOG_API_BASE_URL`, `BOG_OAUTH_TOKEN_URL`, `BOG_WEBHOOK_SIGNING_KEY`, then `CHECKOUT_ENABLED`, `BOG_REFUNDS_ENABLED`. Startup refuses a partial BOG config (`env-guards.ts`). Callback URL = `https://qrapp.ge/api/webhooks/payments/BOG`. |
| 18 | Success / failure / pending screens | **IMPLEMENTED BUT UNVERIFIED** | UI exists and is e2e-tested with the TEST provider. No order reference or receipt is shown to the payer (see W12). |

## Technical work remaining (no code is written by this audit)

| # | Work | Priority | Size |
|---|---|---|---|
| E1 | Release the Supabase key migration (PR #17, staged runbook) and revoke the leaked HS256 secret | P0 | owner-gated release |
| E2 | Checkout: links to Terms / Delivery & refunds next to the Pay button, plus the D3 consent line or checkbox if the lawyer requires it | P0 | small UI PR |
| E3 | Success screen: show a payment reference (our order short id + BOG order id), date and amount | P1 | small |
| E4 | Schedule reconciliation on Render (Render Cron Job or an external scheduler calling `/api/cron/payments-reconcile` with `CRON_SECRET`) | P0 before live | small + env |
| E5 | Upgrade Render from Free to a paid instance (no cold starts or 503s during review or callbacks) | P0 before live | owner purchase |
| E6 | Sandbox run of the 13-step checklist in `docs/PAYMENTS.md` on a staging environment (never prod), against BOG sandbox | P0 | needs sandbox creds |
| E7 | Confirm the signature encoding with a BOG-signed sample; add it as a fixture to `verify:bog-adapter` | P0 | small |
| E8 | Basket `vat` fields, if the accountant/BOG require them | P1 | small |
| E9 | Privacy copy: add Render (hosting, Frankfurt) as a processor; data-location statement | P0 (copy) | copy PR |
| E10 | Retention: implement deletion once D1 is decided (nothing is deleted today) | P1 | medium |
| E11 | Remove or replace demo admin/partner accounts and demo cards; MFA for admin (`feat/admin-mfa` plan) | P1 (P0 for the super admin) | medium |
| E12 | Monitoring/alerting on `paymentReconcile` warnings and webhook 4xx/5xx (`docs/OBSERVABILITY.md`) | P1 | small |
| E13 | Update `docs/PAYMENTS.md` "Merchant credential boundary": it still says every BOG method throws, which is no longer true | P2 | docs |

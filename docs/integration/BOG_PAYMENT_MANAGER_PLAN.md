# Bank of Georgia Payment Manager: Implementation Plan

Status: **plan only.** Nothing here is implemented. Live checkout stays disabled
until this work is built, tested and approved, and until the 10.00 GEL / 3.00 /
7.00 split is confirmed in a real transaction (`docs/PILOT_LAUNCH_CHECKLIST.md` §7, §14).

Source: BOG's public developer documentation at `https://api.bog.ge/docs/en/payments/…`
(read 2026-10-13). Anything marked **[confirm with BOG]** is not stated in the
public docs and must come from the bank in writing before it's relied on.

## 1. What already exists (and is kept unchanged)

The payment domain was built provider-agnostic. `src/lib/payments/service.ts`
depends only on the `PaymentProvider` interface (`types.ts`), and
`BOGPaymentProvider` (`providers/bog-provider.ts`) is the empty seam. The
following properties are already enforced and tested (`verify:payment-integrity`,
`verify:pilot-protections`, `verify:phase5`). The BOG work must not weaken any of them:

- **One path to PAID.** Only `confirmPaymentSuccess` → `settleConfirmedPayment`,
  reached from a verified webhook, provider reconciliation, or the TEST
  simulation. A browser landing on a return URL is never treated as proof.
- **Idempotency** at three layers: the order row lock, the payment upsert on
  `(provider, provider_payment_id)`, and a unique `COMMISSION_EARNED` per order.
- **Amount check.** The provider's amount and currency must equal the order snapshot,
  otherwise `AmountMismatchError` is raised and an anomaly is recorded.
- **Exactly-once outcomes:** duplicate captures, late successes after FAILED,
  payments for ineligible or already-paid greetings → refund paths.
- **Price snapshot.** The order carries `gross_amount_minor`, `commission_rate_bps`,
  `partner_commission_minor` and `platform_share_minor`, so changing the price
  never reprices an order.
- **Metadata allowlist.** `sanitizeProviderMetadata` stores no PAN, CVV or tokens.
- **Reconciliation.** `verifyAndReconcileOrder`, `findPaymentAnomalies` and
  `npm run payments:reconcile`.

## 2. BOG API surface used

| Purpose | Call |
|---|---|
| Access token | `POST https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token`, HTTP Basic `client_id:client_secret`, form body `grant_type=client_credentials` → `{access_token, token_type: "Bearer", expires_in}` |
| Create order | `POST https://api.bog.ge/payments/v1/ecommerce/orders`, `Authorization: Bearer`, optional `Idempotency-Key` (UUID v4), `Accept-Language: ka\|en`, `Theme` → `{id, _links.details.href, _links.redirect.href}` |
| Payment details | `GET https://api.bog.ge/payments/v1/receipt/{order_id}` → `order_status.key`, `purchase_units.{request_amount, transfer_amount, refund_amount, currency_code}`, `payment_detail`, `actions[]`, `reject_reason` |
| Callback | BOG `POST`s to our `callback_url` when a transaction reaches a final status, **including refunds**. The body is `{event: "order_payment", zoned_request_time, body: {…receipt…}}`, signed in `Callback-Signature` with **SHA256withRSA** over the raw body, using BOG's published public key. We return 200. |
| Refund | `POST https://api.bog.ge/payments/v1/payment/refund/{order_id}`, optional `amount` (omit for a full refund), optional `Idempotency-Key` → `{key: "request_received", message, action_id}`. This call is **asynchronous**. |

Not used at launch: pre-authorization (`capture: manual`), saved cards,
split payments, installments/BNPL, or Apple/Google Pay from our own page. Apple and
Google Pay are still offered on BOG's hosted page if they're enabled on the terminal.

## 3. Design

### 3.1 Configuration (`src/lib/env.ts`)

| Variable | Secret | Notes |
|---|---|---|
| `PAYMENTS_PROVIDER=BOG` | no | Production only, once approved |
| `BOG_CLIENT_ID` | yes | Issued by BOG |
| `BOG_CLIENT_SECRET` | **yes** | Issued by BOG and can't be changed by the merchant. Stored as Vercel *Sensitive* |
| `BOG_API_BASE_URL` | no | `https://api.bog.ge/payments/v1` **[confirm with BOG; also whether a test base exists]** |
| `BOG_OAUTH_TOKEN_URL` | no | New. Defaults to the URL above |
| `BOG_WEBHOOK_SIGNING_KEY` | no | Repurposed to hold **BOG's callback public key (PEM)**. It's public by nature but pinned via env so rotation needs no code change. The startup check parses it as an RSA public key and fails closed if it can't. |
| `CHECKOUT_ENABLED` | no | New kill switch, default `false`. When false the Checkout step shows a "payments open soon" state and no order or provider call is made. Turning it on in production is an approval gate. |

### 3.2 Token client (`providers/bog/auth.ts`)

- The token is cached in module memory per serverless instance and refreshed
  60 s before expiry. The expiry is taken from the JWT `exp` claim when present,
  because the documentation's `expires_in` example is implausible
  (`1634719923245`). The fallback is `expires_in` seconds, capped at 1 hour.
- Concurrent refreshes are single-flighted (one shared in-flight promise).
- A 401 on any API call invalidates the cache and retries once.
- The token and secret are never logged. Errors log only the HTTP status and BOG's `key` and `message`.
- Every outbound call has a 10 s timeout (`AbortSignal.timeout`).

### 3.3 `createPayment`

The request is built from the order snapshot only; client input never reaches it:

```jsonc
{
  "callback_url": "https://qrapp.ge/api/webhooks/payments/BOG",
  "external_order_id": "<orders.id>",           // our UUID; BOG shows the first 25 chars
  "capture": "automatic",
  "ttl": 30,                                     // minutes; BOG allows 2–1440 (default 15)
  "payment_method": ["card", "google_pay", "apple_pay"],   // final list = decision B1
  "redirect_urls": { "success": "<returnUrls.success>", "fail": "<returnUrls.cancel>" },
  "purchase_units": {
    "currency": "GEL",
    "total_amount": 10.00,                       // minorToMajor(gross_amount_minor)
    "basket": [{ "product_id": "PREMIUM_GREETING", "description": "QR Starr greeting",
                 "quantity": 1, "unit_price": 10.00 }]
  }
}
```

- **Money conversion:** `minorToMajor` and `majorToMinor` are exact helpers.
  `majorToMinor` rejects any value that isn't a whole number of tetri after
  `Math.round(x * 100)` within 1e-9, so a float artefact can never silently
  change an amount. They get unit tests at every boundary.
- **Language:** `Accept-Language` follows the greeting's locale (`ka` by default).
  `CreatePaymentInput` gains an optional `locale`.
- **Idempotency-Key:** a fresh UUID v4 per attempt, reused for the adapter's single
  network retry. A retry therefore returns the same BOG order instead of creating a second one.
- **Response:** validated with zod. `providerPaymentId = id`, and
  `redirectUrl = _links.redirect.href` only if its host is on the allowlist
  `payment.bog.ge` **[confirm full host list]**. Any other host is refused, so an
  unexpected response can't become an open redirect.
- **Attempt lifecycle:** this is unchanged. `createPaymentAttempt` runs outside any DB
  transaction and records a `PENDING` payment row keyed by BOG's order id.
  Re-entering checkout creates a fresh attempt, as it does today. An attempt that
  BOG created but we failed to record simply expires at `ttl`, and the customer is
  never redirected to it.

### 3.4 `verifyPayment` (receipt lookup)

`GET /receipt/{id}`, validated with zod and mapped as follows:

| `order_status.key` | Mapped to | Notes |
|---|---|---|
| `created`, `processing` | `PENDING` | |
| `completed` | `SUCCEEDED` | amount = `majorToMinor(transfer_amount)`, currency = `currency_code` |
| `rejected` | `FAILED` | `reject_reason` (`expiration`, code description) is kept in sanitized metadata as `failureReason` |
| `refund_requested` | `SUCCEEDED` with `refundState: "REQUESTED"` | see §3.6 |
| `refunded` | `SUCCEEDED` with `refundState: "REFUNDED"` | |
| `refunded_partially` | `SUCCEEDED` with `refundState: "PARTIAL"` | We never request partial refunds, so this is an anomaly |
| `auth_requested`, `blocked`, `partial_completed` | anomaly | Pre-authorization isn't used. Recorded, alerted, never activated |

The success amount check stays in `verifyAndReconcileOrder`, which is
unchanged: `transfer_amount` must equal the order's `gross_amount_minor`.

### 3.5 `handleWebhook` (signed callback)

The route `src/app/api/webhooks/payments/[provider]/route.ts` already reads the
**raw body first**. The BOG adapter:

1. Requires a `Callback-Signature` header. The docs call it optional; we reject
   with 401 if it's missing.
2. Verifies it with `crypto.verify("sha256", rawBodyBytes, bogPublicKey, signature)`
   over the **exact raw bytes**, before any JSON parsing. Signature encoding is
   assumed base64 **[confirm with BOG, along with a sample signed payload for a test vector]**.
3. Only then parses JSON and requires `event === "order_payment"`.
4. **Does not trust the callback body for state.** It takes `body.order_id`,
   loads our payment row by `(provider = BOG, provider_payment_id = order_id)`
   to get *our* `orderId` (never `external_order_id` from the body), then
   calls `verifyPayment(order_id)` and settles from BOG's receipt. A replayed
   or reordered callback is harmless: the receipt is the current truth and
   settlement is idempotent.
5. Returns 200 once the outcome is durably recorded. It returns 5xx only on our own
   transient failure, so BOG retries **[confirm retry count, interval and timeout]**.
   An unknown order id returns 200 and records an anomaly, so a misdirected
   callback isn't retried forever.
6. Adds IP-based rate limiting (the existing `enforceRateLimit`) and an optional
   source-IP allowlist if BOG publishes callback ranges **[confirm]**.
7. Logs scope, BOG order id and outcome only. The body and signature are never logged.

### 3.6 Refunds: from synchronous to two-phase (the one domain change)

BOG answers a refund with `request_received`. The money movement is
confirmed later, by callback and in the receipt (`refunded`, plus an `actions[]`
entry with status `completed` or `rejected` and codes 161–169, 179). Today's
`RefundResult` is synchronous (`REFUNDED | FAILED`), so:

- **Migration 0018 (forward-only):** a `payment_refunds` table with columns `id`,
  `payment_id`, `order_id`, `amount_minor`, `currency`, `idempotency_key` (unique),
  `provider_action_id`, `status REQUESTED|COMPLETED|REJECTED`, `provider_code`,
  `reason ADMIN|INELIGIBLE|DUPLICATE_CAPTURE|CHARGEBACK`, timestamps, and an RLS
  policy in the style of 0003/0013. One non-rejected refund per payment is enforced
  by a partial unique index.
- **`RefundResult.status`** gains `"PENDING"`. The TEST provider keeps answering
  `REFUNDED` synchronously, so every existing suite stays meaningful.
- **Request:** `refundPaidOrder`, `refundIneligiblePayment` and
  `refundCapturedPayment` insert a `REQUESTED` row (same transaction as the
  audit log), then call BOG with `Idempotency-Key = uuidV4From(refund row id)`.
  The key is derived deterministically, so a retry reuses it.
  `refundIdempotencyKey`'s current `refund-<id>` format isn't a UUID and
  is replaced **[confirm that BOG accepts deterministic v4-format keys and how long it keeps them]**.
- **Completion:** a refund callback or a reconcile poll sees `refunded` → the row
  becomes `COMPLETED`, then the existing finalization runs (payment `REFUNDED`,
  order `REFUNDED`, `COMMISSION_REVERSAL` booked once). A rejected action → the
  row becomes `REJECTED`, plus an anomaly and an admin alert. The order stays PAID
  (or REFUND_REQUIRED) and nothing is reversed.
- **Commission timing (decision B4):** reverse commission when the refund is
  **completed** (recommended), not when it's requested.
- **Partial refunds:** not offered. The UI and service request only full refunds.

### 3.7 Chargebacks (disputes)

The Payment Manager API documents no dispute endpoint or callback. Disputes
reach the merchant through BOG's acquiring channel **[confirm channel, deadlines,
fees and evidence format]**. Plan, matching blueprint decision D4:

- A new admin action, **"Record chargeback"**, on the order page, with a
  reference, date and amount. It inserts a `payment_refunds` row with
  `reason = CHARGEBACK` and `status = COMPLETED` (money already left), then
  runs the same finalization as a completed refund. No provider call is made. It's audit-logged.
- If the commission was already paid out, the partner balance goes negative and is
  netted against future commission (blueprint D5). It's never clawed back automatically.
- The greeting stays live. Taking it offline is a separate moderation decision, as for refunds.
- An evidence pack for disputes: an admin export of the order timeline (creation,
  payment receipt, activation, recipient opened). No message content is included,
  per `docs/PRIVACY_MODEL.md`.

### 3.8 Reconciliation

| Layer | Trigger | What it does |
|---|---|---|
| Real-time | BOG callback | Verify the signature → receipt → settle (§3.5) |
| Return page | Browser polling (existing) | `verifyAndReconcileOrder`, which asks BOG and never trusts the redirect |
| Sweep | **Vercel Cron** every 10 min → `GET /api/cron/payments-reconcile`, authorised by `Authorization: Bearer $CRON_SECRET` (Vercel's cron convention) | PENDING orders older than 5 min → receipt. Past `ttl` + `rejected`/`expiration` → FAILED. `REQUESTED` refunds → receipt. `PAID_NOT_ACTIVATED` → activate. Reuses `findPaymentAnomalies` and the `--apply` rules of `payments:reconcile`. |
| Daily settlement | Admin uploads BOG's settlement statement (CSV from Business Manager) **[or a report API, confirm]** | Matches each BOG transaction to a `payments` row by order id and amount. Lists unmatched BOG transactions, unmatched SUCCEEDED payments and amount differences. Fees and net settlement are recorded as reported, never derived (D3). |

Anomalies surface in the admin dashboard and as structured logs
(`scope: "paymentReconcile"`), with a log-based alert on any new anomaly.

### 3.9 Checkout UI

- `CHECKOUT_ENABLED=false` (the default) → "payments open soon", with no order or provider call.
- BOG mode → "Pay 10 ₾" redirects to `_links.redirect.href`. The return page polls, as it already does
  for non-TEST providers (`showRealPayButton` already exists in `creation-wizard.tsx`).
- No card data ever touches our pages. BOG's hosted page handles card entry and 3-D Secure.
  The CSP needs no change, because redirecting is a top-level navigation.

## 4. Testing

1. **Unit:** money conversion, status mapping, zod schemas, the redirect-host allowlist,
   the token cache and single-flight logic, and the deterministic idempotency key.
2. **Signature:** test vectors signed with a locally generated RSA key pair, covering a
   valid signature, a single flipped body byte, a re-serialized JSON body, a missing
   header, the wrong key, and an empty body. Plus BOG's own sample callback and signature,
   if the bank provides one.
3. **Contract stub:** a local BOG simulator (`scripts/bog-stub.ts`) that serves the
   token, orders, receipt and refund endpoints and sends signed callbacks with the test
   key. The adapter points at it through `BOG_API_BASE_URL`, `BOG_OAUTH_TOKEN_URL` and
   the test public key. A new `verify:bog-adapter` suite runs every flow against it in CI:
   success, failure, expiry, duplicate callback, out-of-order callback, amount mismatch,
   double capture, refund request→complete, refund rejected, and chargeback.
4. **Existing suites** must stay green unchanged: payment-integrity, pilot-protections,
   phase3–5, partner-attribution, payout-items.
5. **BOG test environment**, if the bank offers one **[confirm, along with test cards]**:
   the full flow on a Vercel preview against staging.
6. **Production smoke test** (approval gate): with production credentials, the owner
   makes one real 10.00 GEL payment, and we verify:
   - the order is PAID with 1000 / 300 / 700;
   - the commission ledger is +300 for the partner;
   - the greeting is activated;
   - a callback was received and verified.

   Then an admin refund, checking that the refund completes, commission is reversed
   (−300) and the order is REFUNDED.
   `ops:check-launch-pricing` is run before and after.

## 5. Rollout (each step needs approval)

| Step | Needs | Output |
|---|---|---|
| R1 Build | Nothing from BOG | Adapter, migration 0018, kill switch, cron, stub, tests, with PR + CI |
| R2 Test environment | BOG test credentials and test cards | Preview + staging end to end |
| R3 Production credentials | BOG merchant agreement, terminal activated | Secrets in Vercel Production (owner enters them) |
| R4 Smoke test | Owner approval | One real payment + refund, verified (§4.6) |
| R5 Open checkout | Owner approval | `CHECKOUT_ENABLED=true` in production |

**Rollback:** set `CHECKOUT_ENABLED=false` and redeploy (a Vercel env change takes
effect on the next deployment, about 1–2 minutes), or promote the previous Vercel deployment. Pending orders remain
reconcilable because the cron and receipt lookups keep running.

## 6. Decisions needed from the owner

- **B1. Payment methods:** card + Apple Pay + Google Pay (recommended); add `bog_p2p` (BOG app) and `bog_loyalty`?
- **B2. Order `ttl`:** 30 minutes (recommended) or BOG's default of 15.
- **B3. Payment page language:** follow the greeting locale (recommended).
- **B4. Commission reversal:** at refund **completion** (recommended).
- **B5. Chargebacks:** treat them as refunds, recorded manually by an admin (blueprint D4).
- **B6. Refund after payout:** net the partner's negative balance against future commission (blueprint D5).
- **B7. VAT and fees** (blueprint D3): is the 7.00 GEL platform share a gross allocation, with
  fees and VAT kept out of the app? This determines whether `vat` / `vat_percent` are sent
  in the basket and what the settlement report records.
- **B8. Split payments:** BOG's `config.split` could pay the partner's 30% directly to their IBAN.
  **Not recommended for launch**, because it changes the payout model and the ledger. Revisit later.

# BOG Sandbox: staging architecture and test checklist

Status: **prepared, not provisioned.** No request has gone to BOG, no staging
service exists, and no bank credentials exist anywhere in this repository.
`BOG_SANDBOX_REQUEST_KA.md` still needs the owner's approval before it is sent.

The adapter has only ever run against the local simulator. This run is what
turns that into evidence.

## Architecture

```
Customer browser ── redirect ──► BOG Sandbox hosted page
       │                               │
       ▼                               ▼ signed callback (POST)
Render: qr-starr-staging ◄─────────────┘
  /api/webhooks/payments/BOG
       │  receipt lookup, refund ──► BOG Sandbox API
       ▼
Supabase project: staging only (never production)
```

| Piece | Requirement | Why |
| --- | --- | --- |
| Render service | New service, separate from `qr-starr`. Always-on instance | A Free instance sleeps; a cold start during a callback can fail it. BOG's retry policy is still unknown |
| Supabase | New project with its own keys, TOTP enabled | The test must not touch production orders or the ledger |
| Domain | `staging.qrapp.ge` or the `onrender.com` URL | BOG must accept it in `redirect_urls` (request item 3) |
| Code | Merge of the MFA, reconciliation and merchant candidates | Tests what will actually ship |
| Access control | Any gate on the site must exempt `/api/webhooks/payments/BOG` | BOG can't pass a gate |

## URLs to give BOG

| Purpose | URL |
| --- | --- |
| Callback | `https://<staging>/api/webhooks/payments/BOG` (POST, header `Callback-Signature`) |
| Return, success and fail | Derived from `NEXT_PUBLIC_APP_URL`, on the card's own `/g/<token>` route |

## Environment

Set only on the staging service. Secrets marked **S** are stored as Render
*Sensitive* values and never go into chat, a file in this repository, or logs.

| Variable | Value | S |
| --- | --- | --- |
| `PAYMENTS_PROVIDER` | `BOG` | |
| `BOG_CLIENT_ID` | From BOG | |
| `BOG_CLIENT_SECRET` | From BOG | **S** |
| `BOG_API_BASE_URL` | Sandbox base URL from BOG | |
| `BOG_OAUTH_TOKEN_URL` | Sandbox token URL from BOG, if it differs from the default | |
| `BOG_WEBHOOK_SIGNING_KEY` | BOG's public key (PEM) | |
| `CHECKOUT_ENABLED` | `false`, then `true` only during an approved run | |
| `BOG_REFUNDS_ENABLED` | `false`, then `true` for section D | |
| `NEXT_PUBLIC_APP_URL` | `https://<staging>` | |
| `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SECRET_KEY`, `EDIT_TOKEN_SECRET` | Staging values only | **S** where secret |
| `CLIENT_IP_HEADER`, `TRUSTED_PROXY_COUNT` | As on production | |
| `CRON_SECRET`, `RECONCILE_ADMIN_USER_ID` | Staging values | **S** |
| `MERCHANT_*` | Only values the owner has approved | |

Do not set `ALLOW_TEST_PAYMENTS`.

## Code that may need adjusting once BOG answers

| Assumption | Where | If BOG differs |
| --- | --- | --- |
| Payment page host is `payment.bog.ge` | `REDIRECT_HOSTS`, `bog-provider.ts` | Add the confirmed sandbox host |
| API and token hosts are under `bog.ge` | `bogUrlProblems`, `env-guards.ts` | Startup fails closed; add the confirmed host |
| Signature is base64 SHA256withRSA | `bog/signature.ts` | Fix from BOG's signed sample (E7), add it as a test fixture |

## Before each run

- [ ] Owner approved this run. Sandbox credentials are in Render, not in chat.
- [ ] The service reports the expected commit, and `/api/health` is OK.
- [ ] `NEXT_PUBLIC_SUPABASE_URL` is the staging project, not production.
- [ ] `npm run ops:preflight` passes with the staging environment.
- [ ] Locally on the same commit: `verify:bog-adapter`, `verify:bog-integration`, `verify:reconciliation`, `verify:payment-integrity`.
- [ ] A fresh AVAILABLE test QR exists for each case. Record its order id.

## Test checklist

Record the order id, time and pass/fail. Check the database after each case.
Expected for "paid": order `PAID`, greeting and QR `ACTIVE`, exactly one
`COMMISSION_EARNED` row.

**A. Signature and callback**

| # | Action | Expected |
| --- | --- | --- |
| A1 | POST an unsigned callback to staging | 400, nothing changes |
| A2 | POST one with a wrong signature | 400, nothing changes |
| A3 | Save BOG's signed sample as a fixture and verify it | Signature valid |

**B. Payment outcomes**

| # | Action | Expected |
| --- | --- | --- |
| B1 | Pay with a success test card | Paid, one commission, recipient sees the greeting |
| B2 | Have BOG resend the same callback | 200, nothing changes |
| B3 | Close the browser before returning | Callback alone activates |
| B4 | Return before the callback arrives | Return page settles it from the receipt |
| B5 | Decline card | Order `FAILED`, no commission, not activated |
| B6 | Fail 3-D Secure | Same as B5 |
| B7 | Cancel on the bank page | Not paid; a retry pays exactly once |
| B8 | Pay in two tabs | One paid; the extra charge goes to refund |
| B9 | Bank-side timeout (BOG's method) | Stays pending; reconciliation resolves it |

**C. Reconciliation**

| # | Action | Expected |
| --- | --- | --- |
| C1 | Block callbacks briefly, pay, wait over 30 min, run the job | Settled from BOG's receipt |
| C2 | Run the job twice more | No further change |
| C3 | Alert channel | Receives only kinds, counts and short ids |
| C4 | `payments:reconcile` report at the end | Empty, or every row explained |

**D. Refunds** (`BOG_REFUNDS_ENABLED=true`)

| # | Action | Expected |
| --- | --- | --- |
| D1 | Refund from admin (with MFA) | `REQUESTED`, order still `PAID` |
| D2 | Bank confirms | Order `REFUNDED`, one `COMMISSION_REVERSAL` |
| D3 | Click refund twice | BOG asked once |
| D4 | Refund a charge the bank refuses | `REFUND_REJECTED` reported, order still `PAID` |

## Stop immediately if

- Any request reaches a production URL, database or credential.
- A paid case produces two commissions, or activation without payment.
- A secret or greeting text appears in a log or alert.

Set `CHECKOUT_ENABLED=false`, keep the evidence, and investigate.

## Pass criteria

Every row in A–D passes, E7 is a committed fixture, and the answers to the
sandbox request are recorded. Passing here does not authorize live payments;
those need the production credentials and the owner's separate approval.

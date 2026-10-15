# Payments — architecture, guarantees, runbook

Code: `src/lib/payments/` (service, checkout, provider seam, payouts) ·
`src/app/api/webhooks/payments/[provider]/route.ts` · migrations 0002–0004,
0011, 0013–0016. Tests: `verify:payment-integrity`, `verify:phase5`,
`verify:commercial`, `verify:partner-attribution`, `verify:payout-items`,
`verify:payout-concurrency`, `verify:business-calendar`, e2e `greeting-flow`.

## Flow

```
QR (partner → batch → card) ─► greeting (DRAFT) ─► checkout
  getOrCreateCheckoutOrder ── one open order per greeting (DB) ──► order PENDING_PAYMENT
     snapshot: gross, commission, platform share, rate, partner, qr (immutable, DB)
  createPaymentAttempt ── provider.createPayment ──► payment PENDING (provider, provider_payment_id unique)
customer pays at the provider
  provider webhook ─► route ─► provider.handleWebhook (signature) ─► status?
     SUCCEEDED ─► confirmPaymentSuccess ─► settleConfirmedPayment
     FAILED    ─► recordProviderFailure
     PENDING   ─► acknowledged, nothing changes
  browser return ─► checkPaymentReturn ─► verifyAndReconcileOrder (asks the PROVIDER) ─► same functions
settlement: PAID + COMMISSION_EARNED (one per order, DB) ─► activatePaidOrder ─► greeting + QR ACTIVE
payouts: exact ledger rows, period [from, to) in Asia/Tbilisi, serialized per partner+currency
```

The browser is never authority: it names its greeting (edit-token cookie)
and nothing else. Price, currency, partner, commission, order, payment id and
outcome are all derived server-side or reported by the provider.

## State machines

**Order** (`order_status`; DB trigger `trg_orders_integrity` forbids leaving PAID except to a refund state, and leaving REFUNDED)

```
PENDING_PAYMENT ─► PAID ─► REFUNDED
       │            (PARTIALLY_REFUNDED: reserved, unsupported)
       ├─► FAILED ─────┐
       ├─► CANCELED ───┤ (closed: a late provider success is recorded and RETURNED —
       │               │  a failed payment never earns commission or activates)
       └───────────────┴─► REFUND_REQUIRED ─► REFUNDED
                           (also: ineligible greeting, or greeting already paid via another order)
```

**Payment attempt** (`payment_status`) `PENDING ─► SUCCEEDED ─► REFUNDED`,
`PENDING ─► FAILED ─► SUCCEEDED ─► REFUNDED` (a late success, recorded then
returned). A SUCCEEDED charge is never downgraded by a later FAILED notification.

## Guarantees and where they live

| Guarantee | Application | Database |
|---|---|---|
| One order per checkout, even under double-tap | `getOrCreateCheckoutOrder` reuses the open order; the loser of a race continues with the winner's | `orders_one_open_per_greeting` (0016) |
| One paid order per greeting | `confirmPaymentSuccess` routes a second success to refund | `orders_one_paid_per_greeting` (0002) |
| One commission per paid order | `onConflictDoNothing` | `partner_ledger_one_commission_per_order`; ledger trigger requires PAID |
| Every provider-confirmed charge recorded, never dropped | `confirmPaymentSuccess` + `settleConfirmedPayment` (duplicate capture → `refundCapturedPayment`) | `payments_provider_payment_id_unique` |
| Provider outcome respected | webhook routes by reported status | — |
| Amount/currency = order snapshot | `AmountMismatchError` (audited, never applied) | snapshot immutable (0013) |
| Attribution from the QR, immutable | resolved server-side at checkout | 0013 triggers (QR ↔ batch ↔ partner ↔ order) |
| Refund keeps history | reversal entry, nothing deleted | `partner_ledger_one_reversal_per_order`; reversal requires REFUNDED |
| No double refund | `payment_refunds`: one open-or-completed refund per charge; provider Idempotency-Key derived from the refund row (`idempotencyKeyFor`); money-side effects only on provider confirmation | `payment_refunds_one_open_per_payment` (0019); one reversal per order |
| Payouts: exact rows, no overdraw, no overlap | statement must match server-side | advisory lock per partner+currency; exclusion constraint on `[from, to)` |

Duplicate webhook, browser return + webhook race, concurrent identical
webhooks, success racing failure: all converge on one PAID, one commission,
one `PAYMENT_SUCCEEDED` event (`verify:payment-integrity` §5, §8; `verify:phase5`).

## Reconciliation

`findPaymentAnomalies` (admin) lists: CAPTURED_NOT_APPLIED, DUPLICATE_CAPTURE,
REFUND_PENDING, PAID_WITHOUT_CHARGE, PAID_NOT_ACTIVATED, COMMISSION_MISSING,
COMMISSION_NOT_REVERSED, STALE_PENDING (> 30 min), AMOUNT_MISMATCH (30 days),
REFUND_AWAITING_PROVIDER (> 1 h), REFUND_REJECTED, EXTERNAL_REFUND (30 days).
A charge whose refund is already with the provider is never listed as
REFUND_PENDING / DUPLICATE_CAPTURE: **never return money by hand for an order
that shows REFUND_AWAITING_PROVIDER** — that would refund twice.

```
npm run payments:reconcile -- --admin <admin user id>            # report
npm run payments:reconcile -- --admin <admin user id> --apply    # re-verify stale pending with the provider,
                                                                 # activate paid-not-active, refund duplicates
```

Scheduled: `vercel.json` calls `/api/cron/payments-reconcile` (the same
`--apply` rules) once a day at 03:15 UTC, the most Vercel Hobby allows; on Pro
change the schedule to `*/10 * * * *`. It does nothing until `CRON_SECRET` and
`RECONCILE_ADMIN_USER_ID` are set (404). Each run that finds anomalies logs
one `"scope":"paymentReconcile"` warning — alert on it (OBSERVABILITY.md). The direction it
cannot see without the provider — a charge the provider holds that QR Starr
never heard of — needs the provider's transaction listing (BLOCKED, below).

## Chargebacks

BOG has no dispute API: a chargeback arrives through the bank (email /
Business Manager). Admin → Partners → the partner → Sales trace → **Chargeback**
on the PAID order: enter the bank's case reference and date, then confirm.
In one transaction the charge and order become REFUNDED and the partner's
commission for that order (its own snapshot) is reversed once; if that
commission was already paid out, the reversal is netted into the partner's
next payout (CLAWBACK). Nothing is sent to BOG and the greeting stays live.
Refused when the order isn't PAID or a refund for the charge is open or done
(contest that with the bank instead). **Evidence** on the same row downloads a
dispute pack (order, charge reference, card brand/last 4, activation times,
recipient views, refunds) with no greeting content. Policy: BOG plan decisions
B5/B6 (recommended options, pending owner confirmation). Tests:
`verify:chargebacks`, `e2e/admin-chargeback.spec.ts`.

## Test provider (no merchant needed)

`PAYMENTS_PROVIDER=TEST` + `ALLOW_TEST_PAYMENTS=true`, refused when
`NODE_ENV=production`. Its signed webhook (`x-test-webhook-signature`,
HMAC-SHA256 with `TEST_PAYMENTS_WEBHOOK_SECRET`) may report `SUCCEEDED`
(default), `FAILED` or `PENDING`; amount/currency come from the charge id, as
a real provider reports what it charged. Refunds honour idempotency keys. It
runs through the same route and service as a real provider.

## Merchant credential boundary

**Blocked by merchant credentials** (`src/lib/payments/providers/bog-provider.ts` — every method throws `ProviderNotImplementedError` rather than guess):
1. Create payment / redirect (endpoint, auth, request shape).
2. Payment status lookup (`verifyPayment`) — used by return polling and reconciliation.
3. Webhook authentication (signature scheme / key) — `handleWebhook`.
4. Refund API (+ forwarding the idempotency key) — until then refunds queue as REFUND_PENDING.
5. Transaction listing for provider-side reconciliation.
6. Sandbox + production credentials; webhook/callback URL registration in the provider dashboard.

### Merchant activation checklist

1. Receive sandbox credentials and the provider's current API + webhook documentation.
2. `BOGPaymentProvider` is implemented against BOG's public docs (`providers/bog-provider.ts`, `providers/bog/*`; design in `docs/integration/BOG_PAYMENT_MANAGER_PLAN.md`). Confirm the items marked **[confirm with BOG]** there (signature encoding + a signed sample, redirect hosts, idempotency-key retention, test environment) and adjust only the adapter. Offline and DB-backed suites: `verify:bog-adapter`, `verify:bog-integration`.
3. Set `PAYMENTS_PROVIDER=BOG`, `BOG_CLIENT_ID`, `BOG_CLIENT_SECRET`, `BOG_API_BASE_URL`, `BOG_WEBHOOK_SIGNING_KEY` (BOG's public key, PEM), `NEXT_PUBLIC_APP_URL` (return and callback URLs derive from it). Startup fails closed if any is missing or the key isn't an RSA public key. Keep `CHECKOUT_ENABLED=false` and `BOG_REFUNDS_ENABLED=false` until each is approved (`docs/ENVIRONMENT_MATRIX.md`).
4. Register the webhook URL `https://<app>/api/webhooks/payments/BOG` in the provider dashboard.
5. Sandbox: unsigned / wrong-signature webhook → 400; correct → 200.
6. Sandbox: pay a test order end to end; confirm order PAID, one COMMISSION_EARNED, greeting ACTIVE, recipient world + finale.
7. Re-deliver the same webhook (dashboard "resend") → 200, nothing changes.
8. Close the browser before the redirect → the webhook alone activates; and the reverse (return before webhook) → polling activates via `verifyPayment`.
9. Decline / cancel at the provider → FAILED / cancelled UI, no commission; retry pays once.
10. Refund from admin → provider refund, order REFUNDED, one COMMISSION_REVERSAL; click twice → one refund.
11. `npm run payments:reconcile` → no anomalies.
12. Production credentials + production webhook registration; one small real payment and its refund; reconcile.
13. Schedule reconciliation: set `CRON_SECRET` + `RECONCILE_ADMIN_USER_ID` and add a Vercel Cron entry for `/api/cron/payments-reconcile` (frequency is an owner decision: Hobby allows daily only).

## Real-device smoke test (before pilot, by a person)

iPhone (Safari) and one mid-range Android (Chrome), on mobile data:
1. Scan a pilot QR card with the camera app → Screen #1 opens.
2. Choose each of two worlds; swipe the gallery; tap the world to replay.
3. Write a Georgian message; add a photo from the camera roll and a voice note (mic permission prompt).
4. Preview → open → message → finale; rotate the phone once.
5. Checkout → pay (TEST until the merchant is live) → success view.
6. Scan the same card from a second phone (not the sender) → sealed world → open → finale; voice plays with the screen on and after unlocking.
7. Low-power mode / reduced motion on: worlds still open and end correctly.
8. Note any stutter, clipped text or audio that will not start.

## Environment

See `.env.example`. Secrets live only in `src/lib/env.ts` (server-only; a
check fails if a client component imports it). `NEXT_PUBLIC_*` holds no
secret. Logs (`lib/log.ts`) carry ids and states only — never tokens,
signatures, payloads or greeting content.

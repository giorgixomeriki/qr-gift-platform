# Payment reconciliation: schedule, alerts, response

Status: **prepared, not applied.** No production cron job exists. Apply only
when the payment go-live is approved, in the same change as the BOG variables.

## What a run does

`GET /api/cron/payments-reconcile` lists every disagreement between money and
records, repairs only what the bank confirms or what is internal, and alerts on
what is left. Safe to run repeatedly or concurrently.

| Kind | Severity | Repair |
| --- | --- | --- |
| `STALE_PENDING` | info | Asks the bank; settles from its answer |
| `PAID_NOT_ACTIVATED` | critical | Activates (idempotent) |
| `PAID_QR_NOT_ACTIVATED` | critical | Activates a DRAFT QR; other states are for a person |
| `DUPLICATE_CAPTURE` | critical | Refunds the extra charge through the bank |
| `REFUND_AWAITING_PROVIDER` | warning | Asks the bank; re-sends with the same idempotency key |
| `CAPTURED_NOT_APPLIED`, `PAID_WITHOUT_CHARGE`, `COMMISSION_MISSING`, `COMMISSION_NOT_REVERSED`, `AMOUNT_MISMATCH`, `REFUND_REJECTED`, `STATUS_MISMATCH`, `ACTIVE_WITHOUT_PAYMENT` | critical | Person decides |
| `REFUND_PENDING`, `EXTERNAL_REFUND`, `MISSING_PROVIDER_REFERENCE` | warning | Person decides |

`ACTIVE_WITHOUT_PAYMENT` reports a greeting id, because no order explains it.

## Prerequisites

1. The owner admin exists, and `RECONCILE_ADMIN_USER_ID` is that `admin_users.user_id`
   (`docs/security/ADMIN_MFA.md`). Not the demo admin: revoking the identity
   makes the job fail with 500 until this variable is updated.
2. A random `CRON_SECRET` of at least 32 characters, marked Sensitive.
3. Optional: `PAYMENT_ALERT_WEBHOOK_URL`, marked Sensitive. Receives
   `{ "text": "...", "alert": { ... } }`; `text` is what Slack-style incoming
   webhooks display.

## Steps (owner, Render dashboard)

1. **Web service `qr-starr` → Environment:** add the variables above with
   *Save only*; they apply with the next deploy.
2. **New → Cron Job** `qr-starr-payments-reconcile`, region Frankfurt:
   - schedule: `15 * * * *` (hourly; stale after 30 minutes, refunds after 1 hour);
   - command: `curl -fsS --max-time 240 -H "Authorization: Bearer $CRON_SECRET" https://qrapp.ge/api/cron/payments-reconcile`;
   - environment: the same `CRON_SECRET`.

   Render bills Cron Jobs per run-minute. Any scheduler sending this request
   works, but must treat non-2xx as a failure. On the Free web plan the first
   request also wakes the service, hence the long `--max-time`.
3. Turn on Render's failure notifications for the job.

`vercel.json`'s schedule does not run on Render. Keep `render.yaml` without
`CRON_SECRET` until go-live (`verify:low-cost-hosting` asserts it).

## Verify after setup

| Check | Expected |
| --- | --- |
| Request with no header | 401 |
| Manual job run | 200 with `{"anomalies":N,"repaired":M,"repairFailures":F,"remaining":R,"alerted":A}` |
| Web logs | `scope: "paymentReconcile"` only when something needs attention |

Before the variables are set the endpoint is 404. A 500 means the run could not
work; check `RECONCILE_ADMIN_USER_ID` first.

## When an alert arrives

Alerts contain only kinds, counts and 8-character ids: no greeting content,
tokens, provider references or payer data. The same open set is re-sent at most
once every 24 hours; a change is sent at once.

Full details, read-only, using operator credentials:

```
npm run payments:reconcile -- --admin <admin user id>
```

Add `--apply` to run the same safe repairs on demand. Everything marked
*Person decides* needs the order checked against the BOG portal first. Never
edit `orders`, `payments` or `partner_ledger_entries` by hand.

## Limits

- A charge the bank recorded but QR Starr never heard of needs BOG's own
  transaction listing (`docs/PAYMENTS.md`).
- `npm run verify:reconciliation` covers these paths against a BOG simulator.
  None of it has run against real BOG yet.

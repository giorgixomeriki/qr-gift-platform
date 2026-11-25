# BOG refund hardening + M6 readiness (2026-11-26)

Branch `fix/bog-refund-receipt` from live `d449fd4`. Code only: **no migration,
no env change**. Refunds stay off in production (`BOG_REFUNDS_ENABLED=false`).

## Defects fixed

| # | Defect (live d449fd4) | Effect | Fix |
|---|---|---|---|
| R1 | A 4xx on the refund call marked the refund REJECTED even when BOG held the refund (first answer lost → automatic retry answered 409/400) | money returned, books stay PAID, commission not reversed, admin shown "refund rejected — contact customer" → risk of a 2nd manual refund | refusal is final only if BOG's receipt shows no refund (`refunds.ts`); a 4xx that answered a retry is UNKNOWN (`BogApiError.afterRetry`, `bog-provider.ts`) |
| R2 | Concurrent refund requests (double click, admin + reconcile) each called BOG | duplicate in-flight calls (same key; a conflict answer then triggered R1) | per-refund transaction advisory try-lock + re-read before sending (`refunds.ts`) |
| R3 | A 2xx with an undocumented key was treated as a refusal | same as R1 | treated as UNKNOWN → stays REQUESTED (`bog-provider.ts`) |
| R4 | `mapReceipt` threw on a refunded receipt without `transfer_amount`; after a full refund BOG reports `transfer_amount 0.0` | callback 500 + reconcile error → refund completion stalls | refund-state receipts map the charge from `request_amount`, never throw (`receipt.ts`) |

Simulator now matches BOG's documented behaviour: Idempotency-Key replay returns
the original answer; full refund → `transfer_amount 0`; new knobs for lost answer,
repeat-409 and receipt lag.

Invariant now tested: **an uncertain bank answer never produces a final REJECTED**,
and **one refund row = at most one bank refund action**.

## Evidence (isolated DBs qr_bog_refund / qr_bog_drill, :59422)

Red/green: new tests on the ORIGINAL code → bog-integration 6 FAIL (19a, 19l, 19m,
19o, 19p, 19q), bog-adapter 4 FAIL (2k, 2l, 8g, 10e). On the fix: all pass.
bog-adapter 71, bog-integration 89, reconciliation 48, chargebacks 22,
payment-integrity 45, payment-release 52, m1-hardening 33, m1-pilot-price 52,
partner-attribution 59, commercial 19, phase3 30, phase5 41, payout-concurrency 7,
payout-items 49, pilot-protections 39, env-guards 36, data-api-lockdown 47,
ops-preflight 13, drill:free-tier 20 (fresh DB, prod build). tsc + lint clean.

Non-financial bank checks (2026-11-25/26, prod credentials, no money):
credentials 6/6; `POST /payment/refund/<nonexistent>` → 400 "Invalid order_id"
(authorized, no permission error); `POST /payment/authorization/cancel/<nonexistent>`
→ 400 "Invalid order_id" (pre-auth only; we capture automatically); undocumented
reversal/cancel paths → generic 400. Receipt of the 2026-11-17 M1 payment:
`completed`, 1.0 GEL, Google Pay, refund null, no actions (refundable).

## Refund vs reversal

BOG publishes ONE operation for captured payments: `POST /payment/refund/:order_id`
(full if `amount` omitted, partial with `amount`; Idempotency-Key optional, we always
send one). No public reversal endpoint; `authorization/cancel` is for pre-authorized
orders only. Whether a same-day refund settles as a reversal is internal to the
bank. If the receipt ever shows a status we don't know, nothing is booked or
re-sent and the refund is listed as REFUND_AWAITING_PROVIDER after 1 h.
The app refunds the full charge only (DB `payment_refunds_integrity`).

## Production deploy (needs explicit owner approval)

1. Coordinate with other sessions; confirm live = d449fd4 (dep-dc3jk8tbedkc73cefh5g).
2. No migration, so no backup gate; still record the money fingerprint before.
3. `git push origin <fix commit>:feat/render-low-cost-hosting` (fast-forward of
   d449fd4), outside :10–:25 (cron at :15/:17).
4. Post-checks: health 200, BOG webhook unsigned → 400, cron unauthenticated → 401,
   env unchanged (`CHECKOUT_ENABLED=false`, `BOG_REFUNDS_ENABLED=false`), money
   fingerprint identical, next cron run 200.

Rollback: redeploy `dep-dc3jk8tbedkc73cefh5g` (d449fd4). Nothing to undo in the DB.
While refunds are disabled the only live-path change is receipt mapping for
refund-state receipts and the `afterRetry` flag on BOG errors.

## M6 — real 1.00 GEL refund (each step needs explicit owner approval)

Fact: production has **0 BOG payments**. The only real 1.00 GEL payment (2026-11-17,
order c3968776…) was made through the local staging app; its books live in the
local staging DB, not in production.

Recommended (full lifecycle in production books):
1. Deploy this fix (above).
2. M1-prod: set LEGAL_EFFECTIVE_DATE + CHECKOUT_PILOT_QR_IDS (one owner card) +
   CHECKOUT_PILOT_PRICE_MINOR=100, keep CHECKOUT_ENABLED=false; owner pays 1.00 GEL.
   Verify (scripts/ops/m1-verify.sql -v amount=100): order PAID 100, commission 30,
   platform 70, greeting + QR ACTIVE, one PAYMENT_SUCCEEDED, BOG receipt completed.
3. M6 window: set BOG_REFUNDS_ENABLED=true (env + redeploy); admin (MFA) presses
   Refund once on that order; expect "pending".
4. Expected immediately: payment_refunds REQUESTED (reason ADMIN, 100, action id set),
   order still PAID, ledger COMMISSION_EARNED +30 only.
5. Bank completes (bank: 2–3 days; same-day may be faster): callback or hourly
   reconcile → refund COMPLETED, payment REFUNDED, order REFUNDED,
   ledger +30 / −30 (partner net 0), audit PAYMENT_REFUND_REQUESTED + ORDER_REFUNDED,
   BOG receipt refunded / refund_amount 1.0 / transfer 0.0, no anomalies.
   Greeting and QR stay ACTIVE (current business rule; changing it is an owner decision).
   Bank fee: read the BOG statement; nothing in the app assumes whether the fee is returned.
6. Set BOG_REFUNDS_ENABLED=false again until refunds are needed operationally.
Stop conditions: refund REJECTED, receipt status unknown, any second refund action at
BOG, ledger not exactly +30/−30 → stop, do not retry by hand, investigate.

Alternative (no new payment): refund the 2026-11-17 staging payment through the
fenced staging kit — tests the bank but not production books; the kit's app would
first need this fix.

# M1 at 1.00 GEL — pilot price override (owner-only)

Branch `release/m1-pilot-1gel`, a fast-forward of live **5838e75** (`dep-dc1aednb9u1s7382cip0`). Local only. Supersedes the 10.00 GEL amounts in `M1_PRODUCTION_PAYMENT.md` §3–§4; everything else there still applies.

## 1. What changes

| # | Change |
|---|---|
| C1 | `CHECKOUT_PILOT_PRICE_MINOR` (new env var). When set, the **one** card in `CHECKOUT_PILOT_QR_IDS` is priced at that amount (tetri) while `CHECKOUT_ENABLED=false`. `lib/payments/pilot-price.ts`. |
| C2 | `startCheckout` snapshots the pilot amount into the order (gross 100, commission `floor(100 × 3000 / 10000)` = 30, platform 70). `price_id` stays empty, because no prices row was charged. An audit row `PRICING_PILOT_PRICE_APPLIED` records the amount, the standard price id and the standard amount (1000). |
| C3 | The display price (Sender Entry and the preview CTA) shows 1.00 ₾ on the pilot card only. The checkout screen already shows the order snapshot. |
| C4 | `createPaymentAttempt` refuses to open a bank payment when the order's amount is no longer the card's price (`PilotPriceMismatchError`): a pilot-priced order after the override is withdrawn, or a 10.00 order on a card that became the 1.00 pilot. |
| C5 | **Pre-existing gap fixed:** two simultaneous Pay presses on one order (double tap, two tabs) used to open **two** BOG orders, and both were payable. `acceptCheckoutTerms` now holds a per-order advisory try-lock across check → consent → BOG create. The second press gets `PAYMENT_IN_PROGRESS`. |

What stays the same: the `prices` table (never written; public price 10.00 GEL), the pilot gate, consent, the BOG adapter, callback signature, receipt amount/currency check, activation, ledger, reconciliation, Supabase Cron, and refunds (still off).

Fail-closed startup validation: the value must be an integer 100–100000. Exactly one pilot card must be listed. `CHECKOUT_ENABLED=true` is rejected. The override is also ignored at runtime when public checkout is on, when the policies are not in force, or for the TEST provider in production.

Browser manipulation: the server actions take only `greetingId` (+ locale). The card id comes from the greeting row and the amount from the server env. Injected fields are ignored (test R2).

## 2. Evidence (local, isolated DB `qr_m1_1gel`, BOG simulator)

- `verify:m1-pilot-price` **52/52**, groups P (config), Q (amount chain), R (isolation), S (idempotency, duplicates, callbacks, mismatch). Before C5, S6 failed: 2 BOG orders and 2 open payments.
- Regression: m1-hardening 33, bog-integration 71, bog-adapter 66, payment-release 52, reconciliation 48, payment-integrity 45, pilot-protections 39, commercial 19, chargebacks 22, env-guards 36, partner-pricing 70, low-cost-hosting 55, qr-handover 114, all green. tsc and eslint clean.
- Amount chain: display 100 → order 100/30/70 → BOG `total_amount: 1`, `unit_price: 1 × 1`, GEL → payment 100 → receipt 1.00 → PAID → `COMMISSION_EARNED 30`.
- Real wire, earlier: on 2026-11-17 a real 1.00 GEL payment on the same merchant (staging app, production credentials) completed; the BOG receipt gave `transfer_amount "1.0"`. Evidence is in that kit's M1_EVIDENCE.md.

## 3. Release (each step needs separate owner approval)

1. **Preflight (read-only):** `psql "$MIGRATIONS_DATABASE_URL" -v qr=<pilot> -f scripts/ops/m1-pilot-preflight.sql`. Every gate must be `t`.
2. **Deploy code only:** fast-forward `feat/render-low-cost-hosting` 5838e75 → this branch. Do it outside `:10–:25`. No env change, no migration. Behaviour is identical while the new var is unset.
3. **Smoke:** `/api/health` 200; unsigned BOG webhook 400; cron without secret 401; a DRAFT card shows "payments open soon".
4. **Env (owner, Render single-key PUT, then one deploy/restart):**
   - `LEGAL_EFFECTIVE_DATE=<legally approved date, ≤ today Tbilisi>`. This also publishes the date on the legal pages.
   - `CHECKOUT_PILOT_QR_IDS=00794e0b-9d14-4529-8c05-8a43f9bfb781`
   - `CHECKOUT_PILOT_PRICE_MINOR=100`
   - `CHECKOUT_ENABLED` stays `false`.
5. **Gate check before paying:** another card shows "payments open soon". The pilot card shows **1 ₾** on entry, preview and checkout. `m1-pilot-preflight.sql` still passes, except `card_has_no_greeting` once the owner has started writing.
6. **M1** (owner pays). Then verify with `psql … -v qr=<pilot> -v amount=100 -f scripts/ops/m1-verify.sql`; every invariant must be `t`.
7. **After M1:** unset `CHECKOUT_PILOT_PRICE_MINOR` and `CHECKOUT_PILOT_QR_IDS` together, then restart.

**Expected M1 result:** orders +1 PAID 100 (price_id empty); payments +1 BOG SUCCEEDED 100; ledger +1 COMMISSION_EARNED 30 for `demo-flowers` (platform 70 before BOG's fee, which has a 0.10 GEL minimum); the pilot card ACTIVE; prices unchanged.

## 4. Rollback

- **Pilot off at once:** unset `CHECKOUT_PILOT_PRICE_MINOR` + `CHECKOUT_PILOT_QR_IDS`, then restart. An open 1.00 order can then never reach BOG (C4); a paid one stays final (test S4).
- **Price back to 10.00 for the pilot card:** unset only `CHECKOUT_PILOT_PRICE_MINOR`. An open 1.00 order is refused (R6) and is not re-priced automatically, so that card stays unpayable. Use a different pilot card for a later 10.00 run.
- **Code:** roll back to `dep-dc1aednb9u1s7382cip0` (5838e75). **First unset `CHECKOUT_PILOT_PRICE_MINOR`:** 5838e75 ignores the variable and would price the pilot card at 10.00. No migration, no data change.

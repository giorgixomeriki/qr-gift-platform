# M1: first real BOG payment in production (owner-only, Render Free)

Branch `release/m1-hardening`, built on live **ae7a0ab** (`dep-dc0selec6qcc73btprt0`). Local only until the owner approves the release.

## 1. What changed (and why)

| # | Change | Why |
|---|---|---|
| H1 | **No second charge on a revisit.** A sender who comes back to the card **without** BOG's return link while a BOG attempt is still open is shown "still verifying" (no Pay button). The server first asks BOG (`settleOpenBankAttempt` → `verifyAndReconcileOrder`, the existing idempotent path). If BOG charged it, the card is activated on the spot. `acceptCheckoutTerms` refuses a second BOG payment while one is open (`PAYMENT_IN_PROGRESS`). | Before, the revisit showed Pay again. With a callback lost on a Render cold start, that was a **double charge**, and refunds are manual in production (`BOG_REFUNDS_ENABLED=false`). |
| H2 | **Pending screen** (ka/en): "your payment is being verified; if charged, don't pay again; we activate after confirmation; you can pay again once the earlier attempt expires (≤ 30 min)", plus the support email from `MERCHANT_SUPPORT_EMAIL`. Automatic, bounded re-checks at 15 s, 30 s, 1 min, 2 min and 4 min (≈ 7.5 min), then "Check again" only. | Clear and honest waiting state; bounded polling. |
| H3 | **Owner pilot gate** `CHECKOUT_PILOT_QR_IDS` (≤ 3 QR UUIDs, validated at startup). With `CHECKOUT_ENABLED=false`, only the listed card(s) can pay. The pilot still needs `LEGAL_EFFECTIVE_DATE` in force and uses the same consent, provider and money path. The reconcile monitor counts it as "payments live". | Lets the owner make M1 without opening checkout to the public. DRAFT greetings by real visitors keep growing (31 today), so even a short public window could take real customers' money. |

Unchanged: the callback, signature check, receipt verification, amount/currency check, `confirmPaymentSuccess`/activation, ledger, reconciliation, refunds, and Supabase Cron.

## 2. Evidence (local, isolated DB `qr_m1_tests`, BOG simulator)

- `verify:m1-hardening` **33/33**: pilot gate A1–A13, revisit B1–B9, missed callback C1–C4, concurrency D1–D3, failure/amount E1–E4.
- Regression suites:

  | Suite | Result |
  |---|---|
  | payment-release | 52/52 |
  | bog-integration | 71/71 (§16 now also asserts the guard) |
  | bog-adapter | 66/66 |
  | reconciliation | 48/48 |
  | payment-integrity | 45/45 |
  | pilot-protections | 39/39 |
  | commercial | 19/19 |
  | chargebacks | 22/22 |
  | env-guards | 36/36 |
  | low-cost-hosting | 55/55 |

- tsc and eslint clean.
- Free-tier drill: see §5 of the final report / `RENDER_FREE_PAYMENTS.md`.

## 3. Release plan (each step needs owner approval)

1. **Deploy code only:** fast-forward `ae7a0ab → <this branch>` on `feat/render-low-cost-hosting`, outside `:10–:25`. No env change, so the public behaviour is identical (checkout closed). Coordinate with the other sessions; no one else may push in between.
2. **Smoke:** `/api/health` 200; unsigned webhook 400; cron without secret 401; a DRAFT card still shows "payments open soon".
3. **Owner sets two env vars** (Render, single-key PUT, then restart):
   - `LEGAL_EFFECTIVE_DATE=<owner-approved date>`. It also publishes the date on the legal pages, and must be ≤ today (Tbilisi);
   - `CHECKOUT_PILOT_QR_IDS=00794e0b-9d14-4529-8c05-8a43f9bfb781`.

   `CHECKOUT_ENABLED` stays `false`.
4. **Verify the gate before paying:** another DRAFT card still shows "payments open soon"; the pilot card shows the price 10.00 GEL and the consent box.
5. **M1** (§4).
6. **After M1:** remove `CHECKOUT_PILOT_QR_IDS` (or keep it for M6), restart.

**Rollback:**
- unset `CHECKOUT_PILOT_QR_IDS` (closes the pilot at once after restart);
- or roll back to `dep-dc0selec6qcc73btprt0` (ae7a0ab). No migration is involved.

## 4. M1 procedure (owner)

**Pilot card:**
- `qr_codes.id 00794e0b-9d14-4529-8c05-8a43f9bfb781`, partner `demo-flowers` (30% commission), batch "ტესტ", AVAILABLE, NOT_DISTRIBUTED, no greeting, no order;
- its URL is in `~/.qrapp-review/m1-pilot-card.txt` (0600; it is a capability, so don't share it).

**Baseline (production, 2026-11-21 21:3xZ):**
- orders: 2 PAID, 20.00 GEL;
- payments: 2 TEST SUCCEEDED;
- refunds: 0;
- ledger: 2 COMMISSION_EARNED, 6.00 GEL;
- payouts: 0;
- QR: ACTIVE 2 / DRAFT 31 / AVAILABLE 169;
- migrations: 26.

The session re-reads this immediately before M1.

**Expected result:**
- one new order, 10.00 GEL, PAID;
- one BOG payment SUCCEEDED, 10.00 GEL;
- one COMMISSION_EARNED of 3.00 GEL to `demo-flowers` (platform share 7.00);
- the pilot card ACTIVE, the greeting ACTIVE;
- no other change.

**Steps:**
1. Phone, mobile data or Wi-Fi. Open the pilot URL. Write a short message, preview, then Checkout.
2. Check that the price shows **10.00 ₾**. Tick consent and press Pay. BOG's page opens.
3. Pay with your own card.
   - Expected: BOG returns to the card, "Confirming your payment…" shows, then the success screen.
   - If Render was asleep, the return page can take 30–90 s or show a 503: reload. **Do not pay again.**
4. If it says "still verifying", wait. The page re-checks by itself for about 7.5 min. Reconciliation settles it at the latest at the next `:17` after 30 min.
5. Open the card URL again: the greeting should show (recipient view). Check it on mobile.
6. Tell the session the time of payment. The session then verifies (§5).

**Success criteria (M1 PASS):**
- BOG shows one completed payment of exactly 10.00 GEL;
- orders +1 PAID, payments +1 BOG SUCCEEDED 1000;
- ledger +1 COMMISSION_EARNED 300 for `demo-flowers`;
- pilot QR ACTIVE;
- no duplicate payment or activation;
- reconciliation run after M1 is clean;
- no secret in logs.

**If anything is off:**
- never pay a second time;
- the session diagnoses with BOG's receipt (read-only) plus reconciliation;
- a charged-but-not-activated card is repaired by reconciliation or by opening the card again (H1);
- a refund is M6, with separate approval.

## 5. Remaining limitations on Render Free (only Starter removes them)

- **Cold start** 26–90 s (measured 26.5, 36.6, 53.6, 86.8 s). A request during boot may get a 503. A BOG callback that hits a cold instance may be lost (BOG documents no retry). The return check, the H1 revisit and hourly reconciliation recover it. Worst case without any customer action: about 30 min + up to 60 min (≈ 1.5 h).
- **Free hours:** 750/month per workspace. Hourly wake ≈ 300–350 h/month (68 h used Nov 1–21).
- **One instance**, 512 MB, no zero-downtime guarantees during deploys.

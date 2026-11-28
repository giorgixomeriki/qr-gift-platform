# BOG payments on Render Free — reliability assessment (2026-11-21)

Owner decision: the BOG release stays on **Render Free**. No plan upgrade, no hosting change.
This document asks one question: can callbacks, payment verification and reconciliation stay **safe** on Free?
It also defines the gates that block the release if they cannot (`PRODUCTION_CHECKLIST.md` §C).

## 1. Facts

| Fact | Source |
|---|---|
| Free stops the instance after 15 min idle; the next request cold-starts it | Render |
| Cold start on qrapp.ge: **36.6 s**, request held, 200; later requests 0.23–0.27 s | measured 2026-11-21 (`/api/health`) |
| A cold start can also answer **503** (2 of 20 crawl requests) | website audit G6 (`docs/bog-merchant-readiness/QR_STARR_WEBSITE_COMPLIANCE_AUDIT.md`) |
| Memory: peak 277 MB of 512 MB (7 days); no OOM, failed-deploy or suspend events | Render metrics/events API |
| Free hours: 750/month per workspace, shared with `insurancecomparison-backend`. Last 30 days: qr-starr awake in ≤ 92 hour-buckets, the other service in 0 | Render metrics API |
| **BOG documents no callback retries and no timeout.** "If callback was not received successfully, business must use the Get Payment Details method" | api.bog.ge/docs/en/payments/standard-process/callback |
| Refund callbacks are also `event: "order_payment"` | same page |
| The repository is public: Actions minutes are free, but GitHub disables scheduled workflows after 60 days without repository activity | GitHub |

**Consequence:** the design must never depend on a callback arriving.

## 2. How a payment is settled

1. **Callback** (`POST /api/webhooks/payments/BOG`). It is signature-checked, and the state comes from a fresh BOG receipt, never from the body. It answers 200 only after the database commit.
2. **Return check.** The buyer lands on `/g/<token>` from BOG's page. The page polls `checkPaymentReturnAction`, which asks BOG's receipt.
3. **Scheduled reconciliation.** It runs hourly at :15 through the GitHub workflow. The caller first wakes the service (up to 6 health attempts, 90 s each, 15 s apart), then calls with up to 3 attempts and backoff. It repairs:
   - `STALE_PENDING` (attempt older than 30 min): asks BOG;
   - `PAID_NOT_ACTIVATED`: activates;
   - `REFUND_AWAITING_PROVIDER` (older than 1 h): asks BOG, re-sends with the same Idempotency-Key.

Money capture commits on its own, before activation (`confirmPaymentSuccess`). A crash between the two leaves PAID + DRAFT, which (3) repairs. A customer is never asked to pay twice.

### When does a callback hit a sleeping instance?

- **Payment callback:**
  - normally no. The buyer's own requests seconds or minutes earlier keep the instance awake for 15 min;
  - cold only if the buyer stays more than 15 min on BOG's page. In that case the buyer's return is also a cold request (36 s wait, or a 503 page; a reload works).
- **Refund callback:** almost always cold. BOG settles refunds 2–3 days later.

## 3. Drill: `npm run drill:free-tier`

`scripts/drill-free-tier-payments.ts` runs the **production build** with `PAYMENTS_PROVIDER=BOG`. Its setup:
- an emulator in front of it behaves like Render Free: it stops the app when idle, and on the next request either holds the request or answers 503 while the app boots;
- the BOG simulator sends RSA-signed callbacks over HTTP;
- the real `.github/scripts/payments-reconcile.sh` acts as the scheduler.

The drill uses its own fresh database (0000 → 0024), with no real money and no network beyond 127.0.0.1.

Prerequisite:
```
NEXT_PUBLIC_APP_URL=http://localhost:3870 next build
```
Run it with the local stack env exported. `DRILL_BOOT_DELAY_MS=30000 DRILL_WAKE_SLEEP=15` emulates Render's ~31–37 s cold start with the caller's real wake interval.

| # | Scenario | Expected (all must pass) |
|---|---|---|
| 0a | Warm callback | 200, PAID once |
| 1a | Idle spin-down | instance stopped |
| 2a | Cold callback, request held | 200 after boot, PAID once |
| 2b | Cold callback, BOG gives up before boot | PAID once, or untouched PENDING (settled in 4b); never partial |
| 3a–b | Cold callback answered 503, no retry | paid at the bank, still PENDING here: no false FAILED, no activation |
| 4- | Reconcile inside the 30-min window | left PENDING |
| 4a–d | Reconcile against a **sleeping** instance (503 cold start) | caller retries to 200; both lost payments PAID once; run clean; second run changes nothing |
| 5a | BOG-style retry after a 503, three concurrent | one commission |
| 6a–b | Instance SIGKILLed while handling a callback | money booked once (activation may lag) or untouched; never live without payment; next run repairs, clean |
| 7a–c | Refund callback lost to a cold 503 | reconciliation completes it: REFUNDED, commission reversed once |
| 8a–c | BOG receipt unavailable during reconcile | nothing guessed (stays PENDING); the run is red; the next run settles it |

Results (2026-11-21, release branch, evidence `/Users/Shared/qr-starr-bog-free-tier-2026-11-21`):
- **fast boot (≈1 s): 20/20 passed**
- **Render-like 30 s cold start (31.1–31.4 s boots, caller WAKE_SLEEP 15): 20/20 passed**. 2b went the "dropped" way (BOG timed out at 10 s) and was settled in 4b; 6a went the "money booked, activation lagging" way and was repaired in 6b.

The emulator itself needed two fixes: a stuck boot promise, and a half-open proxied request that blocked shutdown. Neither was an app defect.

## 4. Risks and gates

| # | Risk on Free | Effect | Mitigation / gate |
|---|---|---|---|
| F1 | Callback lost to a cold start (BOG: no documented retry) | Activation is delayed, never wrong. Buyer back on the page: immediate. Buyer not back: **up to ~30 min + 60 min + GitHub delay (≈ 2 h)** | Return check, plus reconciliation. **Gate C4/G: schedule live and green before checkout opens** |
| F2 | Refund callback lost (almost always on Free) | Refund marked COMPLETED in our books up to ~2 h after BOG settles; the money itself is already back with the buyer | Reconciliation (`REFUND_AWAITING_PROVIDER`); drill 7c |
| F3 | Reconciliation stops: GitHub's 60-day inactivity disable, or a secret/env mistake | Lost callbacks are no longer recovered; dashboard red after 150 min | Weekly look at the dashboard reconcile panel (owner); keep the repository active; red run = act. **Blocker if not green at launch** |
| F4 | Free hours exhausted (750/month, shared) | Every Free service is suspended until the month resets: site, callbacks and reconciliation all stop | **Gate C3:** < 500 h used before launch. Re-check mid-month. Estimate with hourly reconcile: ~300–350 h |
| F5 | Buyer returns from BOG to a cold instance | 36 s wait or a 503 page; payment safe; reload works | Accept. The success page needs no change. |
| F6 | Instance restart or crash during a callback | PAID_NOT_ACTIVATED until the next run | Drill 6a/6b; reconciliation |
| F7 | BOG's callback timeout is unknown | If shorter than a cold start, BOG sees a timeout; our state stays consistent (drill 2b) | Ask BOG (T6); no code change needed |
| F8 | Reconcile schedule more frequent than hourly | The instance would stay awake, about 720 h/month, and exhaust F4 | **Keep hourly** |

## 5. Verdict

**No technical reason makes an always-on paid plan necessary for *safe* payment processing**, provided both of these hold:
- the reconciliation schedule is live and green before checkout opens (C4/G);
- Free hours stay well under 750 (C3).

On Free, every payment path tested settles **exactly once**:
- a callback lost to a cold start;
- a callback that timed out at BOG;
- a 503 cold start;
- a crash mid-callback;
- a refund callback lost to a cold start;
- a BOG outage during reconciliation.

None of them led to a false FAILED, an activation without payment, or a double commission.

What Free costs is **latency, not correctness**: a buyer who doesn't return from BOG can wait up to ~2 h for the card to activate when the callback is lost.

Starter becomes necessary, as an **operational** rather than safety requirement, when any of these is true:
- the owner does not accept that worst-case activation delay;
- Free hours approach the cap (traffic growth);
- the reconciliation schedule cannot be kept reliably green.

Any failed gate in `PRODUCTION_CHECKLIST.md` §C is a release blocker. It is never waived because of the Free plan.

# QR Starr — BOG payment activation plan, 2026-11-16 (update)

> **Superseded for the release (2026-11-21):** production took 0022 for Our Song, so the consent migration ships as **0023_checkout_consents**, followed by **0024_payment_release_safety**, rebased onto live f575182. Release plan: `docs/bog-release/BOG_RELEASE_2026-11-21.md`.

This continues `PAYMENT_READINESS_2026-11-16.md`. Production is unchanged:
2e17037 on Render **Free**, PAYMENTS_PROVIDER=TEST, CHECKOUT_ENABLED=false, no
BOG_*, CRON_SECRET or RECONCILE_ADMIN_USER_ID set (read via the Render API, values not printed).

## 1. Credentials

**Where (owner only; Business Manager shows them only to the authorised person):**
https://manager.bog.ge/login → sign in with the Internet Bank user →
**გადახდების მენეჯერი** (Payments Manager) → **გადახდის მეთოდების მართვა**
(Payment methods) → open the `qrapp.ge` object → copy **Client ID** and
**Client Secret**.

**Into:** `/Users/Shared/qr-starr-device-tests/2026-11-16-bog-live/bog.env`
(mode 0600, directory 0700, outside every repository). The URLs and BOG's public
callback key are pre-filled. Paste only the two values after `=`. Do not paste
them into chat, email or a terminal command.

**Then (no money, no order):**
`node --env-file=<that file> node_modules/.bin/tsx scripts/ops/bog-credentials-check.ts`
checks: https bog.ge hosts · callback key = BOG's documented key · OAuth token issued ·
`GET /receipt/<random>` → 404 (token authorised). It prints PASS/FAIL and status codes only.

Status: **not yet run.** The file has the template only.

## 2. Checkout (release candidate on this branch)

| Requirement | State |
| --- | --- |
| Seller name, registered ID code, legal address, country | Shown at checkout through the existing publication gates (c7c80a9) |
| Price 10 GEL | Server price snapshot (`orders.gross_amount_minor`), "10 ₾" plus "Price in Georgian lari (GEL)". BOG receives 10.00 GEL (bog-integration 2a) |
| Terms, Privacy, Refunds and Contact links | On the checkout screen, opening in a new tab |
| Required consent | Unticked checkbox directly above Pay. Pay stays disabled until it is ticked |
| **Server-side consent evidence** | `checkout_consents` (migration 0022): order, greeting, time, language, SHA-256 of the exact sentence shown, the policies' effective date. Append-only (app role: SELECT/INSERT), RLS scoped to the sender's own open order. **The BOG payment is created only after this row exists**, and checkout entry no longer opens a bank payment (455d97d) |
| Effective-date handling | Real-money checkout stays **closed** unless `LEGAL_EFFECTIVE_DATE` is set **and** reached on Tbilisi time, even with CHECKOUT_ENABLED=true. TEST mode is unaffected. No date is set anywhere in production |

Verification (targeted): tsc, eslint and build pass. Suites: site-content 65/65, bog-integration 47/47
(5 new: closed without/before the date, no BOG payment before consent, consent
row before the payment, foreign token refused), reconciliation 48/48,
data-api-lockdown 47/47, payment-integrity 45/45, chargebacks 22/22,
commercial 19/19, pilot-protections 39/39. e2e checkout journeys pass on desktop and mobile.

## 3. Legal / policy blockers

- **L1:** `LEGAL_EFFECTIVE_DATE` is unset, and the live Terms, Privacy and Refunds pages read "not yet in
  effect". With this release, real checkout cannot open until the owner, after legal
  review, provides the date. Nothing in the code sets one.
- **L2:** Policies are drafts without recorded legal approval (no evidence on file).
- **L3:** `MERCHANT_VAT_STATUS` is unset (optional, owner or accountant).

## 4. Real-money test (staging)

**Environment:** private kit in `/Users/Shared/qr-starr-device-tests/2026-11-16-bog-live/staging/`
(not in git).

- **App:** this branch, built with `next start` on 127.0.0.1:3850, using the local **qrkeys** Supabase stack only. No production data and no customer greetings.
- **Data:** the partner `bog-staging` (30%, explicit 10.00 GEL price) and 5 staging QR codes.
- **Exposure:** cloudflared quick tunnel → `gateway.mjs` (:8930). It allows only those 5 `/g/` pages, `POST /api/webhooks/payments/BOG`, policy pages and build assets. Admin, partner, other APIs and storage return 404 (verified). Its log records no tokens or bodies.
- **Settings, staging only:** BOG, CHECKOUT_ENABLED=true, BOG_REFUNDS_ENABLED=true. `LEGAL_EFFECTIVE_DATE` is set for the private test only, marked as not a legal approval, and never copied to production.
- **Scripts:** `start.sh` runs the credential check, then provisioning, tunnel, build, app and gateway. `stop.sh` stops them. `staging-ops.ts` offers `status | reconcile [--apply] | refund <order> --owner-approved`.

**Bank permission (unconfirmed):** BOG's docs take `callback_url` and
`redirect_urls` per order, and the docs list no domain allow-list. Whether the bank
**permits** live credentials on a non-qrapp.ge test domain, how refunds count against the
limit, and whether fees are returned are **not documented**. Ask before running (§6 draft).

**Procedure (each step needs the owner's go; the owner pays with their own card):**

| Step | Action | Expected | Charge |
| --- | --- | --- | --- |
| T1 | S1: write a greeting → Pay 10 GEL on BOG's page | Signed callback 200; order PAID, greeting ACTIVE, QR ACTIVE once; ledger COMMISSION_EARNED 300; 1 consent row before the payment | 10.00 |
| T2 | S2: Pay → **cancel** on BOG's page | Back on the card: "cancelled"; order stays unpaid; Pay works again | 0 |
| T3 | S2 retry: pay 10 GEL, **close the tab** on the bank's success page, reopen the card | Status from the receipt or callback, never the URL; single activation | 10.00 |
| T4 | Duplicates: count the callback POSTs per order in `gateway.log` (BOG may send more than one). A body replay is covered only in simulation (bog-integration 3c), because bodies are deliberately not logged | Any extra callback is 200 with no change: still one activation and one commission | 0 |
| T5 | `staging-ops.ts reconcile` | No anomalies | 0 |
| T6 | `refund <T1> --owner-approved` | REQUESTED → BOG callback → REFUNDED; COMMISSION_REVERSAL −300 once | −10.00 |
| T7 | `refund <T3> --owner-approved` | Same | −10.00 |

**Money:** 20.00 GEL charged, 20.00 GEL refunded. The fee at the bank's quoted rate
(local card 2%, min 0.10 GEL) is **0.20 GEL per payment, up to 0.40 GEL net** if fees
are not returned on refund (unconfirmed). Foreign card 2.5%; Amex 3.5% (min 0.15).
This stays within the 100 GEL test limit even if refunds count against it.

**Stop and rollback:** if any expectation fails, stop at once (`stop.sh`). The tunnel disappears, and BOG
callbacks then fail. That is harmless: reconcile from the receipt later. Refund any captured payment
with `refund … --owner-approved`, or from BOG Business Manager. Nothing in production is
involved.

## 5. Reconciliation readiness

- Code: `/api/cron/payments-reconcile` (live in 2e17037) is 404 until `CRON_SECRET` (≥32
  chars) and `RECONCILE_ADMIN_USER_ID` are set. The owner admin, with MFA, is the only admin.
- Schedule: 4ddc640 (`ops/payments-reconcile-schedule`, local, **not pushed**). An hourly
  GitHub Actions workflow on `main`, inert until the repo variable `RECONCILE_SCHEDULE_ENABLED=true`.
  The secret lives in the `production-reconcile` environment. It wakes `/api/health`, makes one authenticated call, and prints no
  body. It matches the current endpoint contract (404 = unset, 401 = secret mismatch).
- GitHub today: only `ci.yml`. No reconcile workflow, variable or environment exists.
- Behaviour: missed callbacks settle from the receipt. Paid-but-unactivated orders activate
  once. Stale attempts close. Refunds retry with the same Idempotency-Key. Alerts go to the
  structured log unless `PAYMENT_ALERT_WEBHOOK_URL` is set (none today).
- **Render instance: Free** (API `plan: free`). Cold start about 31 s. Recommend Starter before
  LIVE (owner billing decision).

## 6. Draft question to the bank (NOT SENT)

> გამარჯობა ბატონო დავით, გმადლობთ პარამეტრებისთვის. ინტეგრაციის შემოწმებამდე გვაქვს რამდენიმე კითხვა:
> 1. შეგვიძლია თუ არა მიღებული პარამეტრებით სატესტო ტრანზაქციები ჩავატაროთ ჩვენი ცალკე სატესტო მისამართიდან (callback და redirect URL არა qrapp.ge-ზე), თუ ყველა მოთხოვნა უნდა მოდიოდეს მხოლოდ qrapp.ge-დან?
> 2. სატესტო 100 ლარიან ლიმიტში თანხის დაბრუნება (refund) ხელმისაწვდომია? დაბრუნებული თანხა ლიმიტში ითვლება?
> 3. თანხის დაბრუნებისას საკომისიო ბრუნდება?
> 4. თუ ჩვენი სერვერი callback-ზე 200-ს არ დააბრუნებს, რამდენჯერ და რა ინტერვალით მეორდება callback?
>
> პატივისცემით, QR Starr

## 7. Release candidate and deployment plan

Branch `feat/bog-payment-readiness` (from live 2e17037), local only:
c7c80a9 (disclosure) · 06b59e5 (credential check, report) · 455d97d (consent
evidence, policy gate) · this document.

1. **Approval: production DB migration 0022** (additive: new table only, no change to existing
   rows). Apply it before deploying the code.
2. **Approval: deploy.** Fast-forward `feat/render-low-cost-hosting` to the RC and push (a push is
   the deploy). Prod stays TEST and closed. Smoke test: health, /terms, /contact, and checkout on a
   card shows "payments open soon".
3. After §4 passes and L1 is resolved: put the BOG_* values on Render, keep `CHECKOUT_ENABLED=false`,
   redeploy, run the credential check, then set `LEGAL_EFFECTIVE_DATE` (the owner's date).
4. **Separate approval:** `CHECKOUT_ENABLED=true`, then one owner-paid 10 GEL production payment.
   Verify one activation, PAID, commission, consent row, and reconcile clean. Refunding it needs its own approval.
5. **Rollback:** `CHECKOUT_ENABLED=false` (instant). Code: Render rollback to
   dep-dbpku2jm8hqs73a13jc0 (2e17037). Table 0022 can stay; old code ignores it.

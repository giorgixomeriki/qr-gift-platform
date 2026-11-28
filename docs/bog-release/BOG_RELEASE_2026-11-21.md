# BOG payment release — preparation (2026-11-21)

Branch `release/bog-payments-f575182` (worktree `/Users/Shared/qr-gift-platform-bog-release`), local only.
Base: live production **f575182** (Render `dep-dc01qme0tbcc73ahmoj0`). Nothing here is pushed, deployed or applied to production.

## 1. What the branch contains

| Commit | What |
|---|---|
| 877f24d … c88cbd3 | `feat/bog-payment-readiness` (c7c80a9 … e6109ed) rebased onto f575182: checkout seller ID/address + consent, consent evidence, credential check, staging fence, BOG diagnostics, 1.00 GEL lifecycle tests |
| cb24074 | Rebase fix: the envelope lab (new in production) uses the new `merchantSeller` prop |
| 71c4737 | FA-01 + FA-02 (migration 0024) |
| a3e6dc9 | FA-03: scheduled reconciliation, heartbeat, dashboard panel, retrying caller, signed non-`order_payment` callbacks |
| a690e36, 4350882 | `verify:payment-release` (52 checks), fail-closed release guard, admin-mfa allowlist review |

Rebase conflicts were limited to `src/app/g/[token]/page.tsx` (imports: music + seller) and the migration journal.

## 2. Migration plan

Production ledger (read-only, 2026-11-20): `drizzle.__drizzle_migrations` = **23 rows**, last `created_at` **1795161600000** (0022_music_content_type).

| # | Tag | `when` | Branch | Notes |
|---|---|---|---|---|
| 0022 | music_content_type | 1795161600000 | **in production** | data-only |
| **0023** | **checkout_consents** | 1795219200000 | this branch | was `0022_checkout_consents`; renamed, content and `when` unchanged |
| **0024** | **payment_release_safety** | 1795222800000 | this branch | new: 2 policies + 1 trigger, additive |
| 0025 | partner_login_access | 1795334400000 | Partner Auth (stacked on this branch) | renumbered by its session |
| 0026 | partner_locations | must be > 1795334400000 | Partner Map | needs rebase + new `when` |

**Why BOG first:** payments are on the launch critical path and do not depend on Resend/DNS. Every later branch keeps a larger `when`, so none is skipped.

Drizzle applies a file only when its `when` is greater than the last applied `created_at`. Two rules follow:
- never apply a migration with a smaller `when` than one already applied (it would be skipped silently);
- the local staging DB (`qrkeys/postgres`) already has the old `0022_checkout_consents` (`created_at` 1795219200000) and **no music row**. Running `db:migrate` there would skip 0022 music. Use a fresh staging DB (or insert the `music` content type by hand) before staging tests.

Verified: a fresh database migrates 0000 → 0024 cleanly (25 rows), with all suites green on top of it.

## 3. Defects fixed

**FA-02: refunds and revoked admins**
- `completeRefund` always runs in the order's payment-service context. Policy `partner_ledger_entries_insert_refund_completion` (0024) permits a `COMMISSION_REVERSAL` only for that order, and only when a COMPLETED ADMIN/CHARGEBACK refund exists in the same transaction. The ledger trigger still enforces REFUNDED status, a prior earning and the exact amount. The audit records SYSTEM, with `requestedBy` in the metadata.
- `refundPaidOrder` re-checks `app_is_admin()` inside its own transaction.
- Reconciliation never re-sends an unacknowledged ADMIN refund whose requester is no longer an admin. Such a refund is closed as `REQUESTER_REVOKED` and audited.

**FA-01: abandoned drafts**
- Admin → Moderation → Abandoned drafts → **Release card**. Conditions:
  - the card is idle for at least 24 h;
  - it has no order other than FAILED/CANCELED;
  - a reason is given;
  - the action is rate-limited and audited as `QR_DRAFT_RELEASED`.
- On release, the draft's content and media are erased and the old link stops working. The next sender re-claims the same greeting row (`greetings_reclaim_released`).
- Trigger `enforce_qr_status_transition`: for `app_runtime`, card status changes only through:
  - the claim;
  - payment activation;
  - an admin release;
  - an admin (moderation).

  Partner staff can still mark cards distributed, but can no longer rewrite status (audit P2).
- Production today: 25 DRAFT cards, none with an order. All become releasable once idle for 24 h.

**FA-03: reconciliation**
- The endpoint runs a single flight (409 while running) and writes a heartbeat `PAYMENT_RECONCILE_RUN` for every run.
- The admin dashboard shows the reconciliation status. It turns red when payments are live and the schedule is missing, or when there has been no successful run for 150 minutes.
- A signed BOG callback with any event name is settled from a fresh receipt. Before, it got a 400; the refund callback's name is still unconfirmed.
- `.github/workflows/payments-reconcile.yml` + `.github/scripts/payments-reconcile.sh`:
  - the script first wakes the service;
  - it then makes up to 3 attempts with backoff on network errors, timeouts, 409 and 5xx;
  - 401 and 404 fail fast;
  - it never prints the secret or the response body.
- **Scheduled workflows run only from the default branch (`main`)**, so the workflow file must be added to `main`.

## 4. Test evidence (2026-11-21, isolated DB `qr_bogrel_tests` on the qrkeys cluster, TEST provider + local BOG simulator)

- tsc and eslint: clean.
- 36 verify suites green, including:
  - payment-release 52;
  - bog-adapter 66;
  - bog-integration 70;
  - reconciliation 48;
  - payment-integrity 45;
  - chargebacks 22;
  - commercial 19;
  - phase1–5;
  - pilot-protections 39;
  - partner-attribution 59;
  - payout-items 49;
  - payout-concurrency 7;
  - greeting-availability 14;
  - data-api-lockdown 47;
  - env-guards 36;
  - music, music-db, voice, media-replacement;
  - site-content 65;
  - low-cost-hosting 55;
  - partner-pricing 70.
- `admin-mfa`: 31/35 here. The 4 failures are environmental (`auth.users` does not exist in an isolated DB). The Partner Auth session ran it against a DB with the auth schema; its static checks 13b/13c are fixed in 4350882.
- Caller script against a mock server: 7/7 scenarios as designed (ok, transient 503/502, busy 409, 401, open anomalies, timeout then ok, persistent 500). The secret never appears in output.
- Browser e2e and the auth-enabled re-run (admin-mfa 126/126, 0025 stacked on top): see `PRODUCTION_CHECKLIST.md` §A.

## 5. Release steps (each needs the owner's approval)

The operational version with commands, pass criteria and rollback is `PRODUCTION_CHECKLIST.md`.

1. **Hosting stays on Render Free** (owner decision 2026-11-21; Starter is no longer a prerequisite). Free spins down after 15 min (36.6 s cold start measured). A lost callback is recovered by the return check and by reconciliation, so the reconciliation schedule (step 6) must be live and green before checkout opens. Gates and drill: `RENDER_FREE_PAYMENTS.md`, checklist §C.
2. **Production backup**: verified `pg_dump` via the migrations role (pg_dump 17 inside the supabase container), with sha256 and restore counts.
3. **Apply 0023 + 0024** (`npm run db:migrate` with the production migrations URL). Expected result: 25 rows, max `created_at` 1795222800000. Both migrations are additive; old code (f575182) ignores the new table, policies and trigger. Rollback of code alone is safe.
4. **Render env (Save only, then deploy):**
   - `PAYMENTS_PROVIDER=BOG` + `BOG_*` (owner pastes the secrets);
   - `LEGAL_EFFECTIVE_DATE`;
   - `CRON_SECRET` (≥32 characters);
   - `RECONCILE_ADMIN_USER_ID` = the owner admin;
   - keep `CHECKOUT_ENABLED=false` for the first deploy.
5. **Push a fast-forward** of this branch to `feat/render-low-cost-hosting`, which triggers the Render deploy. Then live checks with checkout still closed: `/api/health`, reconcile endpoint 401 without the secret and 200 with it, heartbeat visible on the dashboard.
6. **GitHub**: add the workflow to `main`, set the secret `CRON_SECRET` in environment `production-reconcile`, then set the variable `RECONCILE_SCHEDULE_ENABLED=true`. Do one `workflow_dispatch` run.
7. **Open checkout** (`CHECKOUT_ENABLED=true`). Then one owner-paid 1.00 GEL purchase on a dedicated card, a live refund test (M6; the bank says 2–3 days), and the reconcile result.
8. Write to the bank to lift the 100 GEL limit.

Rollback: redeploy `dep-dc01qme0tbcc73ahmoj0` (f575182) and set `CHECKOUT_ENABLED=false`. Migrations 0023/0024 can stay.

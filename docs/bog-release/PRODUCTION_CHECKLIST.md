# BOG production release — final checklist

Release branch `release/bog-payments-f575182` (local). Companion to `BOG_RELEASE_2026-11-21.md` (what changed, why, migration plan).
**Every step marked 🔒 needs the owner's explicit approval at the time it is run.** Nothing in this file has been executed against production.

## 0. Production state (read-only check, 2026-11-21)

| Item | Value |
|---|---|
| Render service | `qr-starr` `srv-db914savcj2c73bhh6tg`, plan **free**, branch `feat/render-low-cost-hosting`, auto-deploy on |
| Live deploy | `dep-dc01qme0tbcc73ahmoj0` = **f575182** (rollback target) |
| Payment env | `PAYMENTS_PROVIDER=TEST`, `CHECKOUT_ENABLED=false`, `ALLOW_TEST_PAYMENTS=false` |
| Missing env | `BOG_*`, `BOG_REFUNDS_ENABLED`, `CRON_SECRET`, `RECONCILE_ADMIN_USER_ID`, `LEGAL_EFFECTIVE_DATE` |
| Migrations | 23 rows, last `created_at` 1795161600000 (0022_music_content_type), per the 2026-11-20 read; re-read in step B |
| Blueprint | the API lists no Blueprint for this account, so env is dashboard-managed |
| BOG webhook | `POST /api/webhooks/payments/bog` → 404 today (provider TEST) |

## A. Pre-flight (local, done)

- [x] `our-song.spec.ts` ticks the mandatory checkout consent (0023) and asserts Pay is disabled before it.
- [x] Dedicated auth-enabled stack `qrbogrel`: upgrade path **prod 23 → 0023 → 0024 (25 rows) → Partner Auth 0025 (26 rows)**. 0023/0024 are byte-identical in both branches; 0025 touches only partner contact columns + `partner_invitations` + its functions (no orders, payments, ledger, QR status).
- [x] Browser e2e on that stack (one `next dev`, 1 worker, memory-guarded; evidence `/Users/Shared/qr-starr-bog-release-e2e-2026-11-21`):
  - Our Song 9/9, twice;
  - admin-mfa + auth + role-isolation + partner-privacy: 20/20;
  - admin-chargeback 1/1 (the first attempt hit a dev-server restart caused by a parallel `tsc`; it passed when re-run alone);
  - greeting-flow + pilot-protections + luxury-vintage + signature-experience: 19/19.
- [x] `verify:admin-mfa` 126/126 and `verify:payment-release` 52/52 on 25 rows, and again after 0025. Before the second run, 4 orphan `admin_users` rows (left by the e2e throwaway admins) had to be removed. Known test-only artifact.
- [x] `verify:low-cost-hosting` 55/55, `tsc` clean.
- [x] `render.yaml`: `PAYMENTS_PROVIDER` / `CHECKOUT_ENABLED` are `sync: false`, so a future Blueprint sync cannot reset the owner's dashboard values. Unset, both fail closed.
- [x] `scripts/ops/prod-backup.sh` dry-run on the local stack: MATCH, refuses `app_runtime` URLs.

## B. 🔒 Backup (immediately before migrating)

```bash
source ~/.qrapp-review/ops-env.sh            # MIGRATIONS_DATABASE_URL = migrations owner; never echo it
BACKUP_DATABASE_URL="$MIGRATIONS_DATABASE_URL" scripts/ops/prod-backup.sh pre0023-bog
```
Pass criteria:
- the script prints `MATCH`;
- `drizzle.__drizzle_migrations` = **23**;
- the sha256 file is written in `~/.qrapp-review/backups/`;
- the restore errors are only role/extension noise.

If the ledger count is not 23, **stop**: production changed since this plan.

## C. 🔒 Render Starter ($7/month)

Dashboard → `qr-starr` → Settings → Instance type → **Starter**. Free spins down after 15 min (~31 s cold start), and it shares the 750 free hours with another service. BOG callbacks and the return check need an awake service.
Check: `/api/health` 200 twice, 20 min apart, with no cold start.

## D. 🔒 Apply 0023 + 0024

```bash
source ~/.qrapp-review/ops-env.sh && npm run db:migrate        # from this worktree; MIGRATIONS_DATABASE_URL from ops-env.sh
```
Expected:
- 25 rows;
- max `created_at` **1795222800000**;
- table `checkout_consents`;
- policies `partner_ledger_entries_insert_refund_completion` and `greetings_reclaim_released`;
- trigger `trg_qr_codes_status_transition`.

Live f575182 keeps working, because both migrations are additive.
Partner Auth's 0025 (1795334400000) is applied later by its own release. Never apply a migration with a smaller `when` after it.

## E. 🔒 Render environment (Save only, not "Save and deploy")

| Variable | Value | Note |
|---|---|---|
| `BOG_CLIENT_ID`, `BOG_CLIENT_SECRET` | owner pastes | Sensitive |
| `BOG_API_BASE_URL` | the bank's production API base | validated at startup |
| `BOG_WEBHOOK_SIGNING_KEY` | BOG RSA public key (PEM, `\n` allowed) | startup refuses a non-RSA key |
| `PAYMENTS_PROVIDER` | `BOG` | startup refuses if any BOG_* is missing |
| `CHECKOUT_ENABLED` | **`false`** for the first deploy | opened in step H |
| `BOG_REFUNDS_ENABLED` | `false` until M6 | while false, refunds queue as REFUND_REQUIRED |
| `CRON_SECRET` | ≥ 32 random characters | Sensitive; the same value goes to GitHub |
| `RECONCILE_ADMIN_USER_ID` | the owner admin's `admin_users.user_id` (the only admin) | if this admin is ever revoked, update it |
| `LEGAL_EFFECTIVE_DATE` | YYYY-MM-DD **after legal approval** | checkout stays closed until this date arrives in Tbilisi (`policiesInEffect`) |
| `PAYMENT_ALERT_WEBHOOK_URL` | optional | reconciliation alerts |

Must stay **unset** in production:
- `PAYMENTS_SCOPE_PARTNER_ID` (the staging fence);
- `MERCHANT_PROFILE`;
- `ALLOW_TEST_PAYMENTS` (keep `false`).

## F. 🔒 Deploy (checkout still closed)

```bash
git push origin <release-commit>:refs/heads/feat/render-low-cost-hosting   # fast-forward only
```
Live checks:
- [ ] the deploy is live on the release commit and `/api/health` returns 200;
- [ ] the checkout page shows "Payments open soon" (CHECKOUT_ENABLED=false);
- [ ] an unsigned `POST /api/webhooks/payments/bog` gets **400** (before the deploy: 404);
- [ ] `GET /api/cron/payments-reconcile`: **401** without the bearer, **200** with it (only from the owner's shell, the secret never printed);
- [ ] the admin dashboard shows the reconciliation heartbeat;
- [ ] home, `/g/<test token>` and the legal pages render; no new errors in the Render logs for 15 min.

## G. 🔒 Reconciliation schedule (GitHub)

1. Land `.github/workflows/payments-reconcile.yml` and `.github/scripts/payments-reconcile.sh` on **main**. Scheduled workflows run only from the default branch.
2. Create the environment `production-reconcile`, restricted to `main`, with the secret `CRON_SECRET` (the same value as Render).
3. Set the repository variable `RECONCILE_SCHEDULE_ENABLED=true`.
4. Do one `workflow_dispatch` run. It should be green, and the dashboard heartbeat should be fresh.

The schedule is hourly at :15. The dashboard turns red after 150 min without a successful run.

## H. 🔒 Open checkout + first real payment (M1-prod)

1. Check that `LEGAL_EFFECTIVE_DATE` ≤ today (Tbilisi). Set `CHECKOUT_ENABLED=true`, then save and deploy.
2. The owner pays for one dedicated card at the lowest approved price.
3. Pass criteria:
   - BOG receipt `completed`;
   - order PAID, QR ACTIVE;
   - exactly 1 payment, 1 `COMMISSION_EARNED`, 1 `PAYMENT_SUCCEEDED`, 1 `QR_ACTIVATED`;
   - the next reconcile run is clean.

## I. 🔒 Refund test (M6)

1. Set `BOG_REFUNDS_ENABLED=true`, then save and deploy.
2. Admin → partner sales trace → refund the M1-prod order, with a reason.
3. Expect:
   - the refund is REQUESTED, then COMPLETED after the bank settles it (the bank says 2–3 days);
   - the order is REFUNDED, with exactly one `COMMISSION_REVERSAL` equal to the commission;
   - the refund callback is settled from a fresh receipt;
   - reconciliation is clean.
4. Open question for the bank: does a **same-day** refund route as a reversal, which is disabled for this merchant? If it does, run M6 on a payment from a previous day.
5. Record the actual refund callback event name; it is still unconfirmed.

## J. Rollback

| Situation | Action |
|---|---|
| App problem after F/H | `CHECKOUT_ENABLED=false` (save and deploy), or redeploy **`dep-dc01qme0tbcc73ahmoj0`** (f575182). Keep 0023/0024: they are additive and f575182 ignores them. |
| Bad migration (D fails midway) | Restore the step-B dump into a new database first and compare. Restore over production only with owner approval. |
| Reconcile misbehaves | Set the repository variable `RECONCILE_SCHEDULE_ENABLED=false`. The endpoint stays protected by `CRON_SECRET`. |
| Refund path misbehaves | `BOG_REFUNDS_ENABLED=false`. Requests stay queued for manual handling. |

After any rollback: run reconcile once by hand and check that no PAID order is missing its ledger row.

## K. After launch

- Ask the bank to lift the 100 GEL per-transaction cap.
- Stage 4 key cleanup: remove `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (legacy, disabled) and the unused `OWNER_REVIEW_GATE_*`.

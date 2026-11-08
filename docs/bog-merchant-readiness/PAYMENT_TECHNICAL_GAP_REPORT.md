# Payment technical gap report (2026-11-07)

Supersedes the matrix in `PAYMENT_INTEGRATION_GAP_REPORT.md` (2026-11-06) where they differ.

**Important distinction:** every result below is **local simulation** against the in-repo BOG adapter and a stubbed bank. **Nothing has been tested against the real BOG API or the BOG sandbox.** Sandbox credentials have not been received.

## The 18 checks

| # | Area | Local simulation | Real BOG sandbox | Evidence |
|---|---|---|---|---|
| 1 | Order creation | PASS | not run | bog-adapter 56/56, bog-integration 42/42 |
| 2 | Payment authorization (OAuth client credentials) | PASS (stub) | not run | bog-adapter |
| 3 | Redirect to bank page (host allow-list `payment.bog.ge`) | PASS | not run; host unconfirmed (T11) | bog-adapter |
| 4 | Server-side verification (receipt endpoint) | PASS | not run | bog-integration |
| 5 | Callback authenticity (SHA256withRSA) | PASS with a locally generated key | **not verified with a BOG-signed sample (E7)** | bog-adapter |
| 6 | Idempotency | PASS | not run | payment-integrity 45/45 |
| 7 | Duplicate callbacks | PASS | not run | payment-integrity, bog-integration |
| 8 | Failed / cancelled payments | PASS | not run | bog-integration, e2e |
| 9 | Pending-payment recovery | PASS (reconcile) | not run | bog-integration, ops-preflight 13/13 |
| 10 | Activation only after success | PASS | not run | payment-integrity |
| 11 | Refunds (async `request_received`) | PASS | not run | bog-integration, chargebacks 22/22 |
| 12 | Chargebacks | PASS (admin-recorded; BOG has no dispute API, T14) | n/a | chargebacks |
| 13 | Partner commission accounting | PASS | n/a | partner-attribution 59/59, payout-items 49/49, partner-pricing 70/70 |
| 14 | Reconciliation | PASS (route) / **not scheduled on Render** | — | `docs/ops/RENDER_RECONCILE_CRON.md` |
| 15 | Audit logs | PASS | — | phase suites |
| 16 | Environment guards (TEST refused in prod build, BOG vars required) | PASS | — | env-guards 36/36, low-cost-hosting 55/55 |
| 17 | Secret protection | PASS (no secrets in repo; Render env only) | — | low-cost-hosting, data-api-lockdown 47/47 |
| 18 | Customer payment-status screens | PASS (simulated) | not run | visual sweep K-* |

## Remaining technical work

| ID | Item | Severity | Owner / effort |
|---|---|---|---|
| E1 | Supabase key migration (PR #17) + revoke the leaked legacy HS256 secret | **P0 before live** | owner-gated release, runbook ready |
| E4 | Schedule reconciliation on Render (cron job + `CRON_SECRET` + `RECONCILE_ADMIN_USER_ID`). Runbook added: `docs/ops/RENDER_RECONCILE_CRON.md` | **P0 before live** | owner, Render dashboard |
| E5 | Paid Render instance (Free plan: cold starts / 503 during callbacks) | **P0 before live** | owner purchase |
| E6 | Sandbox run of the `docs/PAYMENTS.md` checklist on staging | **P0** | needs sandbox creds |
| E7 | BOG-signed sample callback as a test fixture | **P0** | needs BOG |
| E11 | Remove demo accounts; admin MFA (`feat/admin-mfa`) | P0 for super admin | medium |
| E12 | Alerts on `paymentReconcile` warnings and webhook 4xx/5xx | P1 | small |
| E3 | Payment reference on the success screen | P1 | small |
| E8 | Basket VAT fields, only if BOG/accountant require (not VAT-registered today) | P2 | small |
| — | Production backups on a schedule (Supabase Free has no PITR) | P1 | owner |
| E10 | Retention / deletion once D1 decided | P1 | medium |
| E13 | `docs/PAYMENTS.md` credential-boundary wording is outdated | P2 | docs |

## Done since 2026-11-06

- E2 checkout links + seller/VAT/age disclosures (this branch).
- E9 privacy copy names Render + Supabase (Frankfurt).
- 12-month availability, derived and non-destructive.
- Reconcile-cron runbook (not applied).

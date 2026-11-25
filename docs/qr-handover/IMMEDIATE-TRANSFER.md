# Immediate admin QR transfers (0027) — release runbook

Owner decision: the admin is the sole authority over QR inventory. An admin
transfer completes at once; the partner never accepts, approves or confirms.

```
Admin selects cards (scan or batch pick) → picks partner → "Assign / Transfer"
  → app_admin_transfer_qr_cards(): lock cards (id order) → re-check every card
  → handover row (ACCEPTED, resolved_actor_type ADMIN) + items + new partner batch
  → cards change owner → audit QR_HANDOVER_TRANSFERRED   (one transaction)
Partner dashboard: cards already in inventory; read-only notification + history;
optional non-blocking "count doesn't match?" report (never reverses anything).
```

## What changes

| Area | Before (0026) | After (0027) |
|---|---|---|
| Admin submit | creates PENDING request, cards reserved | ownership moves immediately |
| Partner | Confirm receipt / Report discrepancy (blocking) | read-only; optional report (non-blocking) |
| `app_accept_qr_handover`, `app_dispute_qr_handover` | executable by app_runtime | kept for history, **not executable** |
| Insert into `qr_handovers` / `_items` | admin via RLS | **only** via `app_admin_transfer_qr_cards()` (definer) |
| New PENDING rows | normal | impossible (deferred constraint trigger) |
| `qr_handover_reports` | — | new, SELECT-only for app_runtime (admin + receiving partner via RLS) |

Unchanged: 0026 tables, statuses, history, state-machine and attribution
triggers, central-stock rules, eligibility rules, QR generation (batches),
payments, BOG, refunds, pilot pricing, reconciliation, checkout config.

Eligibility (enforced inside the DB function under row locks): card owned by
the declared source, status AVAILABLE (so not DRAFT/ACTIVE/BLOCKED), no greeting
ever, no order/payment ever, not reserved by a legacy handover; destination
ACTIVE, not central stock, ≠ source; 1–500 cards; idempotency key reused only
for the same source/destination/count.

## Legacy PENDING handovers

0027 starts with a guard: if any handover is PENDING or DISPUTED it raises and
changes nothing. Production on 2026-11-25: **0 PENDING / 0 DISPUTED**, 6
ACCEPTED (partner-confirmed, kept as-is). If one appears before release: the
admin closes it explicitly on its detail page (Cancel / Reject), then
re-transfers the cards with the new flow. Never auto-accepted.

## Deploy plan (each step needs explicit owner approval)

1. Coordinate with the BOG session (no concurrent deploy/migration).
2. Backup + fingerprint (`scripts/ops/prod-backup.sh`, `backup-fingerprint.sql`).
3. Preflight (read-only): `psql "$MIGRATIONS_DATABASE_URL" -f scripts/ops/qr-handover-0027-preflight.sql` — all rows `t`.
4. Apply 0027 (`npm run db:migrate` with the prod migrations URL). Verify:
   ledger 28, last row hash = sha256 of `0027_qr_handover_immediate.sql`
   (`defa100ea199397e820e525d5452124abca87dd5e61d7cd97cdf6a96ea634ccd`),
   data fingerprints of qr_codes / orders / payments / ledger unchanged.
5. Immediately deploy the app (fast-forward the deploy branch; outside :10–:25).
   Between steps 4 and 5 the live app's Scan-to-Assign submit fails safely
   (insert denied, nothing written); nothing else is affected. Keep it short.
6. Post-checks: health/admin/partner 200, `CHECKOUT_ENABLED=false` unchanged,
   cron jobs OK, money fingerprint identical, 0 BOG payments created.
7. Smoke (separate approval): admin transfers 1 card central → Demo Flower
   Shop; Demo partner sees it at once; verify one ACCEPTED/ADMIN row, no order.

## Rollback

App first: redeploy the previous build (d8de1d1, dep-dc1grbvlk1mc738ejfc0).
Then `docs/qr-handover/rollback-0027.sql` (one transaction): restores 0026's
grants/policies exactly, drops the 0027 functions/trigger, renames reports to
`qr_handover_reports_0027_archive`, removes the ledger row. Completed 0027
transfers stay (valid 0026 data). Rehearsed: rollback schema/privileges/policies
= pure 0026 (0 diff lines); re-apply after rollback = identical to first apply.

## Evidence (local, isolated DB `qr_ho_admin` on the qrpartnerauth stack)

- `verify:qr-handover` 123/123 (rewritten for 0027: immediate transfer, DB-level
  eligibility, privileges, idempotency, concurrency, injected-failure rollback,
  legacy PENDING, reports, financial non-effects, attribution after transfer).
- `e2e/qr-handover.spec.ts` 6/6 (desktop Chromium fake camera, Pixel 7, iPhone WebKit).
- Regression: data-api-lockdown 47, inventory-consistency 14, partner-attribution 59,
  commercial 19, partner-privacy 16, payment-integrity 45, m1-hardening 33,
  m1-pilot-price 52, bog-integration 71, bog-adapter 66, reconciliation 48,
  phase1–5 26/24/30/22/41, pilot-protections 39, partner-auth 95, admin-pagination 4.

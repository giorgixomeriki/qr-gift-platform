# Release runbook — Admin-only QR handover (migration 0026)

Branch `feat/qr-scan-handover` (fast-forward of the live deploy branch at `5546932` = BOG M1, live as `dep-dc19ib3bc2fs73e3i860` since 2026-11-22 07:29Z).
Each numbered step needs the owner's explicit "go". Never deploy between :10 and :25 (Supabase
Cron wake :15 / reconcile :17). `CHECKOUT_ENABLED` stays `false`; no Render env change in this release.

## Evidence prepared (2026-11-22, local, production read-only)
- Backup `~/.qrapp-review/backups/qrapp-prod-full-20261121-2126-pre0026-qr-handover.dump`
  (sha256 `a54ddbdd8f45d4e4…`), fingerprint 126/126 MATCH, money: 2 PAID / 2000 GEL / commission 600.
- Rehearsal on the restored copy: 0026 applied (26 → 27). qr_codes (202), batches, greetings, orders,
  payments, ledger, analytics, audit logs, members: content hashes IDENTICAL before/after.
  Rollback script → fingerprint identical on all 126 lines; re-apply OK.
  Real-service flows on the copy 10/10 (central → Solo FLW, Solo FLW → Demo, real DRAFT refused, admin = partner
  views, no money effect). Rollback refuses once a handover was accepted (by design). Copy dropped.
- Production cron before release: jobs 1 wake `15 * * * *`, 2 reconcile `17 * * * *`, 3 trim `40 3 * * *`, all active.
  0026 and the rollback never reference cron / pg_net / vault / `private`.

## Pre-release gate (2026-11-22 07:09–07:12Z, production read-only)
- Live: `dep-dc10s4942hec73ff4b60` = 8827b9a; health 200; CHECKOUT_ENABLED=false, PAYMENTS_PROVIDER=BOG, CHECKOUT_PILOT_QR_IDS unset.
  BOG M1 (`release/m1-hardening`, no migration) is approved and deploys first (~07:26Z); this branch then rebases onto it
  and the code rollback target becomes the M1 deploy id (re-read Render before step 3).
- Backup `qrapp-prod-full-20261122-0709-pre0026-final.dump` (sha256 `2c4910edc2b318e2…`): fingerprint 126/126 MATCH;
  money 2 PAID / gross 2000 / commission 600 / platform 1400; payments 2 SUCCEEDED 2000; payouts 0; ledger 26.
  Since the 21:26 backup only login data changed (TST Flw now has a login); QR cards hash `526ecb05…` unchanged.
- QR baseline: 202 cards (169 AVAILABLE / 31 DRAFT / 2 ACTIVE / 0 BLOCKED), 0 distributed, 5 batches.
- Cron: jobs 1–3 active, 25 successful runs in 12 h (last 06:17Z).

- 07:34Z re-check after M1: since the 07:09 backup only one audit row (Cron reconcile 07:17, expected); money identical;
  cards 202 hash `526ecb05…`; ledger 26; no qr_handovers table; cron 3/3 active, last 07:17 OK; no other active DB sessions.
  Rebased branch: m1-hardening 33, qr-handover 114 and 13 more suites green; e2e 6/6 + regression 18/18.

## Steps
1. **Fresh backup** (if > 2 h since the one above or any prod write happened):
   `source ~/.qrapp-review/ops-env.sh; BACKUP_DATABASE_URL="$MIGRATIONS_DATABASE_URL" scripts/ops/prod-backup.sh pre0026-final` → must print `RESULT: MATCH`.
2. **Migrate** (window :30–:05): `MIGRATIONS_DATABASE_URL=… node ./node_modules/.bin/tsx src/db/migrate.ts`.
   Verify: ledger 27 (max 1795420800000); qr_codes 202 (169/31/2/0); money lines unchanged; cron jobs unchanged.
   Old code (5546932) keeps working with 0026 (it never reads the new tables/column).
3. **Deploy**: `git push origin feat/qr-scan-handover:feat/render-low-cost-hosting` (fast-forward only) → Render deploy; wait live.
4. **Live checks**: `/api/health` 200; `/admin/inventory/scan` header `camera=(self)`, all other pages `camera=()`;
   checkout still closed; admin dashboard totals 202 / partners unchanged.
5. **Controlled smoke (owner)**, recipient = Demo Flower Shop (demo login, no real store):
   1. Admin → QR ინვენტარი → *ცენტრალური საწყობის შექმნა* (central stock, suspended, 0 %).
   2. Central stock page → create batch "smoke", quantity 2 → print one sheet.
   3. Open a smoke card's URL on a phone → must show "unavailable" (dormant stock).
   4. Phone (admin) → scanner → scan both cards → partner Demo Flower Shop → create handover.
   5. Demo login → *ახალი QR ბარათების მიღება* → tick → confirm. Demo issued 92 → 94; total 204; orders/ledger unchanged.
   6. Optional partner → partner: Demo → TST Flw (test partner, has a login since 2026-11-22), 1 of the smoke cards.
      G'N / Nino's are not needed.
   7. Optional discrepancy path: create a handover of 1 card → Demo reports a discrepancy → admin *Reject*.
6. **Real-device camera test** (DEVICE-CAMERA-TEST.md) on one Android + one iPhone.
7. Record evidence; keep CHECKOUT_ENABLED=false.

## Rollback
- Code: Render rollback to `dep-dc19ib3bc2fs73e3i860` (5546932, BOG M1, live since 2026-11-22 07:29Z) — re-check it is still the live deploy right before step 3. 0026 may stay (old code ignores it; 0013's rule
  still applies to every non-handover update). Cron untouched either way.
- Database (only if required, and only while no handover is ACCEPTED):
  `psql "$MIGRATIONS_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/qr-handover/rollback-0026.sql` (one transaction;
  restores 0013's function, drops 0026 objects, removes ledger row 27; keeps the central-stock partner row and
  its cards). After an accepted handover, ownership moved for real — keep 0026 and roll back code only.
- Full restore from the dump is the last resort (would also lose any later prod writes).

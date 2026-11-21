# Scan-to-Assign & Physical QR Handover

Branch `feat/qr-scan-handover` (from production `ae7a0ab`). Migration `0026_qr_handovers`.
Local only — not pushed, not deployed.

## Physical process
1. Admin → Inventory → **Create central stock** (once). This creates partner `qr-starr-central-stock`, SUSPENDED, 0 %.
2. Admin → that partner's page → **Create batch** (e.g. 200) → existing print page / CSV. Central-stock cards show no partner or stock name.
   Print shop prints one normal file; no sorting.
3. In the store: Admin (phone) → **QR ბარათების სკანირება და მინიჭება** → scan any N cards → choose partner → **Create handover request** (PENDING; cards reserved).
4. Partner dashboard → **ახალი QR ბარათების მიღება** → counts, ticks the box, **Confirm receipt** → cards move to the partner (new batch "QR STARR · date", DISTRIBUTED, still AVAILABLE).
   Or **Report discrepancy** → DISPUTED; admin reopens or rejects.

## Rules
- Scan ≠ handover ≠ receipt ≠ sale. No order, payment, ledger entry, analytics event or status change is ever produced.
- Eligible: central stock, AVAILABLE, never had a greeting or order, not reserved. Re-checked under row locks at submit and again at acceptance (all-or-nothing).
- Ownership changes only in `app_accept_qr_handover()` (receiving partner OWNER/ADMIN/STAFF). 0013's immutability trigger still applies everywhere else; its single exception needs an acceptance mark that the app role cannot write.
- Central stock is SUSPENDED, so a lost or unassigned card can't be started at /g/{token} until a partner accepts it.
- Printed URLs and tokens never change. Camera is allowed for `/admin/*` only (Permissions-Policy).

## Tests
- `npm run verify:qr-handover` (83 checks; local DB only, refuses hosted).
- `e2e/qr-handover.spec.ts`: Chromium gets a fake camera fed with generated QR video; WebKit uses manual entry. Needs an auth stack, a production build, and a config without globalSetup.

## Rollout (needs owner approval at each step)
1. Verified prod backup + fingerprint (`scripts/ops/prod-backup.sh`); rehearse 0026 on a restored copy.
2. Apply 0026 (27 rows in the ledger). It is additive; old code ignores the new tables and column.
3. Fast-forward the deploy branch to this branch; deploy outside :10–:25 (cron).
4. Smoke: /admin/inventory, create central stock, a tiny batch, scan with a real phone, accept with a test partner, then cancel/clean.
5. Real-device camera check on one Android and one iPhone (not done yet; emulation only so far).

## Rollback
Code: redeploy the previous Render deploy. 0026 may stay: old code never reads the new tables. Its trigger keeps the old rule for every non-handover update.
Full DB rollback (only if required): no accepted handovers → drop the 0026 objects + restore 0013's function body. Accepted handovers are real ownership facts, so keep them.

# Admin-only QR Handover (Scan-to-Assign)

> **Superseded in part by 0027** (see [IMMEDIATE-TRANSFER.md](IMMEDIATE-TRANSFER.md)): admin transfers now complete immediately; partners no longer confirm receipt. Scanning, batch pick, eligibility and central-stock rules below still apply.

Two admin-controlled operations, one mechanism (`qr_handovers` + `app_accept_qr_handover`):
- **Central stock → partner**
- **Partner → partner** (admin redistribution, e.g. G'N 50 → 40, Nino's +10, global unchanged)

Partners never initiate, send, choose a recipient or reassign. They can only confirm receipt of a
handover addressed to them, or report a discrepancy. The receiver sees the sender as "QR STARR", never
the other shop; the source shop does not see the handover at all.

Branch `feat/qr-scan-handover` (from production `ae7a0ab`). Migration `0026_qr_handovers`.
Local only — not pushed, not deployed.

## Physical process
1. Admin → Inventory → **Create central stock** (once). This creates partner `qr-starr-central-stock`, SUSPENDED, 0 %.
2. Admin → that partner's page → **Create batch** (e.g. 200) → existing print page / CSV. Central-stock cards show no partner or stock name.
   Print shop prints one normal file; no sorting.
3. In the store: Admin (phone) → **QR ბარათების სკანირება და მინიჭება** → scan any N cards → choose partner → **Create handover request** (PENDING; cards reserved).
4. Partner dashboard → **ახალი QR ბარათების მიღება** → counts, ticks the box, **Confirm receipt** → cards move to the partner (new batch "QR STARR · date", DISTRIBUTED, still AVAILABLE).
   Or **Report discrepancy** → DISPUTED; admin reopens or rejects.

## Admin redistribution (partner → partner)
Admin → Scan & Assign → scan the shop's cards (or **pick a whole batch**). The first card fixes the
source; cards from any other holder are refused. Review shows **From** → choose the destination (the
source is excluded) → create. Cards stay with the source (reserved) until the receiver confirms.
The receiver needs a partner login (production 2026-11-22: G'N and Nino's Flowers have none).

## Rules
- Scan ≠ handover ≠ receipt ≠ sale. No order, payment, ledger entry, analytics event or status change is ever produced.
- Eligible: AVAILABLE, never had a greeting, order or payment, not in an open handover, held by the handover's source, not already the destination's. Re-checked under row locks at submit and again at acceptance (all-or-nothing).
- Ownership changes only in `app_accept_qr_handover()` (receiving partner OWNER/ADMIN/STAFF). 0013's immutability trigger still applies everywhere else; its single exception needs an acceptance mark that the app role cannot write.
- Central stock (DB-enforced): always SUSPENDED and 0 % (check constraint), never a member or invitation, never receives a handover, can't be flagged if it has logins, only admins can set the flag. Its cards resolve as unavailable at /g/{token} until a partner accepts them.
- History: each item keeps its original batch (`from_batch_id`); audit rows carry `kind` CENTRAL_TO_PARTNER / PARTNER_TO_PARTNER. Past orders and commissions keep their partner (orders/ledger are never touched; sold cards are never eligible).
- Printed URLs and tokens never change.
- Camera: `camera=(self)` only on `/admin/inventory/scan` (MFA-gated admin page); every other page, admin and public, keeps `camera=()`. Links into the scanner are full page loads so it always gets its own policy.
- Reporting note: "scanned" tiles count distinct customer-scanned cards by CURRENT holder, so a redistributed card's earlier scans move with it.

## Tests
- `npm run verify:qr-handover` (109 checks; local DB only, refuses hosted).
- `e2e/qr-handover.spec.ts`: Chromium gets a fake camera fed with generated QR video; WebKit uses manual entry. Needs an auth stack, a production build, and a config without globalSetup.

## Rollout (needs owner approval at each step)
1. Verified prod backup + fingerprint (`scripts/ops/prod-backup.sh`); rehearse 0026 on a restored copy.
2. Apply 0026 (27 rows in the ledger). It is additive; old code ignores the new tables and column.
3. Fast-forward the deploy branch to this branch; deploy outside :10–:25 (cron).
4. Smoke: /admin/inventory, create central stock, a tiny batch, scan with a real phone, accept with a test partner, then cancel/clean.
5. Real-device camera check on one Android and one iPhone (not done yet; emulation only so far).

## Rollback
Code: redeploy the previous Render deploy. 0026 may stay: old code never reads the new tables. Its trigger keeps the old rule for every non-handover update.
Full DB rollback (only if required): `docs/qr-handover/rollback-0026.sql` (one transaction; refuses if any handover was ACCEPTED, because those are real ownership changes). Tested on the local auth stack: 27 → 26 → re-migrate 27.

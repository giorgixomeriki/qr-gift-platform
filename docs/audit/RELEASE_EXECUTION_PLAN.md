# Release execution plan

Date: 2026-10-15. IDs refer to `UNFINISHED_WORK_REGISTER.md`. ⛔ marks an owner approval gate
(money, DNS, production data, live payments, merging).

## Release sequence

```text
Track A (code)          Track B (owner: accounts/infra)       Track C (owner: BOG + legal)
───────────────         ──────────────────────────────        ────────────────────────────
A1 review+merge #5 ⛔    B1 Vercel Pro, Supabase Pro ⛔          C1 send merchant requirements §B to BOG
A2 review+merge #6 ⛔    B2 staging + prod projects              C2 legal pages text (lawyer)
A3 merge/close #4        B3 migrate/seed/rotate (staging→prod)⛔ C3 merchant agreement, credentials
        │                B4 auth, bucket, first admin ⛔                 │
        └──────────┬─────┘                                              │
                   ▼                                                    │
   M1  Preview on staging: full validation + real-device QA (UX-1)       │
                   ▼                                                    │
   M2  Production on *.vercel.app, checkout closed (smoke test) ⛔        │
                   ▼                                                    │
   M3  DNS cutover qrapp.ge + email + uptime monitor ⛔                   │
                   ▼                                                    │
   M4  SOFT LAUNCH: first partner, cards, creation/preview;             │
       checkout shows "payments open soon"                              │
                   ▼  ◄───────────────────────────────────────────────────┘
   M5  Adapter adjustments from BOG's answers (PAY-3) → BOG test env (PAY-5)
                   ▼
   M6  One real 10 GEL payment + refund, verified (PAY-6) ⛔
                   ▼
   M7  OPEN CHECKOUT: CHECKOUT_ENABLED=true, cron scheduled, alerts on ⛔
                   ▼
   M8  Post-launch: chargebacks (PAY-8), settlement matching (PAY-9),
       Signature Experience phases (UX-2/3)
```

## Ordered tasks

| Step | Task | Owner | Gate | Can run in parallel with |
|---|---|---|---|---|
| 1 | Review PR #5 (partner pricing); answer PP-a…e | Owner | ⛔ merge | 5, 6, 7 |
| 2 | Merge #5, then rebase and merge #6 (BOG R1, migration 0019) | Claude after approval | ⛔ merge | 5, 6, 7 |
| 3 | Merge or close #4; update its "0018" reference to 0019 | Claude | — | anything |
| 4 | Recreate the local dev DB (HK-2) | Claude | approval (local data) | anything |
| 5 | Vercel Pro + Supabase Pro production + free staging | Owner | ⛔ paid | 1–4, 7 |
| 6 | Send BOG the merchant-requirements questions (§B) and start onboarding | Owner | — | everything |
| 7 | Legal pages: owner supplies the texts, Claude builds the pages | Both | — | 1–5 |
| 8 | Staging: migrate → seed → rotate → pricing check → all `verify:*` | Claude + owner's shell | staging only | — |
| 9 | Production DB: migrate → seed → rotate → pricing check (read-only) | Claude + owner's shell | ⛔ prod data | — |
| 10 | Auth settings, private bucket, first admin | Owner | ⛔ prod data | 9 |
| 11 | Vercel project + env vars; preview on staging; Phase-4 validation | Claude + owner (secrets) | — | — |
| 12 | Real-device QA on the preview (UX-1) | Owner / tester | — | 13 |
| 13 | Production deploy on `*.vercel.app` (checkout closed), smoke test | Claude | ⛔ deploy | 12 |
| 14 | DNS cutover, email DNS, SMTP, uptime monitor | Owner (DNS), Claude verifies | ⛔ DNS | — |
| 15 | Soft launch: first partner, batch, print test, real scans | Owner + Claude | ⛔ public traffic | 16 |
| 16 | Adapter fixes from BOG's answers; BOG test-environment run | Claude | test creds | 15 |
| 17 | One real payment + refund in production; reconcile | Owner pays, Claude verifies | ⛔ live money | — |
| 18 | Schedule cron (PAY-10); turn on `BOG_REFUNDS_ENABLED`; then `CHECKOUT_ENABLED=true` | Claude after approval | ⛔ live payments | — |
| 19 | Post-launch: PAY-8, PAY-9, UX-2…UX-4, PAY-12, PAY-13, HK-3, HK-5 | Claude | per item | — |

## Final acceptance criteria

### Soft launch (M4)

- `main` contains #5 and #6, with CI green.
- Staging has passed every `verify:*` suite and the launch-pricing check.
- Production passes the launch-pricing check: 1000 / 300 / 700.
- `/api/health` returns 200 on `https://qrapp.ge`.
- Security headers are present, and HTTPS redirects work.
- Auth emails link to `https://qrapp.ge`.
- Sign-ups are off, and the storage bucket is private.
- On production, checkout shows "payments open soon", and no order is created.
- Real-device checklist passed on iPhone Safari and an Android device.
- Legal pages are live.
- The uptime monitor alerts the owner.

### Paid checkout (M7)

- BOG has confirmed in writing every item marked **[confirm with BOG]**.
- The adapter is adjusted, and the `verify:bog-*` suites are green.
- One real 10.00 GEL payment results in:
  - the order PAID, at 1000 / 300 / 700;
  - a ledger entry of +300;
  - the greeting active;
  - a verified callback received.
- The refund of that payment results in:
  - the refund COMPLETED;
  - a ledger entry of −300;
  - the order REFUNDED.
- `payments:reconcile` reports no anomalies.
- Reconciliation is scheduled, and an alert on `paymentReconcile` warnings is configured.
- Decisions B1, B2, B5–B7, H1 and CRON are recorded.

## Rollback

Checkout:

- Set `CHECKOUT_ENABLED=false` and redeploy (about 1–2 minutes).
- Or promote the previous Vercel deployment.

Migrations are forward-only:

- Roll back by forward fix.
- Or restore from backup (`DISASTER_RECOVERY.md`).

DNS:

- Keep the old records written down until the cutover is verified.

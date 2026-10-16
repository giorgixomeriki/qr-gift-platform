# Owner-Review Deployment — qrapp.ge (not a public launch)

A gated, payment-free deployment of the full app on the real domain, for the
owner to review. It is **not** the production launch in
`docs/PRODUCTION_DEPLOYMENT.md`: it uses free tiers, holds only demo data, and
is replaced (or upgraded in place) before any real customer traffic.

| Piece | Choice | Cost |
|---|---|---|
| App | Vercel project `qr-starr` (Hobby), region fra1, deployed from `release/owner-review` | free |
| Database / Auth / Storage | Supabase project `qr-starr-review` in its own org `QR Starr` (Free), eu-central-1 | free |
| Domain | `qrapp.ge` primary, `www.qrapp.ge` → 308 to apex | already owned |

## Safety settings

- `PAYMENTS_PROVIDER=TEST` with `ALLOW_TEST_PAYMENTS` unset. Production refuses
  TEST, so checkout is closed and senders see "Payments open soon". No `BOG_*`
  variables exist on the project, so no bank call is possible.
- `OWNER_REVIEW_GATE_USER` / `OWNER_REVIEW_GATE_PASSWORD`: a site-wide HTTP
  Basic gate (`src/lib/security/owner-gate.ts`). Only `/api/health` (it returns
  ok or unavailable) and `/api/cron/*` (bearer-protected, and absent without
  `CRON_SECRET`) stay open. Every 401 carries `X-Robots-Tag: noindex`.
- Supabase Auth: sign-ups **off**. There is no public registration page in the
  app; partners are invited by an admin.
- Demo logins come from `scripts/ops/seed-owner-review.ts` and use random
  passwords stored in a 0600 file on the owner's machine.
- The `CRON_SECRET` and `RECONCILE_ADMIN_USER_ID` variables are unset, so
  `/api/cron/payments-reconcile` returns 404.

## Free-tier limits to know

- Supabase Free pauses after 7 days without activity; resume it from the
  dashboard. It has no backups. Its file cap is 50 MB, while the app allows
  100 MB video, so uploads over 50 MB fail on review.
- Vercel Hobby is for non-commercial use, which covers review. Move to Pro (and
  Supabase Pro) before opening to customers.

## Going public later

1. Remove `OWNER_REVIEW_GATE_PASSWORD` and redeploy.
2. Follow `docs/PRODUCTION_DEPLOYMENT.md` (Pro plans, SMTP, backups).
3. Delete the demo users and the demo partner.

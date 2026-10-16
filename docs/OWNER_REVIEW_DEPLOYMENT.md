# Owner-Review Deployment — qrapp.ge (not a public launch)

A gated, payment-free deployment of the full app on the real domain, for the
owner to review. It is **not** the production launch in
`docs/PRODUCTION_DEPLOYMENT.md`: it uses free tiers, holds only demo data, and
is replaced (or upgraded in place) before any real customer traffic.

| Piece | Choice | Cost |
|---|---|---|
| App | Render web service `qr-starr` (Starter), Frankfurt, from `render.yaml` | about $7/month |
| Database / Auth / Storage | Supabase project `qr-starr-review` in its own org `QR Starr` (Free), eu-central-1 | free |
| Domain | `qrapp.ge` primary, `www.qrapp.ge` → redirect to apex | already owned |

Step-by-step setup, the env checklist and DNS records are in
`docs/RENDER_DEPLOYMENT.md`. Vercel works too: the same variables minus
`TRUSTED_PROXY_COUNT` (Vercel overwrites X-Forwarded-For).

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
  dashboard. It has no backups. Its 50 MB per-file cap matches the app's video
  limit and the bucket limit (`MAX_MEDIA_BYTES`).
- Move to Supabase Pro (backups) before opening to customers.

## Going public later

1. Remove `OWNER_REVIEW_GATE_PASSWORD` and redeploy.
2. Follow `docs/PRODUCTION_DEPLOYMENT.md` (Pro plans, SMTP, backups).
3. Delete the demo users and the demo partner.

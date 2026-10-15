# Production Deployment — qrapp.ge on Vercel + Supabase

The operator procedure for QR Starr's first production deployment. It
complements `docs/ENVIRONMENT_MATRIX.md` (what each variable means),
`docs/PILOT_LAUNCH_CHECKLIST.md` (launch gates) and
`docs/STAGING_SETUP_RUNBOOK.md`. Steps marked **APPROVAL** create paid
resources, mutate a hosted database, change DNS, or take traffic, and are run
only after the owner explicitly approves that step.

## 0. Topology

| Environment | App | Database / Auth / Storage | Payments |
|---|---|---|---|
| Local | `next dev` | `supabase start` (Docker) | TEST, simulated |
| Preview | Vercel preview deployments (every PR / branch) | **Staging** Supabase project | TEST only if the preview-only mechanism is approved; otherwise checkout fails closed |
| Production | Vercel production → `https://qrapp.ge` (`www` redirects to apex) | **Production** Supabase project | Off (fails closed) until BOG is implemented and approved |

Preview and production never share a Supabase project, keys, or secrets.
Vercel environment variables are scoped per environment (Preview vs.
Production), and the app refuses to start on Vercel if pointed at a local
database or a local Supabase (`src/lib/env-guards.ts`).

Region: Vercel functions in `fra1` (Frankfurt, `vercel.json`) and Supabase in
`eu-central-1` (Frankfurt), so every request's database round trips stay in
the same region.

## 1. Supabase projects — APPROVAL (paid for production)

1. **Production**: a new project `qr-starr-production` in an organization on
   the **Pro** plan (the free plan pauses inactive projects and has no daily
   backups). Region `eu-central-1`. Generate a strong database password and
   store it only in a password manager.
2. **Staging** (for previews): a separate project `qr-starr-staging`. It can
   live in a free organization; it pauses after a week of inactivity, which is
   acceptable for staging.
3. Confirm daily backups are listed under Database → Backups for production
   **before** the first migration.

## 2. Schema, seed, credential rotation — APPROVAL (production DB mutation)

Run from an operator machine. `MIGRATIONS_DATABASE_URL` is the project's
**session-mode pooler** connection string for the `postgres` user
(`postgresql://postgres.<ref>:<db-password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`).
Export it in the shell only for the duration of these commands, and never
write it to a file in the repo.

```sh
export MIGRATIONS_DATABASE_URL='…'     # target project, double-check the <ref>
export NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='…'   # needed by db:seed to create the private bucket
npm run db:migrate                     # forward-only; 0000–0017
npm run db:seed                        # content types, themes, products, 10.00 GEL price, private bucket
npx tsx scripts/rotate-app-runtime-password.ts \
  --confirm-host=aws-0-eu-central-1.pooler.supabase.com --out=/tmp/qrs-db-url   # F-01
npm run ops:check-launch-pricing       # read-only: 1000 GEL, no overrides, partners at 3000 bps
unset MIGRATIONS_DATABASE_URL SUPABASE_SERVICE_ROLE_KEY
```

`rotate-app-runtime-password.ts` replaces the public local-dev `app_runtime`
password (audit F-01) with 32 random bytes and writes the runtime
`DATABASE_URL` (transaction-mode pooler, port 6543, user
`app_runtime.<ref>`) to the `--out` file with mode 0600. It never prints the
password. Load it straight into Vercel, then delete the file:

```sh
vercel env add DATABASE_URL production < /tmp/qrs-db-url && rm -P /tmp/qrs-db-url
```

The app also refuses to start against any non-local database that still uses
the public dev password, so a skipped rotation fails closed instead of
running.

Then, in the dashboard:

- **Storage**: confirm bucket `greeting-media` exists and is **private**.
- **Never** run `verify:*` scripts or `db:dev-bootstrap` against production.
  They insert and delete fixtures. Run them against staging instead.

Staging gets the same sequence against its own project (its own rotated
password, loaded into the **Preview** scope).

## 3. Supabase Auth settings (per project)

| Setting | Production | Staging |
|---|---|---|
| Site URL | `https://qrapp.ge` | the preview branch URL used for testing |
| Redirect URLs | `https://qrapp.ge/**` | `https://*-<vercel-team-slug>.vercel.app/**` |
| Allow new users to sign up | **Off**. Partners are invited by an admin (admin API invites still work with sign-up off); admins are inserted by SQL. | Off |
| Minimum password length | 12, letters + digits | same |
| Secure password change | On | On |
| Leaked password protection | On (Pro feature) | n/a |
| Custom SMTP | On (see §4) | On, or the built-in mailer for low volume |

Flows that depend on these: password reset (`/auth/confirm?next=admin|partner`
→ `/reset-password`), and partner invites (redirect to `/partner/login`).
Both build their URLs from `NEXT_PUBLIC_APP_URL`, which must therefore exactly
match the Site URL's origin.

## 4. Email delivery — APPROVAL (DNS)

Supabase's built-in mailer is rate-limited to a few messages an hour and is
not meant for production. Use a transactional provider (recommended: Resend,
whose free tier of 3,000 emails a month covers invites and password resets at
pilot scale):

1. Create the provider account and add the sending domain `qrapp.ge`.
2. The provider issues SPF (TXT), DKIM (TXT or CNAME) and, optionally,
   return-path records. Add those exact values at Domenebi.ge, plus a DMARC
   record: `_dmarc.qrapp.ge TXT "v=DMARC1; p=none; rua=mailto:<owner mailbox>"`.
   This is a **DNS change** and needs approval.
3. In Supabase → Auth → SMTP: host/port/user/password from the provider,
   sender `QR Starr <no-reply@qrapp.ge>`.
4. Raise Auth → Rate limits → emails per hour to around 30.
5. Test: an invite and a password reset both arrive and their links land on
   `https://qrapp.ge/...`.

## 5. Vercel project — APPROVAL (Pro plan, since Hobby is non-commercial)

1. Import `giorgixomeriki/qr-gift-platform`. Framework Next.js, Node 22.x
   (`package.json` engines), region `fra1` (`vercel.json`). Production branch:
   `main`.
2. Environment variables, entered through the dashboard or `vercel env add`.
   Never paste them into chat, files or commits:

| Variable | Production scope | Preview scope |
|---|---|---|
| `DATABASE_URL` | prod `app_runtime.<ref>` pooler URL (6543) | staging equivalent |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod project | staging project |
| `SUPABASE_SERVICE_ROLE_KEY` (Sensitive) | prod | staging |
| `SUPABASE_STORAGE_BUCKET` | `greeting-media` | `greeting-media` |
| `EDIT_TOKEN_SECRET` (Sensitive) | `openssl rand -hex 32`, unique | a different value |
| `NEXT_PUBLIC_APP_URL` | `https://qrapp.ge` | the stable branch alias, e.g. `https://qr-gift-platform-git-<branch>-<team>.vercel.app` |
| `PAYMENTS_PROVIDER` | `TEST` (refused in production, so checkout fails closed) until BOG | `TEST` |
| `ALLOW_TEST_PAYMENTS` | **unset** | unset unless the preview-only test-payment mechanism is approved |
| `MIGRATIONS_DATABASE_URL`, `TEST_PAYMENTS_WEBHOOK_SECRET`, `BOG_*` | **unset** | unset |

   Never set `NODE_ENV`. Next.js sets it.
3. Keep Vercel Deployment Protection (Vercel Authentication) on for
   **previews**. Note that it would also block a payment provider's webhooks to
   a preview, which is fine while previews use TEST.
4. Production traffic is not opened until §7. Until then, production is reached only
   through its `*.vercel.app` URL, and only after its env vars exist; without
   them the build refuses to start (`src/lib/env-guards.ts`).

## 6. Monitoring

- **Uptime**: point a free uptime monitor (Better Stack or UptimeRobot) at
  `https://qrapp.ge/api/health` every 1–5 minutes. It returns `{"status":"ok"}`
  (200) when the app can reach the database as `app_runtime`, otherwise 503.
  It reveals nothing else.
- **Logs**: Vercel → Logs. Server errors are structured JSON lines
  (`docs/OBSERVABILITY.md`); filter by `scope`. Alert on repeated
  `"scope":"healthCheck"` errors and on 5xx from `/api/webhooks/payments/*`
  once a real provider exists.
- **Payment reconciliation**: once `CRON_SECRET` and `RECONCILE_ADMIN_USER_ID`
  are set, Vercel Cron runs `/api/cron/payments-reconcile` (daily on Hobby;
  every 10 minutes on Pro — edit `vercel.json`). Alert on any
  `"scope":"paymentReconcile"` warning and on `level: "error"` lines.
- **Supabase**: Reports and Logs for the production project; also enable its
  email alerts for disk and CPU.
- **Errors** (optional, recommended before scaling past the pilot): Sentry's free
  Developer plan via `@sentry/nextjs`. Not installed yet, since that's a separate change.

## 7. Domain — APPROVAL (DNS cutover)

1. `vercel domains add qrapp.ge` and `www.qrapp.ge` to the project. Set
   `www` → redirect (308) to `qrapp.ge`.
2. `vercel domains inspect qrapp.ge` prints the **exact** records Vercel
   wants. Use those values, not values copied from older docs. Typically:
   apex `A` record → Vercel's anycast IP; `www` `CNAME` → the
   `*.vercel-dns*.com` target shown.
3. At Domenebi.ge: remove any conflicting parking `A`/`AAAA`/`CNAME`
   records on `@` and `www`; add the records from step 2. If a `CAA` record
   exists, it must allow `letsencrypt.org`.
4. Verify: `dig +short qrapp.ge A`, `dig +short www.qrapp.ge CNAME`, Vercel
   shows "Valid Configuration", the certificate is issued, and `curl -I https://qrapp.ge`
   shows HSTS, CSP and the other `next.config.ts` security headers.

## 8. Post-deploy validation

Against the production URL (and first against a preview on staging):
golden path (scan → create → theme → message/photo/video/voice → preview →
checkout fails closed in production), partner login + dashboard, admin login,
password reset (real email), `/api/health`, security headers, and, against
the production database with production's variables exported (both read-only):
`npm run ops:preflight` (every migration applied and none skippable, env
combinations, admins, private bucket) and `npm run ops:check-launch-pricing`.
Run `ops:preflight` after every migration on staging and production.

## 9. Rollback

- **App**: Vercel → Deployments → previous production deployment →
  "Promote" (instant rollback, no rebuild). The CLI equivalent is `vercel rollback`.
- **Config**: change the variable in Vercel, then redeploy. Rotating
  `EDIT_TOKEN_SECRET` invalidates open (unpaid) sender sessions.
- **Database**: migrations are forward-only, so fix them with a new forward
  migration. In a genuine data-loss emergency only, restore the daily backup
  (Pro). Prices are data: reactivate the previous `prices` row and deactivate
  the new one. Orders snapshot their own amount and are never repriced.
- **Domain**: remove the Vercel records at Domenebi.ge (or point them back);
  propagation follows the records' TTL. Lower the TTL to 300 seconds a day before cutover.

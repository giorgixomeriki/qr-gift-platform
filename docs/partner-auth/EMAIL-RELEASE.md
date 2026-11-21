# Email-only partner authentication — release runbook

Scope: email onboarding and login for partners. **Out of scope and hidden:** SMS/phone
sign-in (`PARTNER_PHONE_AUTH_ENABLED` stays unset/false; no phone field, button or tab
is rendered and the phone actions refuse), the per-QR results table (not rendered) and
employee management (`PARTNER_TEAM_MEMBERS_ENABLED` unset).

## State on 2026-11-21

- Production: Render `dep-dc01qme0tbcc73ahmoj0`, commit `f575182` (checked via the Render
  deploys API). Prod ledger: 23 migrations, last `0022_music_content_type` (`when` 1795161600000).
- **Branch:** `release/partner-auth-after-bog`, stacked on `release/bog-payments-f575182`
  (`4350882`, Session 1's BOG release; it owns 0023 and 0024). `feat/partner-auth`
  (on f575182, migration 0023) is superseded and must not ship.
- **Migration order (resolved):**

  | # | Migration | `when` | Branch |
  |---|---|---|---|
  | 0022 | music_content_type | 1795161600000 | **in prod** |
  | 0023 | checkout_consents | 1795219200000 | BOG release (ships first) |
  | 0024 | payment_release_safety | 1795222800000 | BOG release (ships first) |
  | 0025 | partner_login_access | 1795334400000 | this branch |
  | 0026 | partner_locations | must be > 1795334400000 | `feat/partner-locations-map` (renumber before shipping) |

  Drizzle applies a migration only if its `when` is above the last applied one, so the
  order above is mandatory: shipping 0025 before BOG's 0023/0024 would make drizzle
  **silently skip** them. The migrations touch disjoint objects (BOG: checkout_consents,
  enforce_qr_status_transition, greetings/ledger policies; this one: partners columns,
  partner_invitations, 3 enums, 4 functions).
- Upgrade path tested on a fresh stack: prod's 23 migrations (from f575182) → pre-existing
  admin/partner/login created with prod code → this branch's migrator → 26 rows in order,
  both tables present, no anon/authenticated grants, existing partner/member unchanged.

## Resend + DNS (owner steps marked 👤)

1. 👤 Sign up at resend.com (free plan: 3,000/month, 100/day, 1 domain). API Keys → Create
   `qrapp-setup`, **Full access**. Copy it, then in Terminal:
   `pbpaste > ~/.qrapp-review/resend-setup-key && chmod 600 ~/.qrapp-review/resend-setup-key`
2. `npx tsx scripts/ops/resend-setup.ts records` adds `qrapp.ge` (eu-west-1), turns open/click
   tracking **off** (click tracking would rewrite the one-time activation links) and prints
   the exact records.
3. 👤 Route 53 → Hosted zones → qrapp.ge → Create record (TTL 300) for each printed record:
   TXT `resend._domainkey.qrapp.ge`, MX `send.qrapp.ge` (10 feedback-smtp.eu-west-1.amazonses.com),
   TXT `send.qrapp.ge` (`v=spf1 include:amazonses.com ~all`). Optional: TXT `_dmarc.qrapp.ge`
   `v=DMARC1; p=none;`. qrapp.ge has no MX/SPF/DKIM/DMARC today, so nothing is replaced.
4. `npx tsx scripts/ops/resend-setup.ts verify` until every record and the domain show `verified`.
5. `npx tsx scripts/ops/resend-setup.ts sending-key` → `~/.qrapp-review/resend-api-key` (app) and
   `npx tsx scripts/ops/resend-setup.ts smtp-key` → `~/.qrapp-review/resend-smtp-key` (Supabase Auth).
   Both are sending-only and restricted to qrapp.ge; values are never printed.
6. 👤 Resend → API Keys → delete `qrapp-setup`. Then `rm ~/.qrapp-review/resend-setup-key`.
7. Gate: `RESEND_API_KEY=$(cat ~/.qrapp-review/resend-api-key) PARTNER_EMAIL_FROM="QR STARR <partners@qrapp.ge>" npm run ops:check-partner-email -- --send-to <owner test inbox>`
   → **READY**, and the message arrives (check Gmail headers: `dkim=pass header.d=qrapp.ge`, `spf=pass`).

## Self-service "Forgot password" needs Supabase custom SMTP

Admin-issued activation/reset links go through Resend (the app's own transport). The
**self-service "Forgot password"** on `/partner/login` and `/admin/login` calls Supabase Auth
(`resetPasswordForEmail`), so it is sent by **Supabase's mailer**. Supabase's built-in mailer only
delivers to the project's org members and is capped at a few emails per hour, so without custom SMTP
partners do not receive it. (Last known 2026-10-18: no custom SMTP. Not re-read on 2026-11-21: the
read-only Management API call was denied in this session.)

Production setting change (needs owner approval), Supabase → Authentication → Emails → SMTP Settings:
host `smtp.resend.com`, port `465`, username `resend`, password = `~/.qrapp-review/resend-smtp-key`,
sender `no-reply@qrapp.ge`, name `QR STARR`. Then Authentication → Rate Limits → email: 30/h. Keep the
Email provider ON and "Allow new users to sign up" OFF. Confirm the redirect allow-list contains
`https://qrapp.ge/auth/confirm**`. Until this is done, the fallback is the admin's "Email password
reset link" button (Resend), which is fully tested.

## Environment checklist (Render, Save only — no manual deploy)

| Variable | Value | Notes |
|---|---|---|
| `PARTNER_EMAIL_TRANSPORT` | `resend` | hosted boot refuses `log` |
| `RESEND_API_KEY` | contents of `~/.qrapp-review/resend-api-key` | sending-only, qrapp.ge |
| `PARTNER_EMAIL_FROM` | `QR STARR <partners@qrapp.ge>` | domain must be verified |
| `PARTNER_INVITE_TTL_HOURS` | unset (default 72) | |
| `PARTNER_PHONE_AUTH_ENABLED`, `PARTNER_SMS_PROVIDER`, `PARTNER_TEAM_MEMBERS_ENABLED` | **unset** | SMS and staff stay off |

BOG's own variables belong to the BOG release (Session 1), not to this one.

## Release steps (after BOG is live and approved)

1. Confirm prod = the BOG release commit with 25 ledger rows (last `0024_payment_release_safety`).
   If Session 1 shipped a commit other than `4350882`, rebase this branch onto it:
   `git rebase --onto <bog-live-commit> 4350882 release/partner-auth-after-bog`. Only
   `_journal.json` can conflict: keep every BOG entry, then append this migration as the next
   idx/number with a `when` above BOG's last (rename the .sql file to match).
   Re-run verify:partner-auth / partner-email / admin-mfa / data-api-lockdown and the e2e below.
2. Resend gate READY (above) and the test email received.
3. Verified backup: `pg_dump -Fc` with the migrations URL inside the `supabase_db_qrgate2`
   container (pg_dump 17), plus sha256, TOC listing and a restore-count check into a scratch DB.
4. Apply 0025 with the migrations role (`npm run db:migrate` with `ops-env.sh`). Check: 26 rows,
   `partner_invitations` empty, partner/member counts unchanged, no anon/authenticated grants on it.
5. Render env vars (table above), Save only.
6. Deploy: fast-forward push to `feat/render-low-cost-hosting` (Render auto-deploys). Wait for `live`.
7. Supabase custom SMTP (section above), if approved.

## Post-deploy smoke test (live, owner-controlled test identity)

1. `/api/health` 200; `/partner/login` shows email + password only (no phone tab).
2. Admin (MFA) creates partner "Smoke Test (TEST)" with `<owner test inbox>` → Email activation link.
3. The email arrives (sender partners@qrapp.ge, DKIM pass); open → set password → `/partner/dashboard`
   shows only that partner (zero cards).
4. Open the same link again → "already used". Sign out → sign in at `/partner/login`.
5. Admin "Email password reset link" → set a new password → the old session is signed out.
6. (If SMTP configured) `/partner/forgot-password` → Supabase mail arrives → reset works.
7. Existing partner logins still sign in; admin login still requires the TOTP code.
8. Admin "Revoke login" → the partner session ends; then delete the test partner and its Auth user.

## Rollback

- Code: redeploy the BOG release's Render deploy (a push cannot move the branch backwards).
  0025 may stay: old code ignores its columns, table and functions.
- Email off: remove `PARTNER_EMAIL_TRANSPORT` / `RESEND_API_KEY` / `PARTNER_EMAIL_FROM`; the admin
  UI then says email delivery isn't configured.
- Resend: revoke `qrapp-render` / `qrapp-supabase-smtp` keys in Resend; DNS records may stay.
- Full schema removal (only if required): PARTNER-LOGIN-ACCESS.md → Rollback.

## Test evidence (2026-11-21, branch `release/partner-auth-after-bog`)

- tsc, eslint, `next build`: clean.
- verify: 37/37 suites green, incl. partner-auth 84, partner-email 17, admin-mfa 126,
  data-api-lockdown 47, partner-privacy 16, bog-adapter 65, bog-integration 70, reconciliation 48.
- e2e (prod build, dedicated stack): partner-login-access 3/3 (+3 phone skipped by design),
  partner-email-journey 3/3 (desktop Chromium, Pixel 7, iPhone 14 WebKit),
  auth + partner-privacy + role-isolation + admin-mfa 20/20.

# Email-only partner authentication — release runbook

Scope: email onboarding and login for partners. **Out of scope and hidden:** SMS/phone
sign-in (`PARTNER_PHONE_AUTH_ENABLED` stays unset/false; no phone field, button or tab
is rendered and the phone actions refuse) and the per-QR results table (not rendered).
Employee management stays off (`PARTNER_TEAM_MEMBERS_ENABLED` unset).

## State on 2026-11-20 (checked read-only)

- Production: Render `dep-dbvtnll9el5s73ei8qu0`, commit `7bf144a`. This branch is built on it.
- Prod migrations: 23 rows, last `0022_music_content_type` (`when` 1795161600000).
  No `partner_invitations` or `partner_locations` table yet.
- **Migration numbering is resolved:** this release ships as `0023_partner_login_access`
  (`when` 1795334400000), the next number after prod. `feat/partner-locations-map`
  (unshipped) must become **0024** with `idx` 24 and a `when` above 1795334400000
  before it ships. Otherwise drizzle would skip a migration.
- Resend: **not configured.** No key exists on Render or locally, and qrapp.ge has no
  Resend DNS records (`npm run ops:check-partner-email` → NOT READY). Release is blocked
  on the manual steps below. Nothing was deployed.

## Manual setup (owner)

1. **Resend account** (free tier: 3,000 emails/month, 100/day, 1 domain): sign up at
   resend.com.
2. **Domains → Add domain → `qrapp.ge`**, region **eu-west-1 (Ireland)**. Resend then
   shows 3 records. Copy the values exactly from its screen; the DKIM key is unique:

   | Type | Name (in Route 53) | Value | Priority |
   |---|---|---|---|
   | TXT | `resend._domainkey.qrapp.ge` | `p=MIGf…` (from Resend) | — |
   | MX | `send.qrapp.ge` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
   | TXT | `send.qrapp.ge` | `"v=spf1 include:amazonses.com ~all"` | — |
   | TXT (optional) | `_dmarc.qrapp.ge` | `"v=DMARC1; p=none;"` | — |

   None of these touch the root domain's records (qrapp.ge has no MX/SPF today).
3. **AWS console → Route 53 → Hosted zones → qrapp.ge → Create record** for each row
   (TTL 300). The zone's name servers are `ns-*.awsdns-*`. Then press **Verify DNS
   records** in Resend and wait for **Verified**, usually within minutes.
4. **Resend → API Keys → Create:** name `qrapp-render`, permission **Sending access**,
   domain `qrapp.ge`. It is shown once. Save it without pasting it into chat:
   `pbpaste > ~/.qrapp-review/resend-api-key && chmod 600 ~/.qrapp-review/resend-api-key`
5. Recommended, not blocking: in Supabase Auth → Sign In / Providers, turn **off**
   "Allow new users to sign up", but keep the Email provider on.

## Release steps (after the key exists; I run these)

1. `RESEND_API_KEY=$(cat ~/.qrapp-review/resend-api-key) PARTNER_EMAIL_FROM="QR STARR <partners@qrapp.ge>" npm run ops:check-partner-email -- --send-to <owner address>` → **READY**, and the email arrives.
2. Verified prod backup: `pg_dump -Fc` with the migrations URL inside the
   `supabase_db_qrgate2` container (pg_dump 17), plus sha256, TOC and a restore-count check.
3. Apply 0023 with the migrations role. Check 24 rows, the new table empty, the 3/2
   partner/member counts unchanged, and no anon/authenticated grants on the new table.
4. Render env (Save only): `PARTNER_EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`,
   `PARTNER_EMAIL_FROM=QR STARR <partners@qrapp.ge>`. Do not set `PARTNER_PHONE_AUTH_ENABLED`,
   `PARTNER_SMS_PROVIDER` or `PARTNER_TEAM_MEMBERS_ENABLED`.
5. Deploy: fast-forward push of the release commit to `feat/render-low-cost-hosting`.
6. Live test: create a TEST partner with an owner-controlled email → Email activation
   link → open from the inbox → set password → `/partner/dashboard` → sign out → sign
   in at `/partner/login` → check the link can't be reused → admin "Email password
   reset link" → revoke login → remove the test partner.

## Rollback

- Code: redeploy `dep-dbvtnll9el5s73ei8qu0` (7bf144a) from Render, or push 7bf144a
  to the deploy branch. 0023 may stay: old code ignores its columns, table and functions.
- Env: removing the three `PARTNER_EMAIL_*`/`RESEND_API_KEY` variables turns email links
  off (the admin UI then says email delivery isn't configured).
- Full schema removal (only if required): see PARTNER-LOGIN-ACCESS.md → Rollback.

# Partner login access

Branch `feat/partner-auth`, rebased on production `f575182`. Not deployed.

## What it does

- **One partner = one login.** An admin registers the partner with a Georgian mobile
  number (+995 5XX XXX XXX) and/or an email. At least one is required; email is
  optional. A contact belongs to at most one partner.
- **The login is linked only after the person proves the contact is theirs.**
  - **Email:** the admin sends a single-use activation link (256-bit token, only
    its SHA-256 is stored, valid `PARTNER_INVITE_TTL_HOURS`, default 72 h, hard
    cap 7 days). Opening it and choosing a password (≥ 10 characters) creates
    the login, links it as the partner's OWNER, and signs in.
  - **Phone:** the admin opens phone sign-in for the partner's number. The
    partner signs in at `/partner/login` → Phone with an SMS code. Supabase
    Auth sends and checks the code through the project's SMS provider. This
    app never generates, stores or sees an OTP, and has no mock OTP path.
- **Recovery:** an email login uses the existing "Forgot password" page
  (needs Supabase SMTP, see blockers). An admin can also email a single-use
  reset link from the partner page; it works without Supabase SMTP. A phone
  login recovers by signing in with a new SMS code. If the phone is lost, the
  admin revokes the login and invites the new number.
- **Revocation:** "Revoke login" removes the membership, so access ends on the
  next request because every partner page and action re-checks membership in
  the database. It also blocks the Auth account, unless that account is an
  admin or belongs to another partner.
- **Partner dashboard:** a new "Results by QR card" table (scans, paid
  activations, revenue, commission per card), next to the existing totals,
  payouts and inventory. Money counts only from PAID orders and the commission
  ledger, which is written only on a confirmed payment. Handing a card over
  (DISTRIBUTED) is shown as a status, never as a sale. Attribution stops at
  partner + card; no employee or user is recorded on any sale.
- **No employee accounts.** Staff management on the partner dashboard is
  hidden, and its actions are refused, unless `PARTNER_TEAM_MEMBERS_ENABLED=true`.
  An admin can add a login by the old path only to a partner that has none.
  Existing extra members keep working and are not modified. The admin page
  still lists them so they can be cleaned up.

## Security rules (all enforced server-side)

| Rule | Where |
|---|---|
| Claim only with a pending, unexpired, unrevoked invitation for an ACTIVE partner, whose contact matches what Supabase verified | `app_accept_partner_invitation()` under `FOR UPDATE` locks |
| Partner has no login yet; the login has no partner yet; the login is not a platform admin | same function, plus an earlier check when the admin issues the invitation |
| One open invitation per partner; reissuing revokes the old one; changing a contact revokes its open invitation | partial unique index + `setPartnerContacts` |
| An unlinked pre-existing account at the contact is **replaced**, not adopted (blocks pre-account hijacking and stale sessions) | `activateWithEmailLink`, `requestPhoneSignInCode` |
| Activation, reset and first phone link end every other session (`signOut({ scope: "others" })`) | `login-actions.ts` |
| Rate limits **fail closed**: link attempts 10/15 min per IP and 5/15 min per link; SMS sends 3/15 min and 8/day per number and 10/h per IP; code checks 5/15 min per number and 20/15 min per IP | `login-access.ts` |
| A code request reads the same for any number (no partner enumeration). The form sends SMS only to linked logins and to numbers with an open invitation | `requestPhoneSignInCode` |
| Invitations are admin-only under RLS and not reachable through the Data API. The person reaches theirs only through two SECURITY DEFINER functions | migration 0025 |
| Every invite, revoke, contact change, activation, recovery and login revocation is audit-logged, with contacts masked | `audit_logs` |
| All new admin actions refuse below aal2 (MFA) | `verify:admin-mfa` §15 |

## Environment variables

| Variable | Default | Production value |
|---|---|---|
| `PARTNER_EMAIL_TRANSPORT` | unset (email links unavailable) | `resend` |
| `RESEND_API_KEY` | — | secret, Resend API key (sending access only) |
| `PARTNER_EMAIL_FROM` | — | e.g. `QR STARR <partners@qrapp.ge>` (domain verified in Resend) |
| `PARTNER_INVITE_TTL_HOURS` | `72` | `72` (range 1–168; reset links are capped at 24 h) |
| `PARTNER_PHONE_AUTH_ENABLED` | `false` | keep `false` until an SMS provider is live |
| `PARTNER_SMS_PROVIDER` | — | required when hosted with phone on: `twilio`, `twilio_verify`, `vonage`, `messagebird`, `textlocal` or `send_sms_hook` |
| `PARTNER_TEAM_MEMBERS_ENABLED` | `false` | `false` |
| `PARTNER_EMAIL_LOG_FILE` | — | never in production (`PARTNER_EMAIL_TRANSPORT=log` is refused when hosted) |

## Supabase Auth settings (dashboard, owner)

1. **Sign-ups off:** Authentication → Sign In / Providers → turn off the global
   "Allow new users to sign up" (`disable_signup`). The app creates every partner
   account through the admin API, so public sign-up is only an attack surface.
   Admin-created users are unaffected. **Keep the Email provider itself enabled.**
   In the CLI config, `[auth.email] enable_signup = false` switches off the whole
   Email provider ("Email logins are disabled"): verified on the local stack,
   where it broke every password sign-in. The same applies to the Phone provider.
2. **Phone (only when enabling SMS):** enable the Phone provider and configure a real
   provider. Twilio and Vonage cover Georgian numbers. A local Georgian gateway
   needs Supabase's Send SMS hook. Set OTP length 6, expiry ≤ 300 s, and the SMS
   rate limit. Never configure test phone numbers / test OTPs in the production
   project.
3. **SMTP (recommended):** a custom SMTP server, such as Resend's SMTP, makes the
   existing "Forgot password" email reach real partners. Without it, use the
   admin "Email password reset link".

## Migration plan

Migration `0025_partner_login_access` (journal `when` 1795334400000) is additive:

- 2 nullable columns on `partners` (format checks, partial unique indexes)
- 3 enum types, table `partner_invitations` (RLS, admin-only policies `TO app_runtime`)
- 4 SECURITY DEFINER functions (EXECUTE granted only to `app_runtime`)

It changes no existing row, policy or function. QR activation, orders, payments,
the ledger and payouts are untouched.

**Ordering (decided 2026-11-21):** production has 23 migrations (last `0022_music_content_type`,
`when` 1795161600000). The BOG release (`release/bog-payments-f575182`) owns `0023_checkout_consents`
and `0024_payment_release_safety` (`when` 1795222800000) and ships first. This branch is stacked on it
and ships as **0025** (`when` 1795334400000). `feat/partner-locations-map` becomes **0026** with a
`when` above 1795334400000. Never ship a migration with a `when` lower than the last applied one:
drizzle would silently skip it.

Steps (after approval):
1. Verified `pg_dump` backup through `ops-env.sh` (pg_dump 17 inside the qrgate2 container).
2. Apply 0025 with the migrations role. Check: `select count(*) from partner_invitations` = 0,
   `verify:data-api-lockdown` against prod-safe checks (no anon/authenticated grants).
3. Set env vars (Save only), then deploy by fast-forwarding `feat/render-low-cost-hosting`.
4. Live QA: create a test partner with the owner's email, then activate, sign in,
   reset and revoke. Remove the test partner afterwards.

**Rollback:** redeploy the previous Render deploy. 0025 may stay: old code
ignores the new columns, table and functions. To remove it fully:
`drop table partner_invitations; drop function app_accept_partner_invitation, app_partner_invitation_by_token, app_open_phone_invitation, app_user_partner_count; drop type partner_invitation_*; alter table partners drop column contact_email, drop column contact_phone;`
and delete the journal row.

## Tests

`npm run verify:partner-auth` runs 84 checks: contact rules, config guards, DB
constraints and RLS, email activation against the real local Supabase Auth,
duplicate and concurrent claims, account-linking refusals, expiry, suspension,
rate limits, recovery, revocation, pre-account hijacking, the phone flow with
send/verify stood in, partner isolation, and per-QR results through the real
checkout → TEST payment → activation path.

`e2e/partner-login-access.spec.ts` covers two browser journeys. In the first,
an MFA admin creates a partner, emails the link, the partner activates and lands
on the dashboard, the link can't be reused, and revoking the login ends access.
In the second, phone sign-in goes through the real Supabase OTP path. It needs a
local stack with `[auth.sms.test_otp]` and `E2E_PHONE_OTP=1`, and must never run
against production.

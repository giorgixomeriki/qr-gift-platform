# Admin MFA and owner accounts

Status: **implemented on `feat/admin-mfa-v2`, not deployed.**

## What is enforced

Every admin request needs a verified password **and** a verified TOTP code
(Supabase Auth `aal2`) from a factor this server authorized.

| Surface | Guard | Below that |
| --- | --- | --- |
| Admin pages | `requireAdminPage()` | Redirect to locked, enrollment or challenge |
| Admin server actions | `requireAdmin()` | `MfaRequiredError` |
| `/api/qr/*`, batch export, print sheet | `resolveOperatorViewer()` | 403 / redirect |

Those last routes authorize through RLS, where `app_is_admin()` only knows the
user id, so an admin below aal2 must be refused there.

`aal` comes from `getClaims()` (signature verified). `getUser()` supplies the
live factors and `app_metadata`, and catches revoked sessions.

The scheduled reconciliation has no user session. It authenticates with
`CRON_SECRET` and acts as `RECONCILE_ADMIN_USER_ID`.

## First enrollment

Supabase lets any password session enroll a first factor through its public
API. A check inside the app's enrollment screen is therefore not enough.

- Enrolling needs an **operator-issued grant** that expires (default 30
  minutes) and is used up by one enrollment.
- The server records each factor it creates. Grant and list live in auth
  `app_metadata` (`admin_mfa`), which a user cannot write.
- Any verified factor the server didn't create **locks the account**, even at
  aal2. An operator grant can't clear it; only `reset-mfa` can.

An admin with a password and no grant reaches only `/admin/mfa/locked`. The
demo admin is never granted.

## Operator tool

```
npm run ops:admin-access -- status --expect-host <host>
npm run ops:admin-access -- onboard --email <e> --credential-file <path> [--minutes 30] --expect-host <host> [--apply]
npm run ops:admin-access -- grant-enrollment --email <e> --reason "<why>" [--minutes 30] --expect-host <host> [--apply]
npm run ops:admin-access -- reset-mfa --email <e> --reason "<why>" --credential-file <new path> --expect-host <host> [--apply]
npm run ops:admin-access -- revoke --email <e> --reason "<why>" --expect-host <host> [--apply]
```

It needs `NEXT_PUBLIC_SUPABASE_URL`, a secret key and
`MIGRATIONS_DATABASE_URL`, and works even when no admin can sign in. Without
`--apply` it is a dry run. `--expect-host` must match the configured project.
Each change is written to `audit_logs`. Passwords go to a new mode-0600 file,
are never printed, and never overwrite an existing file. Grants last at most
120 minutes.

## Recovery and lockout

**One device lost, backup still works:** sign in with the backup, remove the
lost device at `/admin/security`.

**All devices lost, or the account shows locked:**

1. Confirm the request really comes from the owner.
2. Run `reset-mfa`. It always sets a new password, so the old password can't
   use the new grant. It removes all factors, ends all sessions, opens a grant.
3. Owner signs in with the temporary password, enrolls, adds a backup, changes
   the password.

**The grant expired before enrolling:** `grant-enrollment`.

`revoke` refuses to remove the last admin, and refuses unless another admin
has working MFA, so the demo admin can't be retired before the owner is in.

If the operator credentials are also lost: Supabase dashboard → Authentication
→ the user → remove MFA factors, then restore credentials and run `reset-mfa`.

## Known limits

- The app limits code checks to 10 per 5 minutes per user and fails open if
  its store is down. A password session can also call Supabase's verify
  endpoint directly, bounded only by Supabase's `token_verifications` limit.
  Review that value with the production auth config.
- Supabase has no TOTP recovery codes, hence the backup device.
- Verifying a first factor makes Supabase end the account's other sessions.
- During a grant, whoever holds the password can enroll. Keep the window
  short and open it only when the owner is ready.

## Tests

- `npm run verify:admin-mfa`: real sessions against a local Supabase stack.
- `e2e/admin-mfa.spec.ts`: the browser journey and the password-only and
  direct-enrollment attacks. Set `E2E_PORT` to use a free port.

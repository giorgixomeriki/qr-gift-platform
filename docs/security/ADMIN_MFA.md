# Admin MFA and owner accounts

Status: **implemented on `feat/admin-mfa-v2`, not deployed.**

## What is enforced

Every admin request needs a verified password **and** a verified TOTP code
(Supabase Auth `aal2`). No code computes or stores TOTP secrets.

| Surface | Guard | Without aal2 |
| --- | --- | --- |
| Admin pages | `requireAdminPage()` | Redirect to `/admin/mfa` or `/admin/mfa/setup` |
| Admin server actions | `requireAdmin()` | `MfaRequiredError` |
| `/api/qr/*`, batch export, print sheet | `resolveOperatorViewer()` | 403 / redirect |

The last row matters: those routes authorize through RLS, and
`app_is_admin()` only knows the user id. An admin below aal2 must be refused
there, not treated as a partner.

`aal` comes from `getClaims()` (signature verified, ES256 in production).
`getUser()` supplies the live factor list and catches revoked sessions.

The scheduled reconciliation is the one exception: it has no user session and
authenticates with `CRON_SECRET`, acting as `RECONCILE_ADMIN_USER_ID`.

Partner accounts are unchanged. Nothing in the app can write `admin_users`,
and the operator tool refuses any account with a partner membership.

## Operator tool

```
npm run ops:admin-access -- status    --expect-host <supabase host>
npm run ops:admin-access -- onboard   --email <e> --credential-file <path> --expect-host <host> [--apply]
npm run ops:admin-access -- reset-mfa --email <e> --reason "<why>" [--credential-file <path>] --expect-host <host> [--apply]
npm run ops:admin-access -- revoke    --email <e> --reason "<why>" --expect-host <host> [--apply]
```

Needs `NEXT_PUBLIC_SUPABASE_URL`, a secret key and `MIGRATIONS_DATABASE_URL`.
Without `--apply` it is a dry run. `--expect-host` must match the configured
project. Each change is written to `audit_logs`. Needs no email delivery: a
new account gets a random temporary password in a new mode-0600 file, which is
never printed and never overwrites an existing file.

## Rollout (each step needs owner approval)

1. Confirm TOTP enroll and verify are enabled on the production Supabase
   project. If they are off, every admin is locked out at the enrollment step.
2. Deploy this branch after Security Stage 3 has passed.
3. `onboard` the owner with `--credential-file` under `~/.qrapp-review/`.
4. Owner signs in at `/admin/login`, scans the QR code, then adds a **backup
   authenticator** at `/admin/security`.
5. Owner changes the temporary password (Forgot password on the admin login).
   Delete the credential file.
6. Set `RECONCILE_ADMIN_USER_ID` to the owner's id if the schedule uses the
   demo admin.
7. `revoke` the demo admin. The tool refuses to remove the last admin, so this
   only works once step 3 is done.

Between steps 2 and 4 the demo account is still the only admin and has no
factor, so the first person to sign in with its password enrolls. Do steps 3–4
straight after the deploy, or revoke the demo admin first thing.

## Recovery

**Lost one device, backup still works:** sign in with the backup, then remove
the lost device at `/admin/security`.

**Lost every device (break-glass):**

1. Confirm the request really comes from the owner. Reset is the strongest
   action this tool has.
2. Dry run, then apply, and always rotate the password in the same step, so a
   stolen password can't enroll a new device first:
   `reset-mfa --email <e> --reason "lost phone" --credential-file <new path> --expect-host <host> --apply`
3. The tool removes all factors, ends all sessions, and audits the reason.
4. Owner signs in with the temporary password, enrolls again, adds a backup,
   and changes the password.

If the operator credentials are also lost: Supabase dashboard → Authentication
→ the user → remove MFA factors. Rehearsed locally by `verify:admin-mfa` §11.

## Known limits

- The app rate-limits code checks to 10 per 5 minutes per user, and fails open
  if its store is down. A client holding a password session can also call
  Supabase's verify endpoint directly, which only Supabase's own
  `token_verifications` limit bounds. Check that value when reviewing the
  production auth config.
- Supabase has no TOTP recovery codes, hence the backup device and break-glass.
- The first enrollment is trust-on-first-use. That is why onboarding is
  followed immediately by the owner's first sign-in.

## Tests

- `npm run verify:admin-mfa`: 84 checks on real sessions against a local
  Supabase stack (TOTP enabled in that stack's config).
- `e2e/admin-mfa.spec.ts`: the browser journey. Admin specs enroll through
  `e2e/admin-session.ts`. `E2E_PORT` picks a free port.

# Admin MFA — temporary pause (lost authenticator)

Introduced 2026-11-26 because the owner's phone holding the only admin TOTP
factor broke. Mandatory MFA stays the default; this is a narrow, expiring,
config-only exception. See `docs/security/ADMIN_MFA.md` for normal MFA.

## What the pause does

Two Render environment variables, both required:

| Variable | Value |
|---|---|
| `ADMIN_MFA_PAUSE_USER_ID` | the one admin's auth user id (a single UUID; no lists, no wildcards) |
| `ADMIN_MFA_PAUSE_UNTIL` | ISO time **with zone**, e.g. `2026-12-10T20:00:00Z`, in the future and at most 31 days away |

While active, **only that user**, **only while still in `admin_users`**, after
a normal Supabase email + password sign-in (aal1), gets the access level
`GRANTED_MFA_PAUSED`:

- Admin pages, partner/inventory/moderation/locations actions, QR asset/export/print: allowed (same RLS, same admin context, same audit logs and rate limits as before).
- **Blocked (need a real aal2 session):** refunds, chargebacks, payouts, default/partner price and commission changes, admin payment reconcile and activation reconcile (`requireAdmin(..., { financial: true })`).
- MFA enrollment/removal in the app: blocked (an aal1 session must never register a device).
- An unauthorized factor still locks the account (`MFA_LOCKED`).
- An operator enrollment grant takes precedence over the pause (restoration always goes to `/admin/mfa/setup`).
- Every other admin, partners and anonymous users: unchanged.
- An amber banner on every admin page states the pause and the expiry.
- Logs `ADMIN_MFA_PAUSED until … ` once per process (or `ADMIN_MFA_PAUSE_IGNORED: <reason>` when the values are invalid).

It fails closed: missing/invalid/expired/too-long values = MFA required. It
expires on its own at `ADMIN_MFA_PAUSE_UNTIL` with no deploy needed. No
password, secret or token was added; partner auth code is untouched.

Tests: `npm run verify:admin-mfa-pause` (64 checks, local stack only) and the
unchanged `npm run verify:admin-mfa` (126 checks, pause unset).

## Turn on / extend

Render → qr-starr → Environment: set both variables, Save, then deploy/restart
(Render applies env changes on the next deploy). To extend, set a new
`ADMIN_MFA_PAUSE_UNTIL` (≤ 31 days from now) and restart.

## Restore mandatory MFA with the new phone

1. Install an authenticator app (Google Authenticator / Microsoft Authenticator / 1Password …) on the new phone.
2. Operator (Claude session, with owner approval), dry run first, from a worktree of the live commit:
   ```sh
   . ~/.qrapp-review/ops-env.sh
   H=$(node -e 'console.log(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host)')
   ./node_modules/.bin/tsx scripts/ops/admin-access.ts reset-mfa --email <owner email> \
     --reason "lost phone; new authenticator" --credential-file ~/.qrapp-review/owner-reset.txt \
     --minutes 30 --expect-host "$H"            # dry run
   # same command + --apply
   ```
   This rotates the password (new one in the 0600 file), deletes the lost factor, ends every session and opens a 30‑minute enrollment grant.
3. Owner signs in at https://qrapp.ge/admin/login with the temporary password → redirected to `/admin/mfa/setup` → scan the QR with the new phone → enter the 6‑digit code. Then change the password via “Forgot password”, and delete the temp file.
4. Check: `admin-access.ts status` shows `authorized factors: 1  UNAUTHORIZED factors: 0  enrollment grant: none`.
5. Render → Environment: **delete** `ADMIN_MFA_PAUSE_USER_ID` and `ADMIN_MFA_PAUSE_UNTIL`, Save, deploy/restart.
6. Verify: sign out, sign in with password → `/admin/mfa` asks for the code; banner gone; a refund-page action works only after the code.

Optional later cleanup: revert the commit that added the pause. Not required;
unset variables leave it inert.

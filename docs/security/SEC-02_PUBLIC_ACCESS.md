# SEC-02 — Removing the owner-review gate (public access)

Branch `release/remove-owner-gate`, stacked on `security/revoke-anon-data-api`
(PR #11, SEC-01). Prepared and tested locally only. **Merging it into the
branch Render deploys (`feat/render-low-cost-hosting`, auto-deploy on) is the
go-live action.** Do not merge until every precondition in §4 is closed.

## 1. Inventory of the gate (before this change)

| Kind | Where | Status |
|---|---|---|
| Gate logic | `src/lib/security/owner-gate.ts` (`ownerGateAllows`, `ownerGateChallenge`) | deleted |
| Middleware | `src/middleware.ts`: gate call first; matcher widened to API routes, media and prefetches | restored to the pre-gate version (`46ca70e^`) |
| Env vars | `OWNER_REVIEW_GATE_USER` (`owner`), `OWNER_REVIEW_GATE_PASSWORD` (Render `generateValue`) | removed from `render.yaml`; still set on the live service until the owner deletes them |
| Tests | `scripts/verify-low-cost-hosting.ts` §2 (gate behaviour) and §6 (`generated("OWNER_REVIEW_GATE_PASSWORD")`) | replaced by public-access checks (below) |
| Docs | `ENVIRONMENT_MATRIX.md`, `OWNER_REVIEW_DEPLOYMENT.md`, `RENDER_DEPLOYMENT.md`, comment in `api/ops/client-ip/route.ts` | updated |
| Not touched | historical mentions in SEC-01 doc and `rollback-0020-close-data-api.sql` | kept as history |

The e2e suite never relied on the gate (local runs have no password set).

## 2. What stays protected without the gate

The gate was defence-in-depth only; no surface relied on it for access control.

- **Admin / Partner**: every page, server action and API route checks the
  Supabase session server-side (`requireAdmin`, `requirePartnerContext`,
  `getSessionUser` + `checkIsAdmin`/`getPartnerRole`); middleware still refreshes
  the session on `/admin` and `/partner`. Covered by `verify:phase1–5`,
  `partner-privacy`, `admin-pagination`, e2e `auth.spec.ts`.
- **Future Admin MFA** (`feat/admin-mfa`) enforces aal2 in those same server
  guards, so it is independent of this change.
- **Sender / recipient**: `/g/[token]` is public by design (token entropy +
  HMAC edit tokens). No login needed to create, preview or view a greeting.
- **Supabase**: SEC-01 is in production (migration 0020: anon/authenticated
  have no grants or schema USAGE; policies `TO app_runtime`) and the Data API is
  disabled. Storage bucket private, signed URLs only. Sign-up disabled.
- **Payments**: unchanged. `PAYMENTS_PROVIDER=TEST` in production = checkout
  closed; webhooks 404; no `BOG_*`, no `CRON_SECRET`.
- `/api/ops/client-ip` stays 404 (`CLIENT_IP_DIAGNOSTICS=false`).

New checks (`verify:low-cost-hosting` §2, §6): gate module absent; middleware
has no Basic challenge; matcher skips `/api` again; `/`, `/g/…`,
`/reset-password` answer without credentials **even with stale
`OWNER_REVIEW_GATE_*` variables set**; `render.yaml` has no gate variable.
Mutation-tested: all six §2 checks fail against the old gate code.

Note: with the code gone, the env var is no longer an emergency switch. The
fastest re-close is Render → qr-starr → **Suspend**, or reverting the merge.

## 3. Launch steps (owner-approved, in order)

1. Close every precondition in §4.
2. Merge PR #11, then this branch, into `feat/render-low-cost-hosting` →
   Render auto-deploys.
3. Render → qr-starr → Environment: delete `OWNER_REVIEW_GATE_USER` and
   `OWNER_REVIEW_GATE_PASSWORD` (harmless if left, but stale secrets).
4. Verify: `/` and `/g/<token>` 200 without credentials and no
   `WWW-Authenticate`; `/admin/dashboard` and `/partner/dashboard` redirect to
   login; `/api/webhooks/payments/TEST` 404; `/rest/v1/` 503;
   `LOCKDOWN_READ_ONLY=1 verify:data-api-lockdown` against prod; orders count
   unchanged.

## 4. Preconditions (blockers)

| # | Item | State on 2026-10-18 |
|---|---|---|
| P1 | Leaked legacy HS256 JWT secret revoked: app moved to `sb_publishable`/`sb_secret` keys, legacy API keys disabled, HS256 key revoked | **Open**: the key-migration code (`security/supabase-api-keys`) is uncommitted; Render still uses the legacy anon/service_role JWTs, so the secret cannot be revoked yet without breaking the site |
| P2 | `demo-admin@qrapp.ge` (super admin, no MFA) deleted, or replaced by the owner's own admin | **Open** |
| P3 | Demo partner + 12 demo cards retired (their tokens appear in working notes) | **Open** |
| P4 | PR #11 (SEC-01 code + lockdown suite) merged first | **Open** (DB side already live) |
| P5 | Gate password considered leaked (session transcript) | Moot once the gate is removed |

Not blockers for opening the site, but required before real customers / BOG
review: legal pages (`feat/legal-pages`, `LEGAL_*` unset), site-wide
`robots: noindex` in `app/layout.tsx`, Supabase Pro backups, SMTP, rate limit
on `recordContentPlayedAction`.

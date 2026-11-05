# Supabase API key migration: legacy JWT keys → publishable/secret keys

**Trigger:** on 2026-10-18 the legacy HS256 JWT secret of the production
Supabase project (`uxqkolrklmbyyrbnhpcf`, serving https://qrapp.ge) was
exposed in an operator chat transcript. The legacy `anon` / `service_role`
API keys are JWTs signed by that secret, so the secret can't be revoked until
nothing uses them any more. Whoever holds the secret can mint a
`service_role` token: full Storage access (all private greeting media) and
the Auth admin API (create users, reset passwords, issue magic links for the
real admin). Severity: **CRITICAL** until Stage 3 is done.

Code branch: `security/supabase-api-keys-v2` — `e1287fc` (Stage 0, originally
cut from `b042e08`) merged onto the production baseline `894f2ac`, plus
`b3b1001` (lockdown check reads keys through the resolver).

## Facts

Labels: **[V 2026-11-05]** verified read-only against production on that date
(public endpoints and the public browser key only; no secret used);
**[A 2026-10-18]** from the original audit, not re-checked; **[?]** unknown.

| Item | State |
|---|---|
| Live commit / deploy branch | `894f2ac` on `feat/render-low-cost-hosting` (Render auto-deploys every push to it) [V 2026-11-05] |
| Browser bundle key | exactly one legacy JWT: `alg HS256`, `role anon`, ref `uxqkolrklmbyyrbnhpcf`, exp 2036; no `sb_publishable_` [V 2026-11-05] |
| Server key | legacy `service_role` (the `894f2ac` code reads only the legacy variable names) [V 2026-11-05, by code] |
| Legacy API keys | enabled: legacy anon on `/auth/v1/settings` → 200 [V 2026-11-05] |
| Legacy HS256 secret `4af57eb8…` | **still trusted**: legacy anon sent as Bearer to `/auth/v1/user` → 403 "invalid claim: missing sub claim", i.e. its HS256 signature was accepted [V 2026-11-05]. Dashboard status "previously used" [A 2026-10-18] |
| User session signing key | ES256 `d3a1aabd…`, the only key in the public JWKS [V 2026-11-05]; in use since project creation [A 2026-10-18] |
| Access-token lifetime | 3600 s [A 2026-10-18] |
| Publishable / secret keys | `default` pair exists, unused [A 2026-10-18] |
| Data API (PostgREST/GraphQL) | disabled (503 PGRST002) [V 2026-11-05] and closed in the database (migration 0020) |
| Auth settings | email only, signup disabled, no anonymous users [V 2026-11-05]; no MFA in the app [V, code] |
| Token verification in the app | none local: sessions are verified by Supabase (`auth.getUser()` in `lib/auth/session.ts` and `middleware.ts`) [V, code] |
| Customer (sender/recipient) auth | no Supabase session; draft edit tokens are HMAC-SHA256 with the app's `EDIT_TOKEN_SECRET` — unaffected by this migration [V, code] |
| Signed Storage URLs | read 10 min, upload 5 min (`lib/storage/media.ts`) [V, code]. Whether Storage signs them with the legacy secret: [?] — Check C3 decides |
| Render env values / demo accounts still present | [?] — read only by the owner (dashboard) |
| Legacy key values at rest | Render env; `~/.qrapp-review/api-keys.json` (operator machine, 0600) [A 2026-10-18] |

## What the code does (Stage 0, on this branch)

- `src/lib/supabase/keys.ts` resolves the keys. The new publishable/secret
  variables win, and the legacy variables are a temporary fallback. Startup
  fails on a missing key, a swapped key, or an elevated key in a
  `NEXT_PUBLIC_` variable.
- `env.SUPABASE_SECRET_KEY` and `publicEnv.SUPABASE_PUBLISHABLE_KEY` are the
  only values the app reads; the raw variables are stripped from `env`.
  Every Supabase client uses them: `middleware.ts` and
  `lib/supabase/{server,client}.ts` (publishable, user session),
  `lib/auth/admin-users.ts` and `lib/storage/media.ts` (secret).
- Raw Storage requests (`lib/client/upload-to-signed-url.ts`,
  `lib/storage/verify-upload.ts`) use `apiKeyHeaders()`: a new key goes only
  in `apikey`, as Supabase requires; a legacy JWT keeps its Bearer. A
  signed-in user's session JWT still travels as `Authorization: Bearer`.
- `middleware.ts` is production's version (owner-review gate removed by
  SEC-02, `961dcb2`); only the session-refresh key changed.
- Scripts and seeds use the resolver. CI uses the new keys only.
  `ops:preflight` reports which key format is in use.
- Tests: `verify:supabase-keys` (unit, static and live negative-auth checks;
  CI runs every `verify:*`), `verify:data-api-lockdown` (works with either
  key format), `e2e/role-isolation.spec.ts`.

## Render configuration (production)

Service `qr-starr` (`srv-db914savcj2c73bhh6tg`), Frankfurt, Free plan, 1
instance, health check `/api/health`, auto-deploy on every commit to
`feat/render-low-cost-hosting`. `render.yaml` declares all four key
variables `sync: false` (dashboard-only). `CHECKOUT_ENABLED=false` and
`PAYMENTS_PROVIDER=TEST` must stay as they are throughout this migration.

## Dependencies

```
S2 local tests ──► PR + CI green ──► Stage 1 (env + deploy) ──► Check A0+A
                                                                   │
                                     Stage 2 (legacy keys off) ◄───┘
                                                │ Check B, ≥15 min stable
                                     Stage 3 (revoke HS256) ──► Check C
                                                │ ≥24 h stable
                                     Stage 4 (cleanup deploy)
```

- Checks A and C need one working admin and one working partner login. If
  the demo accounts are removed first, the owner accounts must exist, which
  needs working email (SMTP). Otherwise keep the demo accounts until Stage 3
  passes, then remove them.
- Stage 1 must not share a deploy with any other change: one deploy, one
  variable.

## Stages

Each stage needs the owner's explicit approval. Nothing below has been executed.

### Stage 1: run the app on the new keys (legacy keys still valid)

1. In the Supabase dashboard (Settings → API Keys), create two secret keys:
   `render-app` and `local-ops`. Don't reuse `default`, so each consumer can be
   revoked alone. Copy the publishable key.
2. On the operator machine, write the values to `~/.qrapp-review/`
   (0600, never echoed) and extend `ops-env.sh` to export
   `SUPABASE_SECRET_KEY` (local-ops).
3. On Render, **add** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
   `SUPABASE_SECRET_KEY` (`render-app`) with **Save only** (no rebuild).
   **Keep** the legacy variables for rollback.
4. Push `security/supabase-api-keys-v2` as its own branch (Render ignores it),
   open a PR into `feat/render-low-cost-hosting`, wait for CI.
5. Note the current live deploy ID (`894f2ac`) as the rollback target. Warm
   the service with `GET /api/health`.
6. Deploy: fast-forward `feat/render-low-cost-hosting` to the PR head and
   push (that push is the deploy; a fresh build is required because the
   publishable key is inlined at build time).
7. Verify Checks A0 and A.

**Rollback:** Render → Rollback to the `894f2ac` deploy. The legacy keys are
still valid and still in env, so it works as before. No Supabase change has
been made at this point.

#### Stage 1 risk review

| Risk | Mitigation |
|---|---|
| **Any push to `feat/render-low-cost-hosting` deploys immediately.** | Push the work branch on its own first; fast-forward the deploy branch only at the agreed moment. |
| **The publishable key is inlined at build time.** If the deploy builds before the new env vars exist, the bundle silently keeps the legacy anon key. That works now, but breaks at Stage 2. | Env first (Save only), then deploy. **Check A0** confirms the live bundle before Stage 2. |
| "Save, rebuild and deploy" on the env change rebuilds `894f2ac`. | Harmless (old code ignores the new variables). Still prefer "Save only". |
| New code with only legacy vars: falls back and runs. | None needed. |
| A malformed or swapped key fails startup. `/api/health` imports `env`, so it returns **500** (the value is not logged) and Render does not promote the deploy. | Confirm in the deploy log that `894f2ac` stayed live; otherwise roll back at once. |
| A well-formed key from the **wrong project** passes startup and the health check (health only queries Postgres). | Checks A2–A6 catch it within minutes. Roll back. |
| Rolling back **after Stage 2** to a legacy-only build breaks sign-in, uploads and media. | After Stage 2, re-enable the legacy keys **first**, then roll back. |
| Free-plan cold start (~1 min) after idle. | Warm with `/api/health` before deploying and before checking. |
| `ops:preflight` and seeding use the operator's `ops-env.sh`. | Switch it to `SUPABASE_SECRET_KEY` (local-ops) in step 2. |

### Stage 2: disable the legacy API keys

Preconditions: Checks A0 and A passed; Render logs clean for ≥ 15 min; fresh
verified production backup (`backup-prod.sh`); owner signed in to the Supabase
and Render dashboards (the rollback levers).

1. Supabase → Settings → API Keys → disable the legacy `anon` /
   `service_role` keys.
2. Verify Checks A and B. Watch Render logs for 15 minutes.

**Rollback:** re-enable the legacy keys (immediate, reversible).

### Stage 3: revoke the leaked HS256 secret

Do this once Stage 2 has been stable for **≥ 1 h 15 min** (Supabase's
documented minimum for a 1 h access-token lifetime; checked 2026-11-05 at
supabase.com/docs/guides/auth/signing-keys). Supabase also requires the
legacy `anon` / `service_role` keys to be disabled first (Stage 2).
- no HS256 user tokens should exist (ES256 has signed every session since
  project creation), so the wait is a safety margin, not a dependency;
- the longest-lived signed Storage URL in the app is 10 minutes;
- Supabase's docs disagree on whether Storage signed URLs use the legacy
  secret, so Check C3 is mandatory;
- revocation is reversible (revoked → standby); only deletion is permanent,
  and the legacy secret cannot be deleted.

1. Supabase → JWT Keys → previously used `4af57eb8…` → Revoke.
2. Optional: sign out all existing sessions of the demo accounts.
3. Verify Check C.

**Rollback (last resort only):** move the revoked key back to standby. That
re-trusts a compromised secret, so it is only for a total outage that the
Stage 2 toggle can't fix. Key-state changes are throttled for about 5
minutes.

### Stage 4: clean-up (code deploy, after ≥ 24 h stable)

- Code: remove the legacy fallbacks — `resolvePublishableKey` /
  `resolveSecretKey` and the `*Problems` functions in
  `src/lib/supabase/keys.ts`; the two optional legacy fields and their
  `delete`s in `src/lib/env.ts`; `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
  `src/lib/env.public.ts`; the legacy names in `render.yaml` and
  `scripts/verify-low-cost-hosting.ts`; the "(or legacy …)" messages in
  `src/db/dev-bootstrap.ts`, `scripts/ops/seed-owner-review.ts`,
  `scripts/verify-admin-pagination.ts`, `scripts/verify-password-reset.ts`.
  Make the new keys required, and update the legacy cases in
  `scripts/verify-supabase-keys.ts` to expect refusal.
- Render: delete `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
  (after the cleanup deploy is live).
- Operator machine: remove the legacy entries from `~/.qrapp-review/api-keys.json`.
- Supabase: revoke the unused `default` secret key.
- Delete the chat transcripts that contain the old secret (harmless after
  Stage 3, but still clutter).

**Rollback:** redeploy the previous build; the new keys stay valid.

## Rollback order (summary)

| Current stage | First lever | Then |
|---|---|---|
| 1 | Render rollback to the `894f2ac` deploy | — |
| 2 | Re-enable legacy API keys | Render rollback only if still broken |
| 3 | Re-enable legacy keys does **not** help HS256 tokens; check Storage/auth logs | Last resort: un-revoke `4af57eb8…` (re-trusts the leaked secret) |
| 4 | Redeploy the previous build | Restore the legacy env vars only if also re-enabling Stage 2 |

Checkout stays closed (`CHECKOUT_ENABLED=false`) throughout, so no payment
can be affected.

## Checks

Rules: print pass/fail and counts only, never key values, tokens or cookies.
Never use the leaked HS256 secret against production unless the owner
explicitly approves Check C4.

**A0: live bundle (gate before Stage 2).** Fetch `/`, `/login`,
`/partner/login`, `/admin/login`, collect every `/_next/static/**/*.js`.
Expect: `sb_publishable_` present; **0** strings starting `eyJ`; **0**
`sb_secret_`.

**A: app on new keys.**
- A1 `GET /api/health` → 200; `/` → 200 with no `WWW-Authenticate`
  (owner gate stays removed); `/api/webhooks/payments/TEST` → 404 (checkout
  closed).
- A2 `ops:preflight` with the operator env: `api-keys` both "new format";
  bucket private.
- A3 Partner: sign in → `/partner/dashboard`; `/admin/*` shows not-admin;
  another partner's QR API → 403/404; sign out → sign in again (session
  refresh through the middleware).
- A4 Admin: sign in; every admin page renders (pricing, partners, sales
  trace, chargebacks); an already-open admin session from before the deploy
  is still signed in (sessions don't depend on the API key).
- A5 Storage: on a DRAFT demo card (no payment), upload a photo — progress
  completes, the server magic-byte check (`verify-upload.ts`, secret key)
  accepts it, and the preview shows it.
- A6 Recipient: an ACTIVE demo greeting renders and its media plays
  (signed read URL).
- A7 Render logs: no `401` / `Invalid API key` / `Invalid Compact JWS` from
  Supabase calls.

**B: legacy keys dead (after Stage 2).**
- B1 The public legacy anon key (from a pre-migration bundle copy) on
  `/auth/v1/settings` → 401.
- B2 The legacy service_role key (operator file) on `/storage/v1/bucket`
  → 401.
- B3 Repeat A3–A6.

**C: secret revoked (after Stage 3).**
- C1 Dashboard: `4af57eb8…` shows **revoked**; JWKS still lists only ES256.
- C2 Secret-free signature probe: the public legacy anon JWT sent as
  `Authorization: Bearer` to `/auth/v1/user` must **no longer** return
  "missing sub claim" (that error means the HS256 signature was accepted;
  before the migration it did on 2026-11-05). Expect a signature/key
  rejection (401/403 without the claim message).
- C3 Storage: a signed read URL created **after** the revocation loads; a
  new upload (A5) works. If fresh signed URLs fail, Storage was signing
  with the legacy secret: re-check the Supabase Storage settings before
  anything else (do not un-revoke first).
- C4 (only with explicit owner approval) A token signed in memory with the
  old secret → 401 on `/auth/v1/user`; generate, use once, discard; never
  print or store it.
- C5 Repeat A3–A6.

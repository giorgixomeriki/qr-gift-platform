# Supabase API key migration: legacy JWT keys → publishable/secret keys

**Trigger:** on 2026-10-18 the legacy HS256 JWT secret of the review project
(`uxqkolrklmbyyrbnhpcf`) was exposed in an operator chat transcript. The
legacy `anon` / `service_role` API keys are JWTs signed by that secret, so the
secret can't be revoked until nothing uses them any more.

## Facts (audited 2026-10-18)

| Item | State |
|---|---|
| User session signing key | ES256 `d3a1aabd…`, **in use** since project creation |
| Legacy HS256 secret `4af57eb8…` | **previously used**: still trusted, not used to sign new tokens |
| Publishable / secret keys | `default` pair exists, unused |
| Access-token lifetime | 3600 s |
| Edge Functions / Realtime | none / not used |
| Data API (PostgREST/GraphQL) | disabled (dashboard) and closed in the database (migration 0020) |
| App use of the JWT secret itself | none: no local JWT verification |
| Legacy key values | Render env; `~/.qrapp-review/api-keys.json` (operator machine, 0600) |
| Leaked secret elsewhere | only that chat transcript; git history clean |

## What changed in code (Stage 0)

- `src/lib/supabase/keys.ts` resolves the keys. The new publishable/secret
  variables win, and the legacy variables are a temporary fallback. Startup
  fails on a missing key, a swapped key, or an elevated key in a
  `NEXT_PUBLIC_` variable.
- `env.SUPABASE_SECRET_KEY` and `publicEnv.SUPABASE_PUBLISHABLE_KEY` are the
  only values the app reads. The raw variables are stripped from `env`.
- Raw Storage requests (`upload-to-signed-url.ts`, `verify-upload.ts`) send
  a new key only in `apikey`, as Supabase requires. A legacy JWT keeps its
  Bearer. The SDK clients are unchanged, and a signed-in user's session JWT
  still travels as `Authorization: Bearer`.
- Scripts and seeds use the resolver. CI uses the new keys only.
  `ops:preflight` reports which key format is in use.
- Tests: `verify:supabase-keys` (unit, static and live negative-auth checks)
  and `e2e/role-isolation.spec.ts`.

## Stages

Each stage needs the owner's approval. Nothing below has been executed.

### Stage 1: run the app on the new keys (legacy keys still valid)

1. In the Supabase dashboard (Settings → API Keys), create two secret keys:
   `render-app` and `local-ops`. Don't reuse `default`, so each consumer can be
   revoked alone. Copy the publishable key.
2. On the operator machine, write the values to `~/.qrapp-review/`
   (0600, never echoed) and extend `ops-env.sh` to export
   `SUPABASE_SECRET_KEY` (local-ops).
3. On Render (`srv-db914savcj2c73bhh6tg`), **add**
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`
   (`render-app`). **Keep** the legacy variables for rollback. Use the
   dashboard, or the API with values piped from files.
4. Deploy. The branch is already based on the deployed commit `b042e08`.
   Render builds from GitHub, so this needs a **push**:
   - fast-forward `feat/render-low-cost-hosting` to this branch;
   - push it, which auto-deploys;
   - the result is a fresh build, which is required because the publishable
     key is inlined at build time.
5. Verify (§Checks A, including **A0**).

**Rollback:** Render → Rollback to `b042e08`, which still has the legacy keys
in env. No Supabase change has been made at this point.

#### Stage 1 risk review (Render service as configured on 2026-10-18)

The service has `autoDeploy: yes` (trigger: commit) on branch
`feat/render-low-cost-hosting`, health check `/api/health`, 1 instance, Free
plan, and no preview environments.

| Risk | Mitigation |
|---|---|
| **Any push to `feat/render-low-cost-hosting` deploys immediately.** | Push the work branch `security/supabase-api-keys` on its own first; Render ignores it. Fast-forward the deploy branch only at the agreed moment. |
| **The publishable key is inlined at build time.** If the deploy builds before the new env vars exist, the browser bundle silently keeps the legacy anon key. It works now, but breaks at Stage 2. | Order: (a) add the env vars and choose **Save only**, without a rebuild; (b) then push/deploy. **Check A0** below confirms the live bundle before Stage 2. |
| Saving env vars with "save, rebuild and deploy" rebuilds the *current* commit `b042e08`. | Harmless: the old code ignores the new variables. Still prefer "Save only". |
| Deploy order is otherwise safe: the new code with only legacy vars falls back and runs (tested). | None needed. |
| A malformed or swapped key fails startup. `/api/health` imports `env`, so it returns **500** (tested; the value is not logged) and Render does not promote the deploy. | Free plan: confirm in the deploy log that the failed deploy left `b042e08` live. If the Free plan has downtime on a failed deploy, roll back at once. |
| A well-formed key from the **wrong project** passes startup and the health check (health only queries Postgres). | Checks A1–A4 (login, upload) catch it within minutes. Rollback as above. |
| Rollback **after Stage 2** to `b042e08` would run with disabled legacy keys and break sign-in and uploads. | After Stage 2, a rollback must be paired with re-enabling the legacy keys (Stage 2 rollback) first. |
| Free-plan cold start (~1 min) after idle. | Warm with `/api/health` before checking. |
| `ops:preflight` and seeding use the operator's `~/.qrapp-review/ops-env.sh`. | Switch it to export `SUPABASE_SECRET_KEY` (local-ops) in step 2; preflight then reports both keys as "new format". |

### Stage 2: disable the legacy API keys

1. Supabase → Settings → API Keys → disable the legacy `anon` /
   `service_role` keys.
2. Verify (§Checks A and B). Watch Render logs for 15 minutes.

**Rollback:** re-enable the legacy keys. This is reversible and immediate.

### Stage 3: revoke the leaked HS256 secret (the safest point)

Do this right after Stage 2 has been stable for **≥ 15 minutes**:
- no HS256 user tokens exist (ES256 has signed every session for longer
  than the 1 h token lifetime);
- the longest-lived signed Storage URL in the app is 10 minutes;
- the legacy keys are already off;
- waiting longer only prolongs the exposure.

1. Supabase → JWT Keys → previously used `4af57eb8…` → Revoke.
2. Optional: sign out all existing sessions of the two demo accounts.
3. Verify (§Checks A, B and C).

**Rollback (last resort only):** move the revoked key back to standby and
rotate. That re-trusts a compromised secret, so it is only for a total
outage, and Stage 2's toggle is the first lever. Key-state changes are
throttled for about 5 minutes.

### Stage 4: clean-up

- Remove `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` from
  Render and `render.yaml`.
- Remove the fallback from `keys.ts` (make the new keys required), then
  redeploy.
- Remove the legacy entries from `~/.qrapp-review/api-keys.json`.
- Revoke the unused `default` secret key.

## Checks

**A0: live bundle (gate before Stage 2):** fetch the served JS chunks
through the gate. The publishable key's `sb_publishable_` prefix must be
present, and no `eyJ…` legacy anon JWT may appear. Print counts only.

**A: app on new keys** (each a pass/fail, no values printed):
- `GET /api/health` → 200; any page without gate credentials → 401 (gate still on).
- `ops:preflight` with the operator env: `api-keys` both INFO "new format";
  the bucket is private.
- Demo partner signs in and reaches `/partner/dashboard`; `/admin/*` shows
  not-admin; another partner's QR API returns 403/404.
- Demo admin signs in, and all admin pages render.
- The active demo greeting renders. A media upload on the existing draft
  card `6F227…`: progress completes, the server check accepts it, and the
  preview shows it. No payment is involved.
- Render logs: no `401` / `Invalid API key` / `Invalid Compact JWS` from
  Supabase calls.

**B: legacy keys dead:** the legacy anon key on `/auth/v1/settings` and the
legacy service_role key on `/storage/v1/bucket` → 401.

**C: secret revoked:** a token signed with the old HS256 secret → 401 on
`/auth/v1/user`. Generate it in memory, never print it, then discard it.
Fresh signed media URLs still load.

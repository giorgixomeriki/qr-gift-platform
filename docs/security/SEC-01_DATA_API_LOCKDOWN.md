# SEC-01 — Supabase Data API exposed the application schema

**Severity:** critical (P0). **Status:** fixed by migration `0020_close_data_api`, which is **not yet applied to the hosted project**.
**Found:** 2026-10-18, during the public-launch readiness audit of qrapp.ge.

## What was wrong

The app talks to Postgres only as `app_runtime`, over a direct connection (`src/db/client.ts`). Every RLS policy since 0001 was written for that role, but applies `TO public`. Several policies are deliberately wide open:
- `qr_codes_select USING (true)`;
- `rate_limit_hits_*` `USING (true)`;
- `audit_logs_insert` / `analytics_events_insert` `WITH CHECK (true)`.

They rest on one premise: "the app has no listing endpoint".

Supabase also serves `public` over PostgREST (`/rest/v1`, `/rest/v1/rpc`), and a hosted project's default privileges grant `anon`, `authenticated` and `service_role` ALL on everything created there. The anon key is public by design: it ships in the login form's JavaScript. So, on the hosted project, with only the anon key:

| What | Result before 0020 |
|---|---|
| `GET /rest/v1/qr_codes?select=public_token` | **200 — every QR token** (12 rows on qrapp.ge) |
| `GET /rest/v1/greetings`, `/greeting_content` | **200 — every ACTIVE/DRAFT greeting, ACTIVE greeting text and media keys** |
| `DELETE`/`PATCH`/`POST /rest/v1/rate_limit_hits` | **204/201 — every rate limit resettable** |
| `POST /rest/v1/audit_logs`, `/analytics_events`, `/reports` | **201 — forged audit, analytics and report rows** |
| `POST /rest/v1/rpc/app_is_admin`, `app_lock_partner_balance`, … | **200/204 — internal helpers callable** |
| service-role key | all of the above **past RLS**, plus inserting `admin_users` rows and changing QR state |

A token list defeats the product's access model: possession of a card's token is what lets someone start, or read, that card's greeting. GraphQL was not affected (`pg_graphql` is not enabled on the hosted project).

## The fix (migration 0020)

Four layers, each sufficient on its own. A final `DO` block aborts the whole migration, so nothing is committed, unless all four hold.

1. **Existing objects:** `REVOKE ALL` on every table and sequence in `public`, and on every application-owned function, from `anon`, `authenticated` and `service_role`.
2. **The schema:** `REVOKE USAGE ON SCHEMA public` from `anon`, `authenticated` **and `PUBLIC`**. Every role inherits through `PUBLIC`, so revoking from the two named roles alone would leave USAGE in place. This layer also covers objects created later by owners whose default privileges we cannot change (`supabase_admin`).
3. **Future objects:** `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL …` for tables, sequences and functions. Migrations run as `postgres`, which owns every application object.
4. **Policies:** all 67 policies in `public` become `TO app_runtime`. Even a privilege that comes back by accident then yields zero rows and zero writes.

**Unchanged:**
- `app_runtime`: explicit USAGE, table DML and EXECUTE on its helpers;
- `postgres` / `service_role` schema USAGE;
- the `auth`, `storage` and `graphql_public` schemas;
- the private `greeting-media` bucket and its signed-URL flow.

Nothing in the app or its scripts calls the Data API on `public`: supabase-js is used only for `auth.*` and `storage.*`.

## Verification

`npm run verify:data-api-lockdown` (runs in CI with every other `verify:*` suite) checks three things:
- **A, the catalog:** schema, table, column, sequence and function privileges, default privileges, policy roles, RLS enabled, and that `app_runtime` keeps its access.
- **B, the Data API**, attacked as anon, as a signed-in partner member and with the service-role key: list and lookup QR tokens, read greetings and content, delete/reset/inject rate-limit counters, forge audit/analytics/report rows, change QR state, insert admin rows, call `app_*` over RPC, and query GraphQL.
- **C, the app's own connection** (`app_runtime`): QR lookup, recipient content read, RLS still enforced, rate-limit upsert, helper functions.

`LOCKDOWN_READ_ONLY=1` runs A, plus anon and service-role reads and RPC, plus read-only C. It creates no fixtures and makes no writes, so it is the post-deploy check for the hosted project.

Local results:
- **Before** 0020, on a local Supabase whose grants were made identical to the hosted project's: 13 passed, 34 failed.
- **After:** 47/47 passed.

## Breaking changes

- Any future browser or server code that calls `supabase.from(<public table>)` or `.rpc(<public function>)` fails with `42501 permission denied for schema public`. This is intended: application data goes through `app_runtime` server-side.
- The service-role key can no longer read or write `public` through the REST API. Studio's table editor and SQL editor run as `postgres` and are unaffected.
- **New policies must say `TO app_runtime`.** A policy created without it defaults to `TO public`, and check A7 fails in CI.
- New tables and functions are no longer auto-granted to Data API roles. `app_runtime` still gets table DML through 0001's default privileges. A new function that `app_runtime` calls directly needs `GRANT EXECUTE … TO app_runtime`, as the existing helpers already have.
- Roles that only had `public` USAGE through `PUBLIC` lose it: `dashboard_user`, `authenticator`, `supabase_auth_admin`, `supabase_storage_admin`. None of them uses `public`:
  - Auth works in `auth`, Storage in `storage`.
  - Sign-in, signed upload, download, password reset and the partner storage-isolation checks all pass after 0020.
  - If a Supabase-managed component ever reports `permission denied for schema public`, see Recovery R1.

## Production deployment

This is a database-only change, and migrations are operator-run (Render's build doesn't migrate), so no app redeploy is needed. Keep the owner-review gate on throughout.

1. **Snapshot.** Supabase Free has no backups. Run from a machine with `pg_dump` 17:
   ```sh
   source ~/.qrapp-review/ops-env.sh
   mkdir -p -m 700 ~/.qrapp-review/backups
   pg_dump "$MIGRATIONS_DATABASE_URL" --schema=public --schema=drizzle -Fc -f ~/.qrapp-review/backups/pre-0020.dump
   psql "$MIGRATIONS_DATABASE_URL" -XAq -f scripts/ops/audit-data-api-grants.sql > ~/.qrapp-review/backups/pre-0020-grants.txt
   ```
2. **Migrate.** Use a checkout of this branch that has **no `.env.local`**, so nothing local can be picked up:
   ```sh
   source ~/.qrapp-review/ops-env.sh   # exports MIGRATIONS_DATABASE_URL for the hosted project
   node ./node_modules/.bin/tsx src/db/migrate.ts
   ```
   Expect `Migrations applied.` and a 21st row in `drizzle.__drizzle_migrations` (`created_at = 1792310400000`). If the fail-closed block raises, nothing was committed; read the message.
3. **Verify the lockdown, read-only.** Set all five variables explicitly for the hosted project: `MIGRATIONS_DATABASE_URL`, `DATABASE_URL` (app_runtime), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Then run:
   ```sh
   LOCKDOWN_READ_ONLY=1 node ./node_modules/.bin/tsx scripts/verify-data-api-lockdown.ts
   ```
   It must report 0 failed. Also run the curl count probe from the audit: every table must return 401 `permission denied for schema public`.
4. **Smoke test the live app** (with the gate credentials):
   - `/api/health` returns 200.
   - An ACTIVE demo card reveals its greeting.
   - An AVAILABLE card shows the start screen.
   - Admin and partner logins reach their dashboards.
   - Checkout still shows "payments open soon".
   - The webhooks `/TEST` and `/BOG` return 404.
5. **Second layer in Supabase settings (owner):** Settings → Data API → turn the Data API off, or at least remove `public` from *Exposed schemas*. Nothing in the app uses it. Re-run step 3.
6. Only then re-run the P0 public-launch audit. The gate decision is separate.

## Recovery

Work through these in order. Each step was rehearsed on the local replica.

- **R1. A Supabase component needs schema USAGE** (`permission denied for schema public` from Auth, Storage or Studio; not observed): `GRANT USAGE ON SCHEMA public TO <that role>;`. Layers 1, 3 and 4 still hold. Rehearsed by granting USAGE back to `PUBLIC`, `anon` and `authenticated`: 45/47 checks pass. Only the two USAGE checks fail; every HTTP attack is still refused.
- **R2. The app (app_runtime) gets `permission denied`** (not observed; check C covers it): grant the specific privilege to `app_runtime`, and add the missing grant as a new migration.
- **R3. Full rollback.** This **re-opens SEC-01**. Use it only with the gate on and the Data API disabled or `public` unexposed:
  ```sh
  psql "$MIGRATIONS_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/ops/rollback-0020-close-data-api.sql
  ```
  It restores the exact pre-0020 grant state and removes 0020's `drizzle.__drizzle_migrations` row, so `db:migrate` re-applies it after a fix. Rehearsed: rollback → grant audit equals the pre-migration replica → lockdown suite fails as before → re-apply → 47/47.
- **R4. Data damage** (not expected: 0020 changes no rows): restore the needed tables from `pre-0020.dump` with `pg_restore --data-only -t <table>`.

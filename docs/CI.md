# CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request.

## What it does, in order

1. Checks out the repo, sets up Node from `.nvmrc`, `npm ci`.
2. `npm run typecheck`, `npm run lint`.
3. `npm run build` — a production build compiles and type-checks the whole app but never opens a
   database connection, so it runs against dummy placeholder env values (not a live Supabase).
4. Installs the Supabase CLI and runs `supabase start` — a fresh, throwaway local Postgres/Auth/Storage
   stack on the runner, torn down (`supabase stop`) at the end of the job regardless of outcome.
5. Reads that fresh stack's own connection details via `supabase status -o json` and exports them as env
   vars for the remaining steps. These are freshly generated per run and discarded with the runner — never a
   real secret, and never a production credential. The one fixed value (the `app_runtime` role's local-dev
   password) is the same public, documented-as-local-only value already committed in
   `src/db/migrations/0001_rls_and_functions.sql` — see that file's own comment for why that's intentional.
6. `npm run db:migrate`, `npm run db:seed` against that throwaway stack.
7. Every `npm run verify:*` script (discovered from `package.json`, so a new one wired up later runs in CI
   automatically without a workflow edit) — the same real, non-mocked Postgres+RLS integration tests
   described in `README.md`.

## What it never does

- Never touches a production or staging database — the entire stack is created and destroyed within the job.
- Never deploys anything.
- Never uses a real secret — every credential in the job is either a CI-runner-local Supabase CLI output or
  the one already-public local-dev value noted above.

## Local dry-run

Every command this workflow runs (`supabase start`, `supabase status -o json`, `db:migrate`, `db:seed`, each
`verify:*` script) was exercised directly against a local Supabase instance while building this workflow — see
the implementation report for the actual output. The workflow YAML itself has been validated for syntax, but
an actual GitHub Actions run has not been triggered (this would require pushing, which was out of scope for
this change) — that first real run should be watched closely rather than assumed to succeed unattended.

# Staging Setup Runbook

Concrete, step-by-step instructions for standing up a **staging** environment
for the pilot — a real, hosted deployment that behaves like production but
processes zero real payments and zero real partner/customer data. Nothing in
this document has been executed; no staging infrastructure exists yet. This
is the procedure, not a confirmation that it's been run.

See `docs/ENVIRONMENT_MATRIX.md` for what every variable below means, and
`docs/PILOT_LAUNCH_CHECKLIST.md` §1–5 for the production-hardening checklist
this staging environment should also satisfy before it's trusted for a real
pilot dry run.

## 1. Create a dedicated Supabase project

1. Create a **new** Supabase project — never reuse the local dev project's
   credentials, and never reuse whatever becomes the eventual production
   project. Staging needs its own isolated database, Auth users, and Storage
   bucket so a mistake here can never touch real partner/customer data.
2. Name it clearly (e.g. `qr-starr-staging`) so it's never confused with
   production in the Supabase dashboard.
3. Record its project URL and keys (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) directly into
   the hosting platform's secret store in step 3 below — never into a local
   file, a chat message, or a commit.

## 2. Apply schema and RLS

1. From a machine with `MIGRATIONS_DATABASE_URL` pointed at the **staging**
   project's superuser connection string (never production's), run:
   ```
   npm run db:migrate
   ```
2. Confirm every migration applied (the script's own output lists each
   applied file; compare the count against `src/db/migrations/meta/_journal.json`).
3. Do **not** run `npm run db:seed` against staging using the same seed data
   meant for local dev if that seed data would be visible to pilot partners —
   review `src/db/seed.ts` first and decide whether staging needs its own,
   pilot-appropriate seed data or none at all.
4. Confirm RLS is doing its job on staging specifically — rerun the existing
   `verify:*` suite (all of it, including `verify:rate-limiting`) with
   `DATABASE_URL`/`MIGRATIONS_DATABASE_URL` pointed at staging instead of
   local dev. A pass on local dev does not by itself prove staging's Supabase
   project was provisioned identically (extensions, roles, and grants all
   come from the migrations, but it's still worth confirming for real before
   trusting the environment).

## 3. Configure the hosting platform

1. Deploy the Next.js app to whatever hosting platform is chosen (this
   codebase makes no platform-specific assumption — no `vercel.json`, no
   platform SDK is used anywhere in `src/`).
2. Set every variable from `docs/ENVIRONMENT_MATRIX.md` in that platform's
   environment configuration, scoped to the **staging** environment
   specifically (most platforms support per-environment variable scoping —
   confirm staging and any future production environment don't share a
   variable set).
3. Set `PAYMENTS_PROVIDER=TEST` explicitly for staging. This pilot's own
   constraints exclude real BOG payment processing — staging must not
   silently pick up `BOG` from a misconfigured default. Also set
   `ALLOW_TEST_PAYMENTS=true`: the TEST provider refuses every payment
   operation without that explicit opt-in. Leave
   `TEST_PAYMENTS_WEBHOOK_SECRET` unset unless a tool needs to play the
   provider (unset = the TEST webhook endpoint returns 404). See
   `docs/ENVIRONMENT_MATRIX.md`.
4. Set `NEXT_PUBLIC_APP_URL` to staging's real HTTPS origin (not
   `localhost`) — this feeds the password-reset email link
   (`supabase/config.toml`'s `additional_redirect_urls` on the Supabase side
   must also list this exact origin, or `exchangeCodeForSession` in
   `src/app/auth/confirm/route.ts` will reject the callback).
5. Confirm the platform serves the app over HTTPS — `Strict-Transport-Security`
   (`next.config.ts`) has no effect (and is actively misleading) served over
   plain HTTP.

## 4. Post-deploy verification (do this every time staging is redeployed)

1. `curl -I` the live staging origin and confirm all 6 headers from
   `next.config.ts`'s `securityHeaders` are present (see the header re-check
   already performed locally for shape/values to expect).
2. Manually walk the golden path once: scan/open a staging QR link → create a
   Greeting → simulate a TEST payment → confirm the recipient view renders.
3. Confirm `/auth/confirm` and the forgot-password flow work end-to-end
   against staging's real email delivery (Supabase's local dev inbox
   —`supabase status`'s Inbucket URL— does not exist on a hosted project;
   confirm what staging's actual email delivery path is before relying on
   password reset there).
4. Confirm the CI workflow (`.github/workflows/ci.yml`) is green on the
   commit actually deployed — CI validates the *code*, not the deployed
   *environment*, so this step and the ones above are both required, neither
   substitutes for the other.

## 5. What this runbook deliberately does not do

- It does not provision any real infrastructure as part of writing this
  document — every step above is something a human operator (or a future,
  explicitly-approved automation) still has to actually perform.
- It does not change `PAYMENTS_PROVIDER` away from `TEST` — real BOG
  payment processing stays out of scope for this pilot regardless of
  environment.
- It does not stand up a separate production environment — that's a later,
  separate decision with its own approval step, not an automatic next stage
  after staging.

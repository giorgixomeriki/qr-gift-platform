# Pilot Launch Checklist

Operational, checkable steps for taking QR Gift from "builds and passes
`verify:*` locally" to "first real Partner, first real paid transaction."
Check each box only once it is genuinely true in the target environment —
this document is meant to be read by whoever is actually doing the launch,
not filed away.

## 1. Production environment variables

Set in the hosting platform's environment configuration, never committed.
See `.env.example` for the authoritative list of names — this section
explains what each one means for a *production* deploy specifically.

- [ ] `NODE_ENV` — **do not set this yourself.** Next.js sets it based on
      the command (`next build`/`next start` → `production`). Setting it in
      an env file was the exact bug that broke `npm run build` in Phase 4.5
      — do not reintroduce it in `.env.local`, `.env.example`, or any
      platform "environment variables" UI that gets injected as a build-time
      `.env` file.
- [ ] `DATABASE_URL` — the restricted `app_runtime` Postgres role (never the
      Supabase superuser/`postgres` role) against the **production**
      Supabase project.
- [ ] `MIGRATIONS_DATABASE_URL` — superuser connection, used only by
      `npm run db:migrate` at deploy time. Not needed by the running app
      server itself — do not expose it to application runtime if the
      hosting platform lets you scope env vars per build-step vs. runtime.
- [ ] `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the
      production Supabase project's values.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — production service-role key. Treat as a
      full-database-bypass secret; it is never sent to the client
      (`lib/env.ts` is `server-only`) but confirm your hosting platform
      doesn't leak server env vars into client bundles or logs.
- [ ] `SUPABASE_STORAGE_BUCKET` — the production private bucket name (see §4).
- [ ] `EDIT_TOKEN_SECRET` — a fresh, real random value for production
      (`openssl rand -hex 32`), **not** the value from any `.env.local`.
- [ ] `NEXT_PUBLIC_APP_URL` — the real production domain, `https://…`, no
      trailing slash. This is baked into every printed QR code
      (`lib/qr/asset.ts`) and every payment return URL
      (`lib/payments/service.ts`'s `buildReturnUrls`) — get this right
      *before* printing any real cards, since QR codes already handed out
      encode whatever URL was set at generation time.
- [ ] `PAYMENTS_PROVIDER` — see §5. Never `TEST` in production;
      `provider-factory.ts` refuses to start with `TEST` when
      `NODE_ENV=production` regardless of this value.

## 2. Supabase production project

- [ ] A dedicated Supabase project for production, separate from the local
      dev project (`supabase start`) and from any staging project.
- [ ] Auth email settings configured for real delivery (not the local
      Mailpit/Inbucket dev inbox) — required for `resolveOrInviteUserByEmail`
      (`lib/auth/admin-users.ts`) to actually deliver invite emails to new
      Partner members.
- [ ] Auth redirect URLs allowlist includes the production
      `NEXT_PUBLIC_APP_URL` (e.g. `https://yourapp.com/partner/login`) —
      Supabase rejects auth redirects to URLs not on this list.

## 3. Production database migration procedure

- [ ] Run `npm run db:migrate` against the production
      `MIGRATIONS_DATABASE_URL` as a deliberate, reviewed deploy step — never
      automatically on every deploy without a human looking at what's about
      to run.
- [ ] Migrations in `src/db/migrations/` are forward-only (there is no
      `db:reset`/`db:rollback` script by design) — a bad migration is fixed
      by writing and applying a new forward migration, not by reverting.
- [ ] **Back up the production database before any migration that alters or
      drops a column/table** (Phase 5 §12). A Supabase project has
      point-in-time recovery / scheduled backups depending on plan — confirm
      this is actually enabled before the first migration, not after an
      incident.
- [ ] Run `npm run db:seed` once against production to populate
      `content_types`, `themes`, `products`, `prices`, and create the
      Storage bucket — this is idempotent-safe to re-run (it does not touch
      Partners/Orders/Greetings) but should still be a deliberate step, not
      part of routine deploys.

## 4. Private Storage bucket

- [ ] The `greeting-media` (or whatever `SUPABASE_STORAGE_BUCKET` is set to)
      bucket exists in the production project and is **private**, not
      public — confirm in the Supabase dashboard, don't just trust that
      `db:seed` created it correctly.
- [ ] Confirm signed URLs are actually time-limited in production (the app
      already only ever issues signed URLs, never permanent public ones —
      this is a spot-check, not a new control).

## 5. RLS deployment

- [ ] RLS is applied by the same migrations as the schema (`0001`, `0003`,
      etc.) — there is no separate "turn on RLS" step; confirm by running
      `npm run verify:phase1` through `verify:phase5` against production
      **before** any real Partner is onboarded (see §14, run these against
      a scratch/staging copy of production config, never against the live
      production database with live customer data — these scripts insert
      and delete real rows).
- [ ] Spot-check in the Supabase dashboard's SQL editor, connected as the
      `app_runtime` role (not the superuser), that an anonymous/cross-tenant
      query is actually rejected — a genuine live check, not just trusting
      the migration ran.

## 6. Domain, HTTPS, callback/webhook URLs

- [ ] Production domain configured with HTTPS (required — payment
      providers and Supabase Auth both expect it; also required for secure
      cookies, which are already enforced via `NODE_ENV === "production"`
      checks throughout `lib/auth/actions.ts`, `lib/security/edit-token.ts`,
      `lib/i18n/actions.ts`).
- [ ] The webhook endpoint `https://yourapp.com/api/webhooks/payments/<PROVIDER>`
      is reachable from the public internet (not behind auth, not behind a
      preview-deployment password wall) — a payment provider's servers call
      this directly, with no browser session.
- [ ] Register that exact webhook URL with the real payment provider once
      one is integrated (see §7 — this cannot be done yet for BOG, since the
      adapter is a placeholder).
- [ ] Confirm `NEXT_PUBLIC_APP_URL` (§1) matches the real domain exactly —
      mismatches here silently break payment return URLs and QR codes.

## 7. Production payment configuration — current status: NOT integrated

**Honest status as of Phase 5**: no real payment provider is integrated.
`PAYMENTS_PROVIDER=BOG` selects a placeholder adapter
(`lib/payments/providers/bog-provider.ts`) whose methods all throw
`ProviderNotImplementedError` — checkout, webhook verification, and refunds
will fail closed (clear error, never a fake success) if this is selected
without a real implementation behind it.

Before a real payment can be taken:

- [ ] Obtain official BOG (or chosen provider) merchant API documentation —
      not from this repo, from the provider directly.
- [ ] Obtain sandbox credentials and implement `BOGPaymentProvider`'s four
      methods against real, documented request/response shapes (see that
      file's doc comment for the exact list of what's needed).
- [ ] Obtain the provider's real webhook signature/authentication scheme
      and implement `handleWebhook` against it for real — this is the one
      piece that must never be guessed or approximated.
- [ ] Test the full flow against sandbox: checkout → redirect → sandbox
      payment → webhook → activation, end to end.
- [ ] Obtain production credentials separately from sandbox ones.
- [ ] Set `PAYMENTS_PROVIDER=BOG` (or the real chosen value) and the
      `BOG_*` env vars in production — `lib/env.ts` fails startup immediately
      and clearly if any are missing; it will never silently fall back to
      `TEST`.
- [ ] Run a real, small, genuine payment end to end in production before
      calling the pilot "live" (see §16).

## 8. Production database safety

- [ ] `npm run db:dev-bootstrap` **cannot** run with `NODE_ENV=production`
      (hard-coded guard in `src/db/dev-bootstrap.ts`, added in Phase 4.5) —
      confirm this by trying it against a scratch/staging environment with
      `NODE_ENV=production` set, not by reading the code alone.
- [ ] `PAYMENTS_PROVIDER=TEST` cannot run with `NODE_ENV=production`
      (`provider-factory.ts`) — same "confirm by trying it," not by reading.
- [ ] There is no "reset database" or "clear test fixtures" script that
      could accidentally be run against production — the `verify:*` scripts
      each create and clean up their own uniquely-named fixtures, but they
      connect via `MIGRATIONS_DATABASE_URL` and should simply never be
      pointed at a production database. Treat `MIGRATIONS_DATABASE_URL`
      pointing at production as a "handle like a loaded weapon" credential —
      restrict who has it.

## 9. Admin bootstrap procedure (first admin, no self-service path exists)

There is deliberately no "become an admin" flow reachable from the app —
`admin_users` membership can only be granted by inserting a row directly.
For the very first production admin:

- [ ] Create the person's Supabase Auth user in the production project
      (Supabase dashboard → Authentication → Add user, or have them sign up
      via `/admin/login`'s underlying auth flow if a password-reset/invite
      path is wired to it — confirm which before relying on it).
- [ ] Using the production `MIGRATIONS_DATABASE_URL` (superuser), run:
      `insert into admin_users (user_id) values ('<their-auth-uid>');`
- [ ] They can now sign in at `/admin/login` and see the Admin dashboard.
- [ ] Every subsequent admin can be added the same way, or (once at least
      one admin exists) there is still no in-app "promote to admin" UI in
      this phase — that remains a superuser-SQL operation by design, since
      admin is the highest-trust role in the system.

## 10. First real Partner

- [ ] An admin creates the Partner via `/admin/partners` (name, slug,
      commission rate, currency, default locale).
- [ ] Add the Partner's real owner by **email** (Phase 5 §13 —
      `MembershipManager`'s "Add member" now takes an email, not a raw
      Supabase UUID). If they don't have an account yet, this sends them a
      real invite email via Supabase Auth — confirm §2's email delivery
      setting is live before this step, or the invite silently goes nowhere.
- [ ] The Partner owner can log in at `/partner/login` and reach their
      dashboard.

## 11. First QR batch

- [ ] The Partner owner (or an admin on their behalf) creates a QR batch
      from the Partner dashboard / admin partner-detail page.
- [ ] Export the batch as CSV and/or open `/print/batch/<batchId>` to
      generate the print sheet.
- [ ] Confirm the print sheet renders in the Partner's own `defaultLocale`,
      not the admin's browser locale (existing, intentional behavior).

## 12. Physical print test

- [ ] Print an actual batch (not just preview on screen) at real card size
      on the actual printer/print shop that will be used for the pilot.
- [ ] Check quiet zone and contrast on the physical printout, not the
      on-screen SVG — toner/ink spread and paper stock can matter here even
      though the code already uses a 4-module quiet zone and "Q"
      error-correction (Phase 5 §14).

## 13. Real-phone scan test

- [ ] See `docs/MOBILE_QA_CHECKLIST.md` — run its full golden path on the
      **printed card from §12**, on real iPhone/Safari and Android/Chrome,
      before handing any cards to the pilot Partner.

## 14. Real payment test (once §7 is complete)

- [ ] With real (not sandbox) provider credentials configured, run one
      genuine small real-money transaction through the full flow: scan →
      create → checkout → pay → webhook confirms → Greeting activates →
      recipient views it.
- [ ] Confirm the webhook actually arrived and was processed (check
      `payments`/`orders` status in the DB, not just "the browser showed
      success" — Phase 5 §5's whole point is that the browser landing on a
      return URL is never proof by itself).
- [ ] If the webhook is delayed/lost, confirm `verifyAndReconcileOrder`
      (triggered automatically by the return-page's polling, or manually via
      an admin "reconcile" action) picks it up and activates correctly
      within a reasonable time.

## 15. Commission verification

- [ ] After the real payment in §14, confirm the Partner dashboard's
      unpaid-commission figure increased by the expected amount (gross ×
      commission rate, per that Partner's configured `commissionRateBps`).
- [ ] Record a real manual payout (Phase 5 §16) for that amount via the
      admin partner-detail page, with a real reference note describing how
      the money was actually sent to the Partner (this platform does not
      move money — see that section's own doc comment).
- [ ] Confirm the unpaid balance decreases by exactly the payout amount and
      the payout appears in that Partner's payout history.

## 16. Recipient test

- [ ] Have someone who is NOT the sender open the activated Greeting's QR
      and confirm the Recipient Experience (not the sender-preview view) —
      the sender-success banner should NOT appear for them.
- [ ] Confirm the sender, revisiting their own already-activated Greeting,
      still sees the small "your gift is live" banner and cannot re-edit it.

## 17. Monitoring / logging

- [ ] Confirm the hosting platform captures server logs (the webhook route
      and payment service log rejections/errors via `console.error` with no
      secrets/raw bodies — see `src/app/api/webhooks/payments/[provider]/route.ts`'s
      comments on safe logging).
- [ ] Set up an alert (even a simple one — a log-based alert, an uptime
      check) for repeated 5xx responses from the webhook route specifically,
      since a silently-broken webhook means payments stop activating
      Greetings without anyone noticing until a customer complains.
- [ ] Know where to look, before you need it: production Supabase project's
      own logs/dashboard, and the hosting platform's own request logs.

## 18. Rollback / contact plan

- [ ] Know how to roll back a bad deploy on the hosting platform (most
      platforms keep the previous build one click away — confirm this
      before launch day, not during an incident).
- [ ] Database migrations are forward-only (§3) — a rollback plan for a
      *migration* means "write a corrective forward migration," not
      "restore from backup," except in a genuine data-loss emergency, in
      which case the backup from §3 is what you restore from.
- [ ] Have a named person (not "the team") who is reachable if the pilot
      Partner reports a problem on launch day, and a fallback contact if
      that person is unreachable.
- [ ] Know the payment provider's own support/incident contact once one is
      integrated — you cannot debug their outage from this codebase alone.

## Summary: what's proven vs. what's still required

**Proven working** (5/5 production builds, 161/161 automated checks,
browser-verified consumer + admin flows): the entire non-payment-provider
architecture — QR lifecycle, sender/recipient experience, checkout
scaffolding with TEST provider, moderation, partner/admin dashboards,
manual payouts, email-based membership, localization.

**Still required before the first real paid transaction**: official BOG (or
chosen provider) documentation and credentials (§7), then implementing and
testing the placeholder adapter for real. Nothing else in this checklist is
blocked on external information — the rest is genuinely just doing the
listed operational steps.

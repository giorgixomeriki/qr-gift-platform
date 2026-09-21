# QR Gift Platform

Physical gift → QR code → paid digital greeting. See project memory / prior
phase reports for the full architecture; this file is local setup only.

## Requirements

- Node 22+ (`.nvmrc` pins this — the whole `@supabase/*` family requires it)
- Docker (for local Supabase)
- Supabase CLI (`brew install supabase/tap/supabase`)

## Setup

```bash
npm install
supabase start          # local Postgres/Auth/Storage — prints credentials
cp .env.example .env.local   # fill in from `supabase status`
npm run db:migrate      # applies src/db/migrations/*.sql in order
npm run db:seed         # content types, themes, products/prices, storage bucket
npm run db:dev-bootstrap  # LOCAL DEV ONLY: creates admin@dev.local / partner@dev.local
npm run dev
```

## Useful scripts

- `npm run typecheck` / `npm run lint`
- `npm run verify:commercial` — exercises the real payment service + RLS
  policies against the live DB (tenant isolation, idempotent payment
  confirmation, no-client-side-activation, etc). Safe to re-run; cleans up
  its own fixtures.
- `npm run verify:phase1` / `verify:phase2` / `verify:phase3` / `verify:phase4`
  — the same pattern, covering each phase's own security invariants (RLS
  tenant isolation, edit-token auth, checkout/payment integrity, moderation
  authorization). All five `verify:*` scripts load `.env.local` themselves
  (via `node --env-file`), so `npm run verify:phase4` etc. work standalone.
- `npm run db:generate` — regenerate a Drizzle migration after a schema change
- `npm run build && npm start` — production build and serve; see below.

## `npm run build` — known-good configuration

**Next.js 15.5.25 / React 19.2.8 / React DOM 19.2.8.** No framework or
dependency version change was needed to get a reliable production build —
the versions above are unchanged from before this was diagnosed.

### Resolved: the `<Html> should not be imported outside of pages/_document` build failure

An earlier phase's README documented this as believed to be an unresolved
upstream Next.js bug in the built-in `/404`/`/500` error-shell prerendering.
**That diagnosis was wrong.** A later, more rigorous isolation (bisecting the
entire app down to a 3-file `layout.tsx`/`page.tsx`/`not-found.tsx` skeleton,
and confirming a byte-identical skeleton built cleanly in a scratch directory
using this exact `package-lock.json`) proved it was not next-intl, not the
root layout, not middleware, not `next.config.ts`, not Tailwind/PostCSS, and
not the framework — it reproduced purely from this project's own directory,
regardless of how much application code was present or absent.

**Actual root cause:** `.env.local` (copied from `.env.example`, which had
the same line) hardcoded `NODE_ENV=development`. Next.js loads `.env.local`
for every command, including `next build` — which needs to run with
`NODE_ENV=production` to generate a correct production build. The hardcoded
value fought Next's own assignment, and the resulting inconsistent
dev/production hybrid state is what corrupted the internal `/404`/`/500`
shell generation (the `⚠ non-standard "NODE_ENV" value` warning printed on
every failing build was the actual root cause the whole time, sitting one
line above the misleading `<Html>` error that got chased instead).

**Fix:** removed the `NODE_ENV=` line from both `.env.local` and
`.env.example`. Never hardcode `NODE_ENV` in an env file again — Next.js sets
it itself based on which command is running (`dev` → development, `build`/
`start` → production), and `src/lib/env.ts`'s schema already defaults it to
`"development"` if genuinely unset, so nothing else needed to change. This
also closes a latent security gap: several production-only guarantees
(`secure` cookie flags, the TEST-payment-provider block) key off
`NODE_ENV === "production"`, so the old hardcoded override would have quietly
defeated them in a real deployment too, had a copy of this `.env.local` ever
reached one.

Verified: `npm run build` succeeded 5/5 consecutive times from a clean
`.next`, `npm start` boots and serves the production build correctly, and all
121 automated `verify:*`/`verify:commercial` checks plus typecheck/lint
remain green.

`next build --debug-prerender` is not needed anymore, but stays useful for
future diagnosis: it forces every page through non-optimized prerendering, so
compile-time errors are separated from real prerender errors instead of being
hidden by build caching.

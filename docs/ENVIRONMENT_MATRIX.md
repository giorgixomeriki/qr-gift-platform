# Environment Variable Matrix

Every environment variable the app reads, in one place. Source of truth for
what each one is, where it comes from, and whether it's a secret. No real
values appear in this document — see `.env.example` for placeholder names,
and `src/lib/env.ts` / `src/lib/env.public.ts` for the validated schema this
table must stay consistent with.

| Variable | Purpose | Secret? | Required? | Local (dev) | Staging | Production |
|---|---|---|---|---|---|---|
| `NODE_ENV` | Standard Next.js runtime mode switch. Gates production-only security headers (`next.config.ts`) and refuses `PAYMENTS_PROVIDER=TEST` when `production` (`provider-factory.ts`). | No | Yes (set by the platform/build, never hand-set) | `development` | `production` | `production` |
| `DATABASE_URL` | App runtime's Postgres connection, as the restricted `app_runtime` role RLS policies actually apply to. Never the Supabase superuser. | **Yes** | Yes | Local Supabase's fixed dev-only `app_runtime` password (see `migrations/0001_rls_and_functions.sql`'s own comment on why that one value is safe to be public) | A staging Supabase project's `app_runtime` password, freshly generated, secret-stored | Same shape, separate production project + separate secret |
| `MIGRATIONS_DATABASE_URL` | Superuser connection used only by `drizzle-kit`/`db:migrate` to run DDL (schema, RLS policies, role creation). Never imported by application runtime code. | **Yes** | Yes for running migrations; not needed by the running app itself | Local Supabase's default `postgres` superuser | Staging project's superuser connection string, secret-stored, used only from CI/an operator's machine — never baked into the deployed app | Same shape as staging, separate credential |
| `NEXT_PUBLIC_SUPABASE_URL` | Base URL the browser and server both use to reach Supabase Auth/Storage. Inlined into the client bundle — not a secret by nature. | No | Yes | `http://127.0.0.1:54321` | Staging Supabase project's public API URL | Production Supabase project's public API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key, subject to RLS on the Supabase side. Inlined into the client bundle by design — this is how Supabase's anon key is meant to be distributed. | No (public by design) | Yes | Local Supabase's demo anon key | Staging project's anon key | Production project's anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses Supabase RLS entirely — used exclusively server-side to issue signed Storage URLs after the app has already validated ownership in code. Never sent to the client. | **Yes — highest sensitivity secret in this table** | Yes | Local Supabase's demo service-role key | Staging project's service-role key, secret-stored, restricted to the deployment's server environment only | Production project's own separate service-role key |
| `SUPABASE_STORAGE_BUCKET` | Name of the Storage bucket holding uploaded greeting media. | No | Yes (has a default: `greeting-media`) | `greeting-media` | Same, or a staging-specific bucket name if staging and production share one Supabase org | Same |
| `EDIT_TOKEN_SECRET` | HMAC key used to hash the sender edit-token before it's stored (`lib/security/edit-token.ts`) — the plaintext token itself is never stored anywhere. | **Yes** | Yes (min 16 chars, `openssl rand -hex 32` recommended) | A fixed local-dev value | A freshly generated value, secret-stored, different from local | A separate freshly generated value, different from staging — rotating this invalidates every currently-open (unpaid) sender edit session, so treat rotation as a real (if low-impact) operational event |
| `NEXT_PUBLIC_APP_URL` | The app's own public origin — used for building absolute links (e.g. password-reset emails). Inlined into the client bundle. | No | Yes (has a default: `http://localhost:3000`) | `http://localhost:3000` | Staging's real HTTPS origin | Production's real HTTPS origin |
| `PAYMENTS_PROVIDER` | Selects `TEST` (simulated payments, the only provider actually implemented end-to-end) or `BOG` (placeholder adapter — methods not implemented; explicitly out of scope for this pilot per the engagement's own exclusions). | No | Yes (defaults to `TEST`) | `TEST` | `TEST` — **staging pilot explicitly does not process real payments** | `TEST` until a real BOG integration is separately built and approved — this document does not change that boundary |
| `BOG_CLIENT_ID` / `BOG_CLIENT_SECRET` / `BOG_API_BASE_URL` / `BOG_WEBHOOK_SIGNING_KEY` | Only read when `PAYMENTS_PROVIDER=BOG`; `env.ts` fails startup if any is missing in that case. | **Yes** (all four) | No — only required if `PAYMENTS_PROVIDER=BOG`, which is out of scope for this pilot | Unset | Unset (pilot stays on `TEST`) | Unset until a real BOG integration is separately built and approved |

## Notes

- **Secrets** must live in whatever secret store the hosting platform provides
  (e.g. a platform's encrypted environment variable store) — never in a
  committed file, never in `next.config.ts`, never logged (see
  `docs/OBSERVABILITY.md` for what `logServerError` is and is not allowed to
  capture).
- **Local vs. staging vs. production are three separate Supabase projects**
  with independently generated keys — this table assumes that separation
  going in, it does not create it. Reusing one project's credentials across
  environments would break the tenant/data isolation this whole matrix exists
  to protect.
- Every var in this table is enforced by the Zod schema in `src/lib/env.ts` /
  `src/lib/env.public.ts` — if the app starts, every "Required" var here was
  already present and well-formed by construction. A drift between this table
  and that schema means this table is stale, not the schema.

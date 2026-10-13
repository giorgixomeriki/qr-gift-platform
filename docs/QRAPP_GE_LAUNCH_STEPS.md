# qrapp.ge: launch steps, in order

The ordered sequence for putting QR Starr on `https://qrapp.ge`. The technical
detail behind each step is in `docs/PRODUCTION_DEPLOYMENT.md` (§ numbers below).
**Owner** steps need the account holder (billing, logins, secrets).
**Claude** steps can be done once the preceding approval is given. Every step
marked ⛔ is an approval gate.

Secrets rule: the owner types secrets directly into the Vercel / Supabase
dashboards (or `vercel env add`, which prompts without echoing). Secrets are
never pasted into chat, files or commits.

## Stage 1: accounts (no traffic, no DNS)

| # | Who | Step | Gate |
|---|---|---|---|
| 1 | Owner | Vercel → *Settings → Billing*: upgrade team `giorgis-projects-55ecfaf6` to **Pro** (about $20/month per seat; Hobby forbids commercial use) | ⛔ paid |
| 2 | Owner | Supabase → *New organization* `QR Starr` on **Pro** (about $25/month) → *New project* `qr-starr-production`, region **Central EU (Frankfurt)**, generate a strong DB password, save it in a password manager | ⛔ paid |
| 3 | Owner | Supabase → new **free** organization or project `qr-starr-staging`, Frankfurt (for previews) | free |
| 4 | Owner | Supabase production → *Database → Backups*: confirm daily backups are listed | — |

## Stage 2: databases (§2, §3)

| # | Who | Step | Gate |
|---|---|---|---|
| 5 | Claude, with the owner exporting connection strings in their own shell | **Staging:** migrate → seed → rotate `app_runtime` password → `ops:check-launch-pricing` → run all `verify:*` suites against staging | staging only |
| 6 | Claude, same | **Production:** migrate → seed → rotate `app_runtime` password → `ops:check-launch-pricing` (read-only). Never run `verify:*` against production. | ⛔ production DB mutation |
| 7 | Owner (dashboard), with Claude giving exact values | Auth settings on both projects: Site URL, redirect URLs, **sign-ups off**, password minimum 12, secure password change on (§3) | — |
| 8 | Owner | Storage: confirm `greeting-media` is **private** | — |
| 9 | Owner (SQL editor) | Insert the first admin: create the Auth user, then `insert into admin_users (user_id) values ('<uid>')` (`PILOT_LAUNCH_CHECKLIST.md` §9) | ⛔ production DB mutation |

## Stage 3: Vercel project and preview (§5)

| # | Who | Step | Gate |
|---|---|---|---|
| 10 | Claude | `vercel link` / import `giorgixomeriki/qr-gift-platform`, production branch `main`, Node 22.x, region fra1 (from `vercel.json`) | creates the project |
| 11 | Owner | Enter **Preview** env vars (staging values) and **Production** env vars (production values) from the §5 table. `PAYMENTS_PROVIDER=TEST`; `ALLOW_TEST_PAYMENTS` **unset** in Production. | secrets |
| 12 | Claude | Deploy a **preview**, then run the Phase 4 validation against staging: QR claim lifecycle, text/photo/video/voice, themes, recipient view, auth, partner dashboard, mobile, headers, `/api/health` | — |
| 13 | Claude | Production deployment on its `*.vercel.app` URL only (no domain yet) → smoke test. Checkout fails closed. | ⛔ production deploy |

## Stage 4: email and monitoring (§4, §6)

| # | Who | Step | Gate |
|---|---|---|---|
| 14 | Owner | Resend account (free tier) → add domain `qrapp.ge` → it shows SPF/DKIM records | free |
| 15 | Owner at Domenebi.ge, with Claude checking the values | Add those email DNS records and `_dmarc.qrapp.ge` | ⛔ DNS |
| 16 | Owner | Supabase production → Auth → SMTP: Resend host/user/password, sender `no-reply@qrapp.ge`; raise the email rate limit to about 30/hour | secrets |
| 17 | Owner | Free uptime monitor on `https://qrapp.ge/api/health` (after Stage 5) with alerts to the owner's email or phone | free |

## Stage 5: domain (§7)

| # | Who | Step | Gate |
|---|---|---|---|
| 18 | Claude | `vercel domains add qrapp.ge` + `www.qrapp.ge` (www → 308 to apex) and `vercel domains inspect` → the **exact** records | no DNS change yet |
| 19 | Owner at Domenebi.ge | A day before: lower the TTL on existing `@`/`www` records to 300 | ⛔ DNS |
| 20 | Owner at Domenebi.ge | Cutover: remove parking records on `@`/`www`, add Vercel's records. If a CAA record exists, it must allow `letsencrypt.org`. | ⛔ DNS cutover |
| 21 | Claude | Verify DNS (`dig`), certificate, HTTPS redirect, security headers, `/api/health`, auth emails linking to `https://qrapp.ge`; update the Supabase Site URL if it was temporary | — |

## Stage 6: opening

| # | Who | Step | Gate |
|---|---|---|---|
| 22 | Owner | Legal pages live on qrapp.ge (terms, privacy, refund policy, company details), which BOG also requires | — |
| 23 | Owner + Claude | First partner, first QR batch, physical print test, real-phone scans (`PILOT_LAUNCH_CHECKLIST.md` §10–13) | ⛔ public traffic |
| 24 | — | **Checkout stays disabled** until the BOG integration is built, tested and approved (`docs/integration/BOG_PAYMENT_MANAGER_PLAN.md`) | ⛔ live payments |

## Rollback at any stage

See `docs/PRODUCTION_DEPLOYMENT.md` §9. In short:
- **App:** promote the previous Vercel deployment.
- **Domain:** restore the previous Domenebi.ge records.
- **Database:** migrations are forward-only, so fix them with a new migration. Restore a backup only in a genuine data-loss emergency.

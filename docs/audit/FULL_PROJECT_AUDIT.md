# QRAPP.GE: full project audit

Date: 2026-10-15 · Scope: every branch, worktree, PR and uncommitted change of
`giorgixomeriki/qr-gift-platform` · Method: code reading plus executed checks.
Any line marked *(estimate)* is a judgement, not a measurement.

Evidence logs for every run cited here are in the worktree
`/Users/Shared/qr-gift-platform-bog-r1/tmp/audit/` (local only, not committed).

## 1. Repository state

| Item | State | Evidence |
|---|---|---|
| `main` | `56fc76c` (PR #3 merged), CI green | `gh pr checks`, `git log` |
| PR #4 `docs/launch-setup-and-bog-plan` | Draft, docs only, CI green | BOG plan, merchant requirements, launch steps |
| PR #5 `feature/partner-pricing` | Draft, CI green, mergeable, **0 reviews** | `a1a89c3`; migration `0018_partner_pricing_controls` |
| PR #6 `feat/bog-payment-manager-r1` | **New (this audit)**, draft, stacked on #5 | BOG adapter R1, see §4 |
| `prep/preview-test-payments` | Local only, `b6ef428`, on `6436d3f` | Changes the payment guard and is waiting for approval |
| `integration/signature-experience-v1` | Local, `dc53286` (blueprint), plus **uncommitted Phase 1 sender UI** in its worktree | Preserved as `integration/signature-phase1-wip` `84b364c` (local) |
| `design/v2-*` | Local, prototype under `/lab/*` (dev-only) | Approved direction; not production code |
| Main worktree `/Users/Shared/qr-gift-platform` | On `feat/bog-payment-manager` (= `main`) with **uncommitted BOG R1 work** | Preserved unchanged and finished as PR #6 |
| Other worktrees | `-p1-base` and `-phone` are detached at `9a09b01`, clean | Phone-tunnel and baseline tooling |
| `/Users/G's m/Desktop/QR` | Stale Next 16 scaffold, never committed | Not the product |

Branches `payment-hardening`, `pilot-readiness`, `ui/*`, `mobile/excellence` and
`release/production-prep` are fully contained in `main` (historical).

TODO/FIXME/HACK markers in `src`, `scripts`, `e2e` and `supabase`: **none**.

## 2. Architecture

Next.js 15.5.27 (App Router, React 19), Drizzle on Postgres (Supabase), Supabase Auth
and Storage, and next-intl (ka default, en). There are no background workers, so
every job is a request or a script.

| Module | Assessment |
|---|---|
| Data layer (`src/db`) | 20 forward-only SQL migrations (18 on `main`). RLS on **every** table (verified: every `create table` has a matching `enable row level security`). The app runs as the restricted `app_runtime` role, scoped by `with*Context` helpers that set `app.*` GUCs. Order snapshots are immutable by trigger (0013). |
| Payments (`src/lib/payments`) | The service depends only on the provider interface. There is one path to PAID (`confirmPaymentSuccess` → `settleConfirmedPayment`), with idempotency at three layers, an amount and currency check against the snapshot, and a refund queue with an anomaly report. Strong. |
| Pricing | Price is data (`prices` rows) and commission is a per-partner rate in bps. The split is floor-to-partner, with the remainder to the platform. Checkout resolves server-side and snapshots onto the order. |
| Greetings, QR, themes | The template engine defines themes as data plus an authored composition (`verify:templates`). Lifecycle: AVAILABLE → DRAFT → ACTIVE (BLOCKED via moderation). Edit tokens are HMAC-hashed. |
| Auth | Supabase Auth for partners and admins. `admin_users` = Super Admin (no tiers). Partner roles: OWNER, ADMIN, STAFF, VIEWER. |
| Observability | Structured JSON logs (`lib/log.ts`) and `/api/health`. No paid error tracking (deliberate, `docs/OBSERVABILITY.md`). |

## 3. Business-logic audit

Flow: partner inventory → customer scans → greeting → preview → pay → activate →
recipient → commission → payout.

| # | Area | Finding | Evidence | Severity |
|---|---|---|---|---|
| B-1 | QR claim and activation | Correct, and tested for concurrency and duplicates. A paid greeting activates exactly once, and a duplicate or late success is refunded. | `verify:payment-integrity` 45/45, `verify:pilot-protections` 39/39 | — |
| B-2 | Partner attribution | A QR's partner is fixed at batch creation and copied onto the order. Cross-partner attribution is refused at the DB level (0013). | `verify:partner-attribution` 59/59 | — |
| B-3 | Duplicate scans and replay | Covered by an open-order uniqueness constraint (0016), the payment upsert key, and a unique `COMMISSION_EARNED` per order. | phase5 41/41, payment-integrity | — |
| B-4 | Text, image, video and voice | Magic-byte upload verification and transactional media replacement. | `verify:media-replacement` 27/27, phase2 | — |
| B-5 | Pricing defaults | The seed produces **10.00 GEL** with a 30% partner share (300 / 700). | `ops:check-launch-pricing` | — |
| B-6 | Pending orders after a price change | An open PENDING order keeps its old snapshot price on re-entry (decision D2, unresolved). | `checkout.ts` re-entry path | P2 (decision) |
| B-7 | Refunds | `main`: synchronous only, and the BOG adapter was a stub, so refunds are a manual queue. PR #6 adds two-phase refunds that reverse the **order's own historical** commission snapshot exactly once. | `verify:bog-integration` 9a–9g, 11c | — |
| B-8 | Chargebacks | **Not implemented.** BOG has no dispute API. The `CHARGEBACK` reason exists in the schema only, and the admin "record chargeback" action is unbuilt (decision B5). | `refunds.ts` `RefundReason` excludes it | P1 before volume, not before the first sale |
| B-9 | Payout eligibility | A commission is payable once its business-day period has closed (Tbilisi). A refund after payout is netted as a CLAWBACK. **There is no holding period for the chargeback window** (decision). | `payouts.ts`, `verify:payout-items` 49/49 | P2 (decision) |
| B-10 | Refund after admin removal | Completing an async ADMIN refund books the reversal "as" the requesting admin (RLS). If that admin is removed from `admin_users` before BOG confirms, completion fails until someone reruns it. | `refunds.ts completeRefund` | P3 |
| B-11 | Unknown BOG order in a callback | The adapter answers 400 (the receipt lookup fails), while the plan §3.5 said 200 plus an anomaly. BOG may retry. Behaviour needs confirming with BOG (B7). | `webhook.ts` | P3 |
| B-12 | Localization | ka and en parity is complete: 514 keys, no missing keys, placeholders consistent. | parity script in this audit | — |
| B-13 | Partner self-commission | `partners_update` RLS lets a partner OWNER or ADMIN update its own row. No app path exposes `commission_rate_bps` (only the admin action calls `updatePartner`), so it is not exploitable today. PR #5's trigger closes it at the DB level. | `0001` policy, `partners/actions.ts:58`, `verify:partner-pricing` 6e | P2 (defence in depth) |

## 4. Payments: BOG integration status

| Component | `main` | PR #6 | Needs BOG |
|---|---|---|---|
| OAuth token, cache, single flight, 401 re-auth | stub | ✅ | token lifetime (B13) |
| Order creation from the order snapshot, Idempotency-Key, redirect-host allowlist | stub | ✅ | redirect hosts (B9), methods (B10) |
| Receipt lookup and status mapping | stub | ✅ | — |
| Callback SHA256withRSA over the raw body, fail-closed | stub | ✅ (base64 assumed) | **encoding and a signed sample (B6)** |
| Callback content never trusted (state re-read from the receipt) | — | ✅ test 5a | — |
| Two-phase async refunds, `payment_refunds`, deterministic keys | — | ✅ | key retention (B12) |
| Reconciliation (return page, CLI, scheduled endpoint) | CLI | ✅ + `/api/cron/payments-reconcile` | schedule = owner (Hobby is daily-only) |
| Kill switches `CHECKOUT_ENABLED`, `BOG_REFUNDS_ENABLED` | — | ✅ default off | — |
| Chargebacks | — | ❌ | channel and deadlines (C-terms) |
| Settlement-statement matching | — | ❌ | report format |
| Tested against BOG itself | — | ❌ (simulator only) | **credentials, test env (B1–B3)** |

### Defects found and fixed in this audit (PR #6)

1. **`tsc` failed** on the uncommitted BOG work (`verify-bog-adapter.ts:272`, TS2339, a
   temporal-dead-zone shadowing bug). CI would have failed.
2. **`verify:bog-integration` was registered but missing**, so CI's `verify:*` loop
   would have failed. The suite is now written: 36 checks.
3. **A rejected BOG refund was ignored by its callback.** The webhook only looked at refunds
   when the receipt reported a refund state, but a rejected refund leaves the charge
   `completed`. The refund then stayed REQUESTED until the hourly sweep. Fixed: the regression
   check 10a/10b failed before the fix and passes after it.
4. **Closed checkout looked like an outage.** `CheckoutUnavailableError` surfaced as
   "Something went wrong… try again" and was logged as an error. It now shows a ka/en
   "payments open soon" notice.
5. **Migration number collision.** The BOG work and PR #5 both used `0018`. Drizzle orders
   migrations by `when`, so a DB that applied the BOG one first would **silently skip**
   partner pricing. BOG's migration was renumbered to `0019` and stacked on #5.
   The shared local dev DB (`postgres`) has already applied the BOG SQL under the 0018 tag,
   so recreate it before using it with #5 or #6.

## 5. Security findings

| # | Finding | Status | Severity |
|---|---|---|---|
| S-1 | RLS enabled on all tables; restricted runtime role; service-role key used only server-side for Storage signing and auth admin | Verified (code, phase1–5 suites) | — |
| S-2 | Security headers: CSP with nonce, HSTS (2 y), `X-Frame-Options: DENY`, nosniff, `Referrer-Policy`, `Permissions-Policy` | Verified (`next.config.ts`, middleware) | — |
| S-3 | Uploads checked by magic bytes against declared MIME, size limits, private bucket with signed URLs | Verified in code. **Bucket privacy on hosted Supabase still to confirm (owner)** | — |
| S-4 | `dangerouslySetInnerHTML` used only for the server-generated QR SVG on the admin print sheet (no user input) | Verified | — |
| S-5 | Rate limiting in the DB (`0009`): greeting start, media upload, checkout, auth confirm, member invite, QR batch, refunds, payouts; #6 adds the webhook limit | Verified (`verify:rate-limiting` 8/8) | — |
| S-6 | Webhook authentication: TEST uses HMAC (dev only, 404 in production); BOG uses RSA. Raw body is verified before parsing | Verified (phase5, bog-adapter 7a/7b, bog-integration 4a/4b) | — |
| S-7 | Env fail-closed: production refuses TEST; BOG refuses a non-bog.ge or http URL on Vercel, and a non-RSA key | Verified (`verify:env-guards` 21/21, phase5 15–17) | — |
| S-8 | Secrets: none in tracked files (grep for private keys, JWTs, live keys) | Verified | — |
| S-9 | Partner self-commission via RLS (see B-13) | Fixed in #5 | P2 |
| S-10 | No IP allowlist for BOG callbacks (BOG hasn't published ranges) | Open (B7) | P3 |
| S-11 | Monitoring: only logs and uptime. No alert routing exists until the owner sets up an uptime monitor | Open | P1 (ops) |
| S-12 | Backups and DR: documented (`DISASTER_RECOVERY.md`) but depend on Supabase Pro (not yet created). PITR is not configured | Open (owner) | P1 (ops) |

No critical or high code vulnerabilities were found in this audit. That doesn't exclude
issues in areas no executed test covers, and no third-party penetration test has been done.

## 6. UI/UX findings

| # | Finding | Severity |
|---|---|---|
| U-1 | Production UI on `main` = mobile/excellence (approved worlds, Screen #1 frozen). E2E: 93 passed, 3 skipped by design. Mobile is browser-emulated only, with **no physical-device pass recorded** | P1 (needs a person) |
| U-2 | Signature Experience: the design is approved (hybrid). Production integration is **Phase 1 WIP, uncommitted, unreviewed**. Its flag `SIGNATURE_UI` **defaults ON**, so merging it would switch the live UI. Phases 2 (recipient), 3 (checkout) and 4 (RC) aren't started. It passes `tsc` and lint; its E2E and QA scripts weren't run in this audit | P2 (not a launch blocker; the current UI is launchable) |
| U-3 | Signature prototype perf: throttled interactivity was +59–256 ms vs baseline, as recorded by the design pass | P2 |
| U-4 | Closed-checkout state now designed (ka/en) in #6. Not covered by an E2E (it needs a BOG-mode dev server) | P3 |

## 7. Database findings

| # | Finding | Severity |
|---|---|---|
| D-1 | All 20 migrations (main + #5 + #6) apply cleanly to an empty database, and seed plus the launch-pricing check pass | — |
| D-2 | Migrations are forward-only, with no down scripts. Rollback = restore or forward-fix (`DISASTER_RECOVERY.md`). #5 and #6 add constraints, triggers and a table, but no destructive change | P3 |
| D-3 | Migration ordering trap (§4 item 5) | Fixed by stacking; **merge #5 before #6** |
| D-4 | Drizzle snapshots exist only for 0000–0005 and 0007, so `db:generate` diffs aren't trustworthy. SQL is hand-written | P3 |

## 8. Technical debt

- `verify:*` suites are scripts, not a test runner. There's no per-test isolation, and
  fixtures accumulate in the DB (fine for a throwaway CI DB).
- The `e2e/partner-privacy` fixture joins `auth.users`, so it only runs against Supabase's own DB.
- `env` is loaded once at import. Toggling flags needs a redeploy (documented in the BOG plan's rollback section).
- Local worktree sprawl: 9 worktrees. Clean up once the PRs settle.

## 9. Test execution (2026-10-15, branch `feat/bog-payment-manager-r1`, which contains main + #5)

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ |
| `eslint` | ✅ |
| `next build` (CI-equivalent placeholders) | ✅ |
| `db:migrate` (20) + `db:seed` on a fresh DB | ✅ |
| `ops:check-launch-pricing` | ✅ 1000 GEL, 300 / 700 |
| 23 `verify:*` suites | ✅ all, 0 failures. commercial 19, phase1 26, phase2 24, phase3 30, phase4 22, phase5 41, password-reset 8, payout-concurrency 7, admin-pagination 4, rate-limiting 8, analytics-funnel 10, pilot-protections 39, partner-privacy 16, partner-attribution 59, payout-items 49, business-calendar 32, templates ✅, payment-integrity 45, partner-pricing 70, media-replacement 27, bog-adapter 56, bog-integration 36, env-guards 21 |
| Playwright E2E (desktop Chromium + Pixel 7 emulation) | 89 ✅, 3 skipped by design, 4 ✗ **environmental** (fixture needs `auth.users`, which is absent in the throwaway DB). Rerun on the Supabase DB: 4/4 ✅ |
| Signature WIP snapshot | `tsc` ✅, `eslint` ✅. E2E and QA **not run** |
| Real devices, real BOG, hosted infra | **Not executed** (no access, by design) |

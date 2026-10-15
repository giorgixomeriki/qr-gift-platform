# QRAPP.GE: launch readiness report

Date: 2026-10-15 · Basis: `FULL_PROJECT_AUDIT.md` (same folder) and the test runs listed there.

## Verdict: **NO-GO for a paid public launch today. CONDITIONAL GO for the next step.**

The software is in good shape, but there is nothing to launch *onto* yet:

- no production Vercel project
- no production Supabase project
- no DNS
- no BOG merchant account or credentials
- no legal pages

Real-money checkout can't be opened until BOG confirms the facts the adapter assumes
and one real payment and refund has been verified.

**Conditional GO** to proceed, in this order:

1. Review and merge PR #5, then #6.
2. Create staging and production infrastructure (owner, paid).
3. Run a TEST-mode, checkout-closed soft launch on qrapp.ge.

That soft launch has partners, cards, creation and preview, with checkout showing "payments open soon".
Opening paid checkout is a separate GO decision after PAY-3…PAY-6.

## Readiness by module (estimates, scored against fixed criteria)

Scoring:

| Score | Meaning |
|---|---|
| **100** | Built + automated tests green + verified on hosted staging/production + owner-approved |
| **75** | Built + automated tests green locally and in CI, not yet verified hosted |
| **50** | Built, but an external dependency is unverified or tests are partial |
| **25** | Plan or prototype only |
| **0** | Absent |

In-between values interpolate. **All scores are estimates.**

| Module | Score | Evidence | What moves it up |
|---|---|---|---|
| QR lifecycle (claim, activation, block) | 75 | phase1–4, pilot-protections 39/39, E2E greeting flow | Hosted staging run, real scans |
| Greeting creation (text, photo, video, voice) | 75 | media-replacement 27/27, phase2, E2E | Real-device pass (UX-1) |
| Themes and recipient reveal | 75 | templates ✅, 6 finales E2E | Real-device pass |
| Mobile UX | 65 | E2E at 320 px + Pixel 7 emulation; no physical devices | UX-1 |
| Localization ka/en | 80 | 514 keys, full parity, E2E locale switch | Native-speaker review of new strings (#6) |
| Partner dashboard and privacy | 75 | partner-privacy 16/16 + E2E 4/4, partner-attribution 59/59 | Hosted run |
| Super Admin and pricing controls | 70 | partner-pricing 70/70 (PR #5, unreviewed) | Review + merge |
| Pricing and commission (10 / 3 / 7) | 75 | launch-pricing check, split tests, immutable snapshot | Real transaction (PAY-6) |
| Payment domain (idempotency, refunds, reconciliation) | 75 | payment-integrity 45/45, phase5 41/41 | — |
| BOG integration | 45 | Adapter + async refunds + kill switch built; simulator-tested (56 + 36); **never called BOG** | PAY-3…PAY-6 |
| Chargebacks and settlement | 15 | Schema reason only | PAY-8, PAY-9 |
| Payouts | 75 | payout-items 49/49, payout-concurrency 7/7, business-calendar 32/32 | Holding-period decision (H1) |
| Security | 75 | RLS everywhere, headers + CSP, env fail-closed, phase1–5, rate limiting | Hosted config checks; external pentest optional |
| Signature Experience | 25 | Approved prototype; Phase 1 WIP (unreviewed) | Owner decision (after launch is recommended) |
| Infrastructure (Vercel, Supabase, DNS) | 10 | Docs, `vercel.json`, `/api/health`, env guards; **no resources exist** | INF-1…INF-7 |
| Monitoring, backups, DR | 30 | Structured logs, health endpoint, DR doc | INF-8, INF-9 |
| Legal and compliance pages | 0 | — | OPS-6 |

## Completed in this audit

| Work | Where |
|---|---|
| Preserved the uncommitted BOG R1 work (an exact copy; the original tree is untouched) and finished it | PR #6, branch `feat/bog-payment-manager-r1` |
| Fixed the `tsc` failure in `verify-bog-adapter` (CI blocker) | PR #6 `0bb33a5` |
| Wrote the missing `verify:bog-integration` suite (36 DB-backed checks against a BOG simulator; CI blocker) | PR #6 `a1a3a11` |
| Fixed a rejected BOG refund being ignored by its callback (found by the new suite) | PR #6 `a1a3a11` |
| Resolved the migration 0018 collision (BOG → 0019, stacked on #5), which would have silently skipped partner pricing | PR #6 |
| "Payments open soon" state for the closed checkout (ka/en) | PR #6 `7ba3738` |
| Scheduled reconciliation endpoint `/api/cron/payments-reconcile` (+3 tests) | PR #6 `a881dd7` |
| Env and payments docs updated for BOG | PR #6 |
| Preserved the uncommitted Signature Phase 1 WIP as a local branch (unreviewed, not pushed); verified it passes tsc and lint | `integration/signature-phase1-wip` `84b364c` |
| The four audit documents | this branch, `docs/full-project-audit` |

## Outstanding blockers

**Before a checkout-closed soft launch:**

- merge #5 and #6
- INF-1…INF-5 and INF-7
- OPS-6
- staging validation
- UX-1

**Before paid checkout:**

- PAY-3 (BOG facts)
- PAY-4 (merchant account)
- PAY-5 (test environment, if any)
- PAY-6 (one real payment and refund)
- PAY-10 (reconcile schedule)
- INF-8 (alerts)
- INF-9 (backups confirmed)

## Test results

All executed locally on 2026-10-15 against branch `feat/bog-payment-manager-r1` (main + #5 + #6),
on a freshly migrated throwaway database:

| Check | Result |
|---|---|
| `tsc` | ✅ |
| `eslint` | ✅ |
| CI-equivalent `next build` | ✅ |
| Migrations (all 20) and seed | ✅ |
| Launch-pricing check | ✅ |
| `verify:*` suites | **23/23 ✅**, 0 failed checks |
| Playwright | **93 passed, 0 failed, 3 skipped by design.** 4 failed on the throwaway DB for an environmental reason (`auth.users` absent) and passed 4/4 when rerun on the Supabase DB |

CI (GitHub Actions, fresh Supabase, all `verify:*`): PR #5 green; PR #6 green (4 m 8 s).

**Not executed:**

- real devices
- BOG itself
- hosted staging or production
- load testing
- Signature E2E and QA
- external penetration test

## Production deployment requirements

Follow `docs/QRAPP_GE_LAUNCH_STEPS.md` (PR #4) and `docs/PRODUCTION_DEPLOYMENT.md`.

| Area | Requirement |
|---|---|
| Plans | Vercel **Pro** and Supabase **Pro** (Frankfurt) |
| Payments env | Production `PAYMENTS_PROVIDER=TEST` with `ALLOW_TEST_PAYMENTS` unset (TEST is refused in production, so checkout fails closed) **or** `BOG` with `CHECKOUT_ENABLED=false` |
| Migrations | Merge #5 **before** #6. Never run `verify:*` against production |
| Housekeeping | Recreate the shared local dev DB before testing #5/#6 locally (HK-2) |

## Payment integration status

The adapter is complete against BOG's **public** documentation and fails closed everywhere:

- unsigned, forged or re-serialised callbacks are rejected;
- the callback body is never trusted;
- amounts come only from the order snapshot;
- retries reuse the Idempotency-Key;
- a refund reverses commission only when BOG confirms it.

It has **never talked to BOG**. Unconfirmed assumptions:

- base64 signature encoding;
- `payment.bog.ge` as the only redirect host;
- deterministic UUID-v4 idempotency keys accepted;
- token lifetime.

Not built:

- chargebacks;
- settlement-statement matching.

## Business decisions requiring approval

See `UNFINISHED_WORK_REGISTER.md` → "Open business decisions". The ones that block or shape launch:

| Decision | Topic |
|---|---|
| SIG | Signature at launch or after? |
| B1, B2 | Payment methods and order TTL |
| B5, B6 | Chargebacks; refunds after payout |
| B7 | VAT and fees |
| H1 | Commission holding period |
| CRON | Reconcile frequency (determines Vercel Pro need) |
| PP-a…e | Partner-pricing policies (PR #5) |

---

## Update 2026-10-16

| Item | Result |
|---|---|
| Independent review of #5 | No blockers. Review posted on the PR |
| Independent review of #6 | **1 finding fixed** (`05d2d66`): a refund already with BOG was still listed for a manual refund, a double-refund risk. Regression checks 15b/16b fail without the fix. Review posted on the PR |
| Merging #5 / #6 | **Not done.** The merge was blocked by the session's permission policy (no human review yet). It is left to the owner. CI is green on both |
| Original uncommitted BOG work vs #6 | Every file is identical, or differs only in the `0018`→`0019` references. Every added line is present. The original is kept untouched |
| Shared local dev DB | Diagnosed read-only: `0018_partner_pricing_controls` will be silently skipped. A non-destructive repair was **rehearsed on a copy** (schema identical to a fresh migrate; suites green). **Not applied**; it awaits approval (`docs/ops/SHARED_DEV_DB_REPAIR.md`, #6) |
| PAY-8 Chargebacks | **Built** (#9): admin recording, booked as a refund, reversal once, CLAWBACK after payout, evidence pack. `verify:chargebacks` 22/22, E2E 2/2. Implements recommended B5/B6, pending confirmation |
| PAY-10 Reconcile schedule | **Built** (#9): daily `vercel.json` cron (Hobby limit), inert until env is set |
| Ops safeguard | **Built** (#9): read-only `ops:preflight`, which catches skipped migrations, unsafe env combinations, missing admins and a public bucket. 13/13 |
| OPS-6 Legal pages | **Drafts** (ka/en) for owner and lawyer review (#8). Not published |
| Test totals (branch #9 = main + #5 + #6 + #9, fresh DB) | 25/25 `verify:*` suites pass. Build, tsc and lint pass. E2E: 91 passed, 4 flaked, all passed on rerun |

Readiness scores that changed *(estimates)*:

| Area | Before | Now |
|---|---|---|
| Chargebacks and settlement | 15 | 45 (chargebacks built; settlement matching not) |
| Monitoring | 30 | 40 |
| Legal | 0 | 15 (drafts only) |

The verdict is unchanged: **NO-GO for paid checkout; CONDITIONAL GO for a soft launch with checkout closed** once #5, #6 and #9 are merged and the infrastructure exists.

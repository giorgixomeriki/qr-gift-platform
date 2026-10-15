# Unfinished work register

Date: 2026-10-15. Priorities: **P0** blocks the first real sale · **P1** needed before the public
opening or before volume · **P2** should do soon · **P3** later.
Effort figures are *(estimates)* of engineering time only, excluding waiting on BOG or the owner.
"Claude alone?" means the item can be finished without credentials, money, DNS or an owner decision.

## Payments and finance

| ID | Item | Status | P | Depends on | Effort | Next action | Claude alone? |
|---|---|---|---|---|---|---|---|
| PAY-1 | Partner pricing (Super Admin price and commission per partner, migration 0018) | Built, 70/70, CI green, PR #5 draft, **0 reviews** | P0 | Owner review; decisions PP-a…e below | 0.5 d for review fixes | Owner reviews #5 → merge **before** #6 | No (approval) |
| PAY-2 | BOG adapter R1 (token, orders, receipt, RSA callback, async refunds, kill switches) | Built and simulator-tested (bog-adapter 56, bog-integration 36). PR #6 draft, stacked on #5 | P0 | PAY-1 merged; review | 0.5–1 d for review fixes | Review #6 after #5 | No (approval) |
| PAY-3 | Confirm BOG facts: signature encoding + signed sample (B6), redirect hosts (B9), idempotency retention (B12), token lifetime (B13), callback retries and IPs (B7) | Assumptions are marked in code and the plan | P0 | BOG | 0.5 d of adapter changes after the answers | Owner sends `BOG_MERCHANT_REQUIREMENTS.md` §B to BOG | No (BOG) |
| PAY-4 | BOG merchant agreement, production credentials, terminal activation | Not started (external) | P0 | Owner + BOG; legal pages (OPS-6) | — | Owner applies | No |
| PAY-5 | End-to-end test against BOG's test environment, if one exists (R2) | Blocked | P0 | PAY-3, PAY-4 (test creds) | 1 d | Run plan §4.5 on a preview + staging | After creds |
| PAY-6 | Production smoke test: one real 10 GEL payment + refund (R4) | Blocked | P0 | PAY-4, INF-1…4 | 0.5 d | Plan §4.6 | No (owner pays) |
| PAY-7 | Open checkout: `CHECKOUT_ENABLED=true` (R5) | Blocked | P0 | PAY-6 | minutes | Owner approval | No |
| PAY-8 | Chargeback recording (admin "Record chargeback": refund row `CHARGEBACK`, reversal, evidence export) | Schema only | P1 | Plan decisions B5/B6; BOG dispute channel | 1–1.5 d | Build after the decision | Yes, after the decision |
| PAY-9 | Settlement-statement import and matching (daily BOG CSV vs `payments`) | Not started | P1 | BOG report format | 1.5–2 d | Get a sample statement | After a sample |
| PAY-10 | Schedule `/api/cron/payments-reconcile` | Endpoint built (#6), not scheduled | P1 | Vercel plan (Hobby = daily); `CRON_SECRET`, `RECONCILE_ADMIN_USER_ID` | 0.25 d | Owner picks a frequency → add a `vercel.json` cron | Yes, after the decision |
| PAY-11 | Preview-only TEST payments (`prep/preview-test-payments` b6ef428) | Built, local only | P2 | Owner approval (changes the payment guard) | 0.25 d to rebase | Approve or drop | No (approval) |
| PAY-12 | Callback for an unknown BOG order answers 400 (plan said 200 + anomaly) | Open | P3 | Merchant req. B7 (BOG retry behaviour) | 0.25 d | Decide after BOG answers | Yes |
| PAY-13 | Async ADMIN refund completion fails if the requesting admin is removed before BOG confirms | Open | P3 | — | 0.25 d | Fall back to any current admin, or a system actor with an audited reason | Yes |

## Product, design and UX

| ID | Item | Status | P | Depends on | Effort | Next action | Claude alone? |
|---|---|---|---|---|---|---|---|
| UX-1 | Physical-device QA (iPhone Safari, mid-range Android, on mobile data) | Emulated only. Checklist in `MOBILE_QA_CHECKLIST.md` | P1 | A person with phones; a preview URL (INF-5) | 0.5 d | Run the checklist on the preview | No |
| UX-2 | Signature Experience Phase 1 (sender UI) | **Uncommitted WIP** in the integration worktree; preserved as local branch `integration/signature-phase1-wip` 84b364c; tsc and lint pass; E2E and QA not run; flag defaults ON | P2 | Owner approval of Phase 1; review | 2–4 d to finish, QA and review *(estimate)* | Owner decides whether Signature ships at launch or after | Partly |
| UX-3 | Signature Phases 2 (recipient), 3 (checkout and pricing UI), 4 (RC) | Not started | P2 | UX-2; per-phase approval | 6–10 d *(estimate)* | After launch is recommended | Partly |
| UX-4 | Signature perf regression (+59–256 ms throttled interactivity) | Measured on the prototype | P2 | UX-2 | 1 d | Address during Phase 1 QA | Yes |
| UX-5 | E2E for the closed-checkout notice (BOG mode, `CHECKOUT_ENABLED=false`) | Server side tested (bog-integration 1a/1b); UI not E2E-tested | P3 | — | 0.25 d | Add a Playwright project with BOG env | Yes |

## Infrastructure and operations (owner-gated)

| ID | Item | Status | P | Depends on | Effort | Next action | Claude alone? |
|---|---|---|---|---|---|---|---|
| INF-1 | Vercel Pro (Hobby forbids commercial use) | Not created | P0 | Owner, paid | — | `QRAPP_GE_LAUNCH_STEPS.md` step 1 | No |
| INF-2 | Supabase production (Pro, Frankfurt) + staging (free) | Not created | P0 | Owner, paid | — | Steps 2–4 | No |
| INF-3 | Migrate, seed, rotate `app_runtime`, launch-pricing check on staging, then production | Blocked | P0 | INF-2; merged PRs | 0.5 d | Steps 5–6 | With the owner's shell |
| INF-4 | Auth settings, private bucket, first admin | Blocked | P0 | INF-2 | 0.25 d | Steps 7–9 | No |
| INF-5 | Vercel project, env vars, preview deploy, staging validation | Blocked | P0 | INF-1, INF-3 | 0.5 d | Steps 10–13 | Partly |
| INF-6 | Email (Resend + DNS: SPF, DKIM, DMARC), Supabase SMTP | Blocked | P1 | DNS access | 0.25 d | Steps 14–16 | No |
| INF-7 | Domain cutover qrapp.ge | Blocked | P0 | INF-5 | 0.25 d | Steps 18–21 | No (DNS) |
| INF-8 | Uptime monitor + alert routing; log-based alert on `level:error` / `paymentReconcile` | Not set up | P1 | INF-7 | 0.25 d | Step 17 | No |
| INF-9 | Backups confirmed; PITR decision; restore drill on staging | Documented only | P1 | INF-2 | 0.5 d | `DISASTER_RECOVERY.md` | Partly |
| OPS-6 | Legal pages (terms, privacy, refund policy, company details); BOG requires them | Not started | P0 | Owner / lawyer | — | Owner provides the texts; Claude can build the pages | Pages only |
| OPS-7 | First partner, first QR batch, print test, real scans | Not started | P1 | INF-7 | 0.5 d | `PILOT_LAUNCH_CHECKLIST.md` §10–13 | No |

## Housekeeping

| ID | Item | P | Effort | Claude alone? |
|---|---|---|---|---|
| HK-1 | The main worktree still holds the original uncommitted BOG WIP (superseded by PR #6). Discard it **only on the owner's instruction**. | P2 | minutes | No (owner's files) |
| HK-2 | The shared local dev DB (`postgres`) applied the old BOG SQL as `0018`; recreate it before running #5/#6 locally (`supabase db reset` + migrate + seed + dev-bootstrap) | P2 | 0.1 d | Yes, with approval (local data loss) |
| HK-3 | 9 local worktrees: prune once the PRs are merged | P3 | minutes | Yes |
| HK-4 | Merge or close PR #4 (docs). Its plan says "migration 0018"; update it to 0019 | P3 | minutes | Yes |
| HK-5 | Drizzle snapshots are missing after 0007 | P3 | 0.25 d | Yes |

## Open business decisions (no code until decided)

IDs: PP-* come from PR #5. B1–B8 are the BOG plan's §6 decisions. (In PAY-3, B6–B13 refer instead to
the **merchant requirements** §B list.)

| ID | Decision | Recommendation |
|---|---|---|
| PP-a | Do open PENDING orders keep their old price after a change? | Yes (current behaviour; the order snapshot is the contract) |
| PP-b | Price bounds 1–1000 GEL | Keep |
| PP-c | Super Admin = any `admin_users` row (no tiers) | Keep for launch |
| PP-d | A partner with a non-GEL currency | Refuse overrides outside GEL for launch |
| PP-e | BOG minimum amount | Ask BOG |
| B1 | Payment methods | Card + Apple Pay + Google Pay |
| B2 | BOG order TTL | 30 min |
| B4 | Commission reversal timing | At refund completion (implemented) |
| B5/B6 | Chargebacks; refund after payout | Admin-recorded; net against future commission |
| B7 | VAT and fees outside the app; 7.00 GEL is a gross allocation | Confirm with an accountant |
| H1 | Commission holding period before payout (chargeback window) | Consider 14–30 days *(business call)* |
| SIG | Does Signature ship at launch? | **No**: launch on the current approved UI, ship Signature after |
| CRON | Reconcile frequency (Hobby: daily; Pro: any) | Every 10 min on Pro |

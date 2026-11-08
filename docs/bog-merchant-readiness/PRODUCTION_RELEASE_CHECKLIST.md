# Production release checklist: merchant readiness (2026-11-07)

| | |
|---|---|
| Branch | `integration/bog-merchant-readiness` (local, not pushed) |
| Code commit | `4883262` |
| Base | production `f819c91` (+ a4d7561 merchant identity, b609363 readiness docs, merged at 3710b03) |
| Migrations | **none** |
| Production changes made | **none** (no deploy, no env, no DB, no credentials) |
| Recovery copy of the pre-commit work | `/Users/Shared/qr-starr-recovery-backups/20261107-002546-bog-integration/` |

## Files changed (4883262)

`package.json`, `scripts/verify-site-content.ts`, `scripts/verify-greeting-availability.ts` (new), `src/lib/greetings/availability.ts` (new), `src/lib/greetings/recipient.ts`, `src/lib/qr/resolve-state.ts`, `src/app/g/[token]/page.tsx`, `src/components/qr/placeholders.tsx`, `src/components/greeting/{checkout-legal,creation-wizard,signature-checkout,signature-wizard}.tsx`, `src/components/site/{context.ts,inline.tsx,merchant-details.tsx,site-footer.tsx}`, `src/lib/merchant/info.ts`, `src/messages/{en,ka}.json`, `src/messages/site/{en,ka}.json`, `docs/ops/RENDER_RECONCILE_CRON.md` (new).

## Tests (2026-11-07, isolated DB `qr_bog_integration`; logs in `/Users/Shared/qr-starr-device-tests/2026-11-07-bog-readiness/logs/`)

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS |
| `eslint .` | PASS (0 problems) |
| `next build` (production, `NEXT_PUBLIC_APP_URL=https://qrapp.ge`) | PASS |
| `verify:*` suites | **29/29 PASS, 0 failed checks.** commercial 19, phase1 26, phase2 24, phase3 30, phase4 22, phase5 41, password-reset 8, payout-concurrency 7, admin-pagination 4, rate-limiting 8, analytics-funnel 10, pilot-protections 39, partner-privacy 16, partner-attribution 59, payout-items 49, business-calendar 32, payment-integrity 45, partner-pricing 70, media-replacement 27, bog-adapter 56, bog-integration 42, ops-preflight 13, greeting-availability 14, chargebacks 22, site-content 53, low-cost-hosting 55, env-guards 36, data-api-lockdown 47, templates (all) |
| Playwright e2e (desktop-chromium + mobile-emulated) | **220 passed, 13 failed, 33 skipped, 6 did not run** on the first run. Rerun of the 13: **9 passed** (load flakes: cold `next dev` compiles and auth warm-up after a Docker restart). **4 failed: environment, pre-existing**: `partner-privacy.spec.ts` ×2 tests ×2 projects read `auth.users` through the isolated database, which has no `auth` schema (same 4 failed in earlier baselines; the same logic passes in `verify:partner-privacy` 16/16) |
| Visual/content sweep, owner values (KA+EN, 390 + 1280 px, checkout, payment screens, expired screen) | 58/58 PASS (2026-11-06, same source except the test-only phone fixture change below) |

After the e2e run one confirmed issue was fixed: the owner's real phone number was used as a test vector and in a code comment in this **public** repository. It was replaced by fictitious numbers. Re-verified: site-content 53/53, tsc, eslint.

No product regressions were found.

## Release order (recommended)

1. **Security release first**: Supabase key migration, PR #17 (`security/supabase-api-keys-v2`), then revoke the leaked legacy HS256 secret. This follows the owner's rule: no other deploy until security is resolved.
2. **Merchant-content release (this branch)**:
   - rebase onto whatever is live after step 1;
   - owner approves the public values;
   - set `MERCHANT_*` in Render from the approved `merchant.env`;
   - deploy;
   - checkout stays disabled (`CHECKOUT_ENABLED=false`, provider TEST).
3. Registry extract → `MERCHANT_ID_CODE`, `MERCHANT_LEGAL_ADDRESS_*` (env only, no code change).
4. Lawyer sign-off (L1–L15) → copy fixes → `LEGAL_EFFECTIVE_DATE`.
5. BOG: submit the online-payments request in Business Manager; send `BOG_SANDBOX_REQUEST_KA.md` (owner approval first).
6. Sandbox on **staging** (never prod): `docs/PAYMENTS.md` checklist plus a BOG-signed callback fixture.
7. Before LIVE:
   - paid Render instance;
   - reconcile cron (`docs/ops/RENDER_RECONCILE_CRON.md`);
   - payment/activation alerts;
   - admin MFA and demo-account removal;
   - scheduled backups;
   - E3 payment reference.
8. LIVE activation: BOG LIVE credentials in Render, `PAYMENTS_PROVIDER=BOG`, `CHECKOUT_ENABLED=true`, one real low-value payment + refund test, then open.

## Deploy steps for the merchant-content release (when approved)

- [ ] Owner approves the public values in `merchant.env` (name, contact address label, email, phone, hours, VAT).
- [ ] Rebased on the live commit; tsc / eslint / build / `verify:*` re-run green.
- [ ] Render env: `MERCHANT_*` set. `LEGAL_EFFECTIVE_DATE` **unset**. `CHECKOUT_ENABLED=false`. No BOG vars.
- [ ] Deploy, then smoke-test:
  - `/api/health`;
  - `/contact`, `/terms`, `/privacy`, `/delivery-and-refunds` in KA and EN;
  - footer;
  - one ACTIVE demo code opens (not expired);
  - an AVAILABLE code reaches the wizard; checkout is still closed.
- [ ] Rollback: redeploy the previous Render deploy. No schema change, so rollback is safe.

## GO / NO-GO

| Decision | Verdict | Conditions |
|---|---|---|
| **Merchant website deployment** (content, contact, checkout disclosures, expiry screen; checkout disabled) | **CONDITIONAL GO** | Technically ready (all suites green, no migrations). Conditions: owner approval of the public values, and the security release (PR #17 + HS256 revoke) first, per the owner's rule |
| **LIVE payment activation** | **NO-GO** | No BOG merchant approval, no sandbox or LIVE credentials, never tested against real BOG. ID code / legal address pending; lawyer sign-off pending. The leaked HS256 secret is still trusted. Render Free plan; no reconcile cron; no alerting; no admin MFA; demo accounts present |

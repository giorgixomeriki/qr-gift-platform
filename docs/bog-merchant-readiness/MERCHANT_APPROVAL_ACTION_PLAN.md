# Merchant approval action plan

Inputs:
- `BOG_MERCHANT_REQUIREMENTS.md`: sources and the C1/C2/C3 classes.
- `QR_STARR_WEBSITE_COMPLIANCE_AUDIT.md`
- `PAYMENT_INTEGRATION_GAP_REPORT.md`
- `OWNER_INFORMATION_CHECKLIST_KA.md`: the questions referenced as Q-x.y.

Priorities:
- **P0** blocks merchant approval or safe live payments.
- **P1** is needed before commercial launch.
- **P2** is recommended.

## 1. Gap analysis

| Requirement | Official source | Current QR Starr state | Missing information | Required action | Priority |
|---|---|---|---|---|---|
| BOG business account; director access to Business Manager (O3, O4) | businessmanager.bog.ge/en/online-payment; /en/products/faq | Unknown | Does an account exist? Entity type? | Owner opens the account (bonline.bog.ge/onboarding) if needed | **P0** |
| Request Online Payments in Payments Manager; ≤3 working days (O5) | /en/products/faq | Not requested (no creds anywhere) | Application status | Owner applies **after** the site fixes below are live | **P0** |
| Sandbox credentials (O7) | api.bog.ge/docs/en/payments/authentication | None | — | Owner requests them now (no need to wait for approval) | **P0** |
| Merchant identity on site (W1, W3) | Card-scheme practice (C2); BOG check unpublished (C3) | MISSING: env unset; code ready | Q-1.1–1.6 | Owner sets `MERCHANT_*` on Render; `npm run ops:check-merchant-info` = 0 | **P0** |
| Customer contact (W2) | C2/C3 | MISSING | Q-2.1–2.4 | Same env; a real mailbox someone answers | **P0** |
| Refund/cancellation disclosed before payment (W5) | C2/C3; Consumer Rights law (lawyer) | PARTIAL: page incomplete; no link at checkout | Q-4.1–4.5 | Fill policy copy (copy PR) + E2 checkout links/consent | **P0** |
| Terms complete (W8) | C2/C3 | PARTIAL: §2 age, §5 withdrawal, §11 courts, §12 language blank | Q-3.3, 4.4–4.6 | Copy PR after the answers; lawyer review of ⚖️ items | **P0** |
| Privacy notice complete (W9) | Personal Data Protection law | PARTIAL: no controller, retention, request contact; Render not listed | Q-1.x, 3.1–3.2, 5.2 | Copy PR; E9; lawyer review | **P0** |
| Policies in effect, not draft (W14) | C2/C3 | Draft banner + noindex | Lawyer sign-off date | Remove markers via reviewed PR → set `LEGAL_EFFECTIVE_DATE` | **P0** |
| Delivery description (W6) | C2 | COMPLETE (wording) | — | — | — |
| Prices in GEL (W7) | C2 | COMPLETE: 10 ₾ standard, from the DB | VAT wording (Q-3.6) | Add the tax line once answered | P1 |
| Service description (W4) | C2 | COMPLETE | — | — | — |
| HTTPS (W10, T1) | api.bog.ge | COMPLETE | — | — | — |
| Logos / BOG marks (W11) | C3 | MISSING | BOG answer | Ask BOG (questions §4.13); add artwork if required | P1 (P0 if BOG requires) |
| Payment receipt / reference (W12) | C3 | PARTIAL: on-screen only, no reference | BOG + accountant | E3; fiscal duty per accountant | P1 |
| Site reachable during review (W14) | C2 | Free plan; 2/20 requests got 503 | Owner budget | E5: upgrade Render | **P0** |
| OAuth / create order / receipt / refund per API (T1–T8) | api.bog.ge/docs/en/payments/* | IMPLEMENTED BUT UNVERIFIED (56 + 42 local checks) | Sandbox creds | E6 sandbox run on staging | **P0** |
| Callback signature (T5) | …/standard-process/callback | IMPLEMENTED BUT UNVERIFIED | Signed sample | E7 | **P0** |
| Callback retries / IPs (T6) | C3 | Unknown | BOG answer | Q8 to BOG | P1 |
| Hosted page host (T11) | C3 | Assumed `payment.bog.ge` | BOG answer | Confirm in sandbox | **P0** (found in sandbox) |
| Reconciliation | O12 statements (C1) | PARTIAL: no schedule on Render | — | E4 + weekly manual check against Business Manager report | **P0** |
| Refunds on before live | T8 | Off (`BOG_REFUNDS_ENABLED` unset) | Owner approval | Enable after a sandbox refund passes | **P0** |
| Chargeback process | C3 | Manual tool ready | BOG answer | Q7 to BOG; confirm B5/B6 | P1 |
| Deposit / settlement timing (O10, O11) | BOG pages contradict | — | BOG answer | Ask in writing | P1 |
| Fees, MCC, model acceptability (O15) | C3 | — | BOG answer | Ask in writing (questions §4.3–4.4) | **P0** (contract) |
| Platform security: leaked HS256 secret | Not a BOG rule | OPEN (PR #17 not deployed) | Owner window | E1 | **P0** |
| Admin MFA / demo accounts / demo cards | Not a BOG rule | OPEN | — | E11 | P1 (super admin: **P0**) |
| Backups / monitoring | Not a BOG rule | Manual backup only | — | Scheduled backup; E12 | P1 |

## 2. Rejection risks (separate list)

1. No legal identity or contacts on the site → **likely rejection** (if BOG reviews the site).
2. Draft policies and empty sections; no refund request channel.
3. No pre-payment disclosure or consent for non-refundable instant digital delivery → also a **chargeback** risk.
4. Business model questions (partner shops earn commission; QR Starr pays them) → explain proactively; no split payment is used.
5. Reviewer can't test checkout on prod (closed) → offer a sandbox demo on staging.
6. Free-plan 503s / cold starts during review.
7. BOG's own EN/KA FAQ conflict (deposit, settlement). Don't plan cash flow until it is confirmed.

## 3. Shortest safe path to the first real payment

Each step has an owner gate. Nothing here deploys or enables anything by itself.

| Step | Who | Depends on | Output |
|---|---|---|---|
| 1 | Owner: answer `OWNER_INFORMATION_CHECKLIST_KA.md` §1–5; confirm or open the BOG business account (§6) | — | Facts + decisions |
| 2 | Owner: request **sandbox** credentials now (api.bog.ge "Request Sandbox Credentials"); send the BOG questions (`BOG_MERCHANT_REQUIREMENTS.md` §4) | — | Sandbox creds (owner stores them; never in chat) |
| 3 | Engineering: copy PR with policy answers + E2 checkout links/consent + E3 reference + E9 processors; lawyer reviews ⚖️ items | 1, lawyer | Reviewed PR (not merged) |
| 4 | Owner-approved security release E1 (key migration), separate from design work | owner window | Leaked secret revoked |
| 5 | Owner: upgrade Render (E5); set `MERCHANT_*` env; engineering: E4 reconcile schedule | 1 | Site complete, reachable |
| 6 | Owner approves merge/deploy of 3; set `LEGAL_EFFECTIVE_DATE` → banners and noindex gone. **Checkout stays closed.** | 3, 5, lawyer | Reviewable site |
| 7 | Engineering: E6 + E7 sandbox run on a **staging** environment (13 steps, `docs/PAYMENTS.md`) | 2 | Sandbox PASS report |
| 8 | Owner: apply for Online Payments in Business Manager (≤3 working days) | 6 | Production `client_id/secret` in Business Manager |
| 9 | Owner enters prod creds into Render env (Sensitive); `PAYMENTS_PROVIDER=BOG`, `CHECKOUT_ENABLED=false`; deploy; check unsigned callback → 400 | 8 | Prod adapter armed, still closed |
| 10 | Owner approval: `CHECKOUT_ENABLED=true` + `BOG_REFUNDS_ENABLED=true` for a controlled window; owner pays 10 ₾ on a fresh card; verify PAID → ACTIVE → recipient; refund it; reconcile = clean; compare with the Business Manager statement | 7, 9 | **First real payment verified** |
| 11 | Owner decides: keep open (commercial launch) or close again | 10 | — |

Realistic critical path: owner answers + lawyer (days) → site update → BOG review (≤3 working days, C1) → one controlled payment. Engineering work in steps 3–5 is small (about 1–2 days) once the answers exist.

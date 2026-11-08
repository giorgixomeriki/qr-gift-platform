# Checkout readiness report (2026-11-07)

Production today: `PAYMENTS_PROVIDER=TEST`, `CHECKOUT_ENABLED=false`. A production build refuses TEST payments outright (`provider-factory.ts`), so **no one can pay on qrapp.ge**. This branch does not change that.

## What the customer sees before paying (both wizards: classic + Signature)

Component: `src/components/greeting/checkout-legal.tsx`, wired through `src/app/g/[token]/page.tsx` → `creation-wizard.tsx` / `signature-wizard.tsx` / `signature-checkout.tsx`.

| Requirement | Status | Test |
|---|---|---|
| QR Starr brand | ✓ `checkout-brand` | K-ka-1, K-en-1 |
| Seller's name (IE, from `MERCHANT_LEGAL_NAME_*`; hidden when unset) | ✓ `checkout-seller` | K-ka-1, K-en-1 |
| Final total in GEL, from the server price (order snapshot) | ✓ (unchanged) | K-*, `verify:partner-pricing`, `verify:payment-integrity` |
| Tax disclosure: "not registered for VAT; no VAT is added" | ✓ `checkout-vat` (display only, never changes the amount) | K-*, site-content E10 |
| Minimum age 18 | ✓ `checkout-age` | K-* |
| Terms / Privacy / Delivery & Refunds links | ✓ | K-* |
| What happens on payment (activation after verified payment) | ✓ wizard copy + Refunds "Payment outcomes" | C-*-8 |
| No misleading consent mechanism | ✓ no checkbox added. Whether one is legally needed is L1/D3 | K-*-2 |
| Legal lines not hidden behind the sticky pay button (390×844) | ✓ | screenshot `ka-mobile-checkout-viewport-bottom.png` |

## After payment

| Screen | Status |
|---|---|
| Success (sender sees the activation banner) | ✓ simulated provider (K-ka-5) |
| Failed: message + retry | ✓ (K-ka-3) |
| Cancelled | ✓ (K-ka-4) |
| Pending: "we are checking the status, don't pay again" | Copy in Refunds; screen exists in code. Real BOG pending path untested |
| Payment reference on success (order short id + BOG order id, date, amount) | **Open (E3, P1)** |

## Server-side guarantees (existing, re-verified 2026-11-07)

- Activation only after server-side verification. Landing on the return URL alone pays nothing (`verify:bog-integration` 42/42, check 8a; `verify:payment-integrity` 45/45).
- Idempotent callbacks and duplicate confirmations; concurrent activation (`verify:payment-integrity`, `verify:payout-concurrency` 7/7).
- Refund / chargeback reverse the partner commission (`verify:chargebacks` 22/22, `verify:payout-items` 49/49).
- Historical price and commission snapshots unchanged after rate changes (`verify:partner-pricing` 70/70).

## Verdict

**Checkout UI: ready to deploy in disabled state.** **Not ready to enable**: needs BOG credentials + sandbox run (E6/E7), reconciliation schedule (E4), paid Render instance (E5), key migration (E1), lawyer answer on L1/D3, and the E3 payment reference.

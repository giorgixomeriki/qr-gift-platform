# Refund Model C — public access suspended after a confirmed full refund

Owner decision (2026-11-25): M5 = A + Refund Model C.

## Rule
A greeting is **refund-suspended** when it has an order in `REFUNDED` and no order in `PAID`
(`app_greeting_refund_suspended`, migration 0029). `REFUNDED` is set only by a completed ADMIN
refund or a recorded CHARGEBACK of a PAID order, so:

| Event | Order status | Public greeting |
|---|---|---|
| Full admin refund (BOG confirmed) | REFUNDED | **suspended** |
| Chargeback recorded | REFUNDED | **suspended** |
| Refund still REQUESTED / ambiguous | PAID | live (until confirmed) |
| Duplicate-charge refund | PAID | live |
| Partial refund | PARTIALLY_REFUNDED | live |
| Ineligible capture refunded (never activated) | REFUNDED | n/a (never ACTIVE) |

## Enforcement (server-side, three layers)
1. `resolveQrState` → `suspended` (checked before expiry) → `/g/[token]` renders a neutral
   KA/EN "currently unavailable" screen (never says "refunded").
2. `loadActiveGreetingForRecipient` and `signRecipientVoiceUrl` re-check it → no signed media URL.
3. RLS `greeting_content_select` public branch requires not-suspended.

Kept: QR token + status, greeting, content, media, orders, payments, refund rows, partner ledger
(earned + reversal). Admins can still read content.

## Tests
`verify:refund-model-c` 26/26 (old code fails 4: B2, B4, B5, E1). 19f (bog-integration) and 1e
(chargebacks) now assert suspension. Regression: bog-integration 89, chargebacks 22,
data-api-lockdown 47, phase4 22, pilot-protections 39, m1-pilot-price 52, m1-hardening 33,
reconciliation 48, qr-handover 123, partner-locations 48, greeting-availability 14, voice 53.
tsc, lint, build OK. Rollback `rollback-0029.sql` rehearsed: policy identical to 0028, ledger 29.

## Coordination with Scheduled Reveal (feat/scheduled-reveal-countdown)
That branch also uses **0029** (`0029_greeting_schedule`) and its own
`app_greeting_public_state()`, which already returns SUSPENDED with the same rule, before SCHEDULED.
Whichever ships second renumbers to **0030** (journal `when` > 1795680000000). If countdown
ships after this, its `greeting_content_select` replaces this one; keep the not-suspended
condition (its `= 'OPEN'` already covers it), and its resolver must keep returning
`suspended` before `scheduled`, so a countdown can never reopen a refunded greeting.

## Not done (needs explicit approval)
No prod migration, no deploy. Apply order: backup → 0029 → deploy code. Old code is compatible
with 0029 (only the RLS backstop is active then).

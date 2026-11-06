# Legal content review: KA / EN (2026-11-07)

**For the owner and the lawyer. This is not legal advice.** The copy lives in `src/messages/site/ka.json` and `en.json` (one structure, two languages; `verify:site-content` 53/53 checks parity, Georgian-only KA strings, merchant tokens and pricing claims).

Two kinds of marker exist in the copy:
- **`review`**: text that is drafted but must be confirmed by a lawyer before the policy takes effect;
- **`decision` (Mx/Dx/Cx)**: a fact only the owner, bank or accountant can supply. It renders as a neutral "will be stated here" line, never as an invented value.

Every policy shows **"not yet in effect"** until `LEGAL_EFFECTIVE_DATE` is set. Set it only after the lawyer signs off.

## What changed in this release (KA and EN identical in meaning)

| Page | Change |
|---|---|
| Terms | Seller identification via merchant tokens; minimum age 18; 12-month availability; technical-failure remedy; VAT notice |
| Privacy | Controller = the IE via tokens; contact address labelled separately from the legal address; Render (hosting) + Supabase (database/storage), both Frankfurt, as processors; **no** claim of automatic deletion after 12 months (availability ≠ retention) |
| Delivery & Refunds | New sections: payment outcomes (success only after server-side verification; failed / cancelled / pending / charged twice), interruptions and availability period, complaints. Technical failure: recover first, full refund if delivery can't be restored |
| Pricing | VAT notice from `MERCHANT_VAT_STATUS` ("not registered for VAT; no VAT is added") |
| Contact / footer | Confirmed details shown as soon as they exist; the contact address is labelled "Contact (operating) address" |
| Checkout | Brand + seller, VAT line, 18+ line, Terms / Privacy / Delivery & Refunds links. **No consent checkbox** |
| QR screen | "This greeting's availability has ended" (no sender, content or dates) |

## Lawyer review items (`review`)

| # | Where | Question |
|---|---|---|
| L1 | Terms → withdrawal; Refunds → after activation | Does the distance-contract withdrawal right end once digital content is supplied (activated), and what prior express consent/acknowledgement is needed before payment? This decides whether checkout needs a consent line or checkbox (D3) |
| L2 | Refunds → exclusions | Can a "changed my mind" refund be refused after activation? |
| L3 | Refunds → refunds | Is any deadline for refund requests allowed? (No deadline is stated; none was invented) |
| L4 | Terms → eligibility | Is an 18+ declaration enough, or is verification needed? |
| L5 | Terms → availability; Refunds → interruptions | Remedies for a technical fault; whether "the end of the 12-month period is not a reason for a refund" may be stated |
| L6 | Terms → liability | Any limitation (e.g. to the fee paid) and whether it is enforceable |
| L7 | Terms → your content | Scope and duration of the licence to user content |
| L8 | Terms → changes | Which language prevails |
| L9 | Privacy → controller | Is a data protection officer required? |
| L10 | Privacy → data we collect | Lawful basis per purpose (Law of Georgia on Personal Data Protection) |
| L11 | Privacy → providers | Legal basis for transfer to providers outside Georgia; DPAs with Render and Supabase |
| L12 | Privacy → cookies | Is a banner needed for strictly necessary cookies? |
| L13 | Privacy → your rights | Full list of rights, deadlines, exceptions |
| L14 | Privacy → security | Breach-notification duties |
| L15 | Privacy → changes | Advance notice of material changes |

## Owner / bank / accountant decisions still open

| Ref | Decision |
|---|---|
| M1 | Payment-method wording (after BOG approves the methods) |
| M2 | How physical cards reach customers; separate card charge? |
| M4 | Who at QR Starr may access greeting content, and when |
| M5 | Refund when a greeting is blocked for a Terms breach; does a refunded greeting stay available? |
| M6 | Response times: support, refunds, complaints |
| D1 | Retention periods (greetings/media, drafts, payment records, logs). Nothing is deleted today |
| D6 | Competent court / ADR |
| D7 | Content-report channel |
| D8 | Who handles data requests, within what time |
| C4 | Bank refund-to-card time (ask BOG) |
| — | Registered legal address + ID code (registry extract; consent to publish the personal number) |
| — | Official English rendering of the legal name |
| — | Fiscal receipt obligation (accountant) |

## Explicitly not claimed

- No VAT exemption claim beyond "not registered for VAT".
- No automatic deletion after 12 months.
- No refund deadline, no withdrawal waiver, no age verification claim.
- The contact address is never presented as the registered address.

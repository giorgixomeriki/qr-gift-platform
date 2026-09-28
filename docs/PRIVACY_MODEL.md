# Greeting Privacy Model (V1)

What protects a customer's private greeting (message, photos, video, voice)
from the Partner who sold the card, what doesn't, and why. Read this before
changing anything under `src/lib/qr/`, the partner dashboard, the QR
export/print/image routes, or the `greetings` / `greeting_content` RLS
policies.

## The credential

Every physical card carries one QR code encoding
`https://<app>/g/<public_token>`. That token is:

- the card's **identity** — it starts the sender flow and drives analytics; and
- the **only key** to the greeting behind it — V1 recipients scan and the
  greeting opens, with no PIN or second secret (a deliberate product
  decision: no friction for the recipient).

Anyone holding the token of an ACTIVE card can open that greeting. The
platform cannot tell the real recipient apart from anyone else holding the
same printed credential.

## Who necessarily holds the credential

The Partner (and any print vendor they use) must have each token to print
the card — **while the card is still unclaimed**. At that point there is no
greeting behind it. A greeting only starts to exist when a sender claims
the card (`AVAILABLE -> DRAFT`), and nothing a Partner does afterwards
(sales, commission, distribution tracking) needs the token.

## What V1 enforces

| Surface | Partner gets | Admin gets |
|---|---|---|
| Dashboard inventory (`/partner/dashboard`) | Full token + QR image link only for `AVAILABLE` cards; claimed cards show a masked label (`••••7YUC`), status **Used**, no link. Only the shaped row (`InventoryQrRow`) reaches the browser — never the raw DB row. | Everything |
| CSV export (`/api/qr/batches/:id/export`) | Token + URL for `AVAILABLE` cards; claimed cards masked, empty URL, status `USED` | Everything |
| Print sheet (`/print/batch/:id`) | Only `AVAILABLE` cards | Every card (reprints) |
| QR image (`/api/qr/:id`) | `AVAILABLE` cards only; otherwise 404 (not 403 — doesn't confirm state) | Every card |
| Card lifecycle | `Available` / `Used` only — never draft vs live vs blocked. Aggregate counts on the dashboard are unchanged. | Real status |
| Greeting content / media | Nothing: no partner-facing module reads `greeting_content` or issues media URLs; RLS gives a partner context no content and (since `0012`) no extra greeting visibility; the Storage bucket is private with no partner policy | Via moderation |

The rule lives in one place: `src/lib/qr/credential-access.ts`.

Supporting controls:

- **No caching.** Export, print and QR image responses are `no-store`, so a
  browser or proxy doesn't keep credentials around.
- **Audit log.** Every export (`QR_BATCH_EXPORTED`), print render
  (`QR_BATCH_PRINT_VIEWED`) and QR image download (`QR_ASSET_DOWNLOADED`) is
  recorded with the user, partner, and how many credentials were released.

Verified by `npm run verify:partner-privacy` and `e2e/partner-privacy.spec.ts`.

## What V1 does NOT protect — the physical-credential trust limitation

**A token copied while the card was unclaimed still opens the greeting once
it is activated.** That includes a Partner's or print vendor's retained
CSV/PDF/print file, an earlier export, a photo of the card, or anyone who
handled the physical card. The controls above stop the *platform* from
handing credentials out after a greeting exists; they cannot make someone
forget one they already had. No cryptographic protection against such a
holder is claimed.

Related, and equally inherent: a holder of a retained list can infer which
cards were claimed — any token no longer listed as available has been used.
Hiding the claimed card's identifier doesn't change that; it only avoids
telling them *which state* (draft, live, blocked) it is in.

Exports made before this hardening (while every token was always
exportable) cannot be recalled.

The only technical fix is a second, recipient-only secret the Partner never
sees (e.g. an unlock code the sender passes to the recipient). It was
designed and deferred for V1 to keep scan -> open frictionless.

## Operational controls that carry the remaining risk

These belong in the Partner agreement and onboarding:

1. Tokens are credentials to customers' private messages. Partners export or
   print only what they are about to print, and delete CSV/PDF/print files
   (including the print vendor's copies) once the cards are printed.
2. Partners and their staff must not scan, open or share customers' cards.
3. The platform keeps an audit log of every credential export, print and
   download; it is reviewed on any privacy complaint.
4. Suspected misuse is handled by suspending the Partner (new activity stops;
   already-paid greetings stay available to their recipients).

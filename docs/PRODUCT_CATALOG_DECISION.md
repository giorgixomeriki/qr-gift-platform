# Product Catalog Decision — Options A/B/C

**Status: awaiting business decision. No code in this repository has been changed as part of this
document — `DEFAULT_PRODUCT_KEY` remains `PREMIUM_GREETING` for every new greeting until one of the
options below is explicitly approved.**

## How the catalog actually works today (verified in code, not assumed)

- `products` (`src/db/schema/products.ts`) and `prices` (same file) are real, general tables: a product has a
  `key`/`name`, a price row is `{ productId, partnerId (nullable = platform default), currency, amountMinor }`.
  `resolveActivePrice` (`src/lib/payments/pricing.ts`) already supports a partner-specific price override
  taking priority over a platform default for the *same* product — this mechanism is fully built and tested
  (`verify:phase2` #13a/#13b), just never exercised with more than one product today.
- `src/db/seed.ts` seeds four products — `PHOTO_GREETING` (500 tetri), `VIDEO_GREETING` (1000),
  `PREMIUM_GREETING` (1500), `GROUP_GREETING` (2000) — and a platform-default price row for each.
- `src/lib/greetings/constants.ts` hardcodes `DEFAULT_PRODUCT_KEY = "PREMIUM_GREETING"`.
  `startGreeting` (`src/lib/greetings/start.ts:44`) assigns this single product to every new greeting at
  creation time — there is no branch, flag, or UI path anywhere that assigns a different one.
- `getDefaultProductPrice` (`src/lib/payments/pricing.ts`) is the only price ever shown to a sender
  (Sender Entry, Preview CTA) — it always resolves `DEFAULT_PRODUCT_KEY`'s price.
- `startCheckout` (`src/lib/payments/service.ts`) re-resolves price from `greeting.productId` (set at
  creation, never client-supplied) — so checkout already trusts *whatever* product a greeting was created
  with; it has no hardcoded assumption of its own. This matters below: checkout itself needs **zero changes**
  for Option B, because it was already built product-agnostic.
- `creation-wizard.tsx` has no product/tier selection step at all today — only a theme (visual) choice.
- Photo/video/voice slot limits (3 photos, 1 video, 1 audio) come from `SLOT_LIMITS` in
  `src/lib/greetings/content.ts` and are **not** currently tied to `products` in any way — "VIDEO_GREETING
  gets a video, PHOTO_GREETING doesn't" is not enforced anywhere; the product keys today are purely a pricing
  label with no capability difference. Any option below that wants a real capability difference per tier
  needs new code to actually gate content types by product, not just a price change.

## Option A — One universal product, one fixed price

Keep exactly what exists today, deliberately: a single product for every greeting, one price.

- **Code changes:** none. This is the status quo.
- **Database impact:** none — the unused `PHOTO_GREETING`/`VIDEO_GREETING`/`GROUP_GREETING` rows and their
  prices stay in the table, inert (harmless, already `onConflictDoNothing`-seeded).
- **Checkout impact:** none.
- **Partner commission impact:** none — commission is a percentage of whatever the single price is, unchanged.
- **Customer UX impact:** none — simplest possible purchase decision (there isn't one).
- **Testing requirements:** none beyond what already exists.

## Option B — Multiple products, different prices and capabilities

Let the sender choose among the four (or fewer) seeded products, each with its own price and its own
media-slot capabilities (e.g. `PHOTO_GREETING` = photos only, no video; `GROUP_GREETING` = higher slot limits
for a shared/collaborative greeting).

- **Code changes:**
  - A new wizard step (between theme and message, or as part of Sender Entry) to pick a product — a new
    component following the exact pattern `ThemeStep` already uses (`SELECTABLE_THEMES` → radio buttons →
    `updateThemeAction`), but for products. Needs a new `updateGreetingProductAction`/service function
    mirroring `updateGreetingTheme` in `src/lib/greetings/actions.ts` — that function does not exist today
    because the product is currently fixed at creation.
  - `startGreeting` (`src/lib/greetings/start.ts`) needs to accept a caller-chosen product instead of always
    reading `DEFAULT_PRODUCT_KEY` — but the choice must still be server-validated against the real `products`
    table (never trust a client-supplied product key blindly, same principle already applied everywhere else
    in this codebase).
  - `SLOT_LIMITS` (`src/lib/greetings/content.ts`) would need to become per-product instead of a single
    global constant, and `requestMediaUpload`/the wizard's media step would need to read the *greeting's own*
    product's limits, not a hardcoded map — a real, non-trivial code change, not just a pricing tweak.
  - Localized copy for each product's name/description/capability list (`src/messages/{locale}.json`).
- **Database impact:** none to the schema — the tables already support this. Seed data already exists.
- **Checkout impact:** none — already product-agnostic, as noted above. `getDisplayPrice`/`getDefaultProductPrice`
  calls would need to become "price for *this* greeting's chosen product" instead of always the default.
- **Partner commission impact:** commission is a percentage (`commissionRateBps`) of the order's gross amount
  regardless of which product — the *rate* is unaffected, but the *absolute* commission a partner earns per
  sale now varies by which product the sender picked. Worth confirming with partners whether that variability
  is acceptable or whether a per-product commission override is also wanted (the schema's per-partner price
  override already provides a natural place for a per-partner *price* override per product if needed later —
  no schema change required for that either).
- **Customer UX impact:** real, and this is the one to think through most carefully before committing: an
  extra decision point before the sender can start writing their message adds friction (Phase 4's own design
  notes explicitly flagged "avoid extra decision points" as a conversion concern). If capability differences
  are real (e.g. no video on the cheapest tier), the wizard's media step needs honest, visible messaging about
  why an upload option is missing/disabled, not a silent limit.
- **Testing requirements:** new `verify:*`-style coverage for "a greeting's product choice is server-validated,
  never client-trusted," "checkout snapshot uses the greeting's own product's price, not the default,"
  "media-slot limits are enforced per the greeting's actual product," plus new Playwright coverage for the new
  wizard step and its validation states.

## Option C — One base product, optional paid upgrades

Every greeting starts on the current single base product/price; the sender can optionally add paid upgrades
(e.g. "add video," "extra photo slots," "group contributions") at extra cost during the wizard or at checkout.

- **Code changes:** the largest of the three options. This does not map onto the existing `products`/`prices`
  shape at all — a single order today snapshots one product/one price
  (`orders.productId`/`orders.priceId`/`orders.grossAmountMinor`). Upgrades priced independently and summed
  into one checkout total would need either (a) a new `order_line_items`-style table (a real, new schema
  concept, not reusing what exists) or (b) modeling each "upgrade combination" as its own product SKU up front
  (avoids new tables, but doesn't scale cleanly if upgrades can combine freely — 4 base products × several
  optional upgrades becomes a combinatorial product list). Either sub-approach is a genuinely new commercial
  primitive for this codebase, not a variation on Option B.
- **Database impact:** likely a new table and new order-total composition logic; `orders_amounts_reconcile`'s
  existing CHECK constraint (`gross = commission + platform`) would need to keep holding across a
  multi-line-item total — solvable, but is new invariant-design work, not a config change.
- **Checkout impact:** `startCheckout`/`getOrCreateCheckoutOrder` (`src/lib/payments/service.ts`,
  `checkout.ts`) would need real rework to compute and snapshot a summed total from multiple selected
  upgrades, not a single product's price — this is the option that touches the payment-integrity code most
  audited and most test-covered in this codebase (30+ `verify:phase3` assertions), so it carries the highest
  regression risk of the three options.
- **Partner commission impact:** same open question as Option B (commission on a variable total), plus a new
  one: does an upgrade purchased *after* the base greeting was already checked out (if upgrades are allowed
  post-purchase) count as a new order, a modification of the existing one, or a second commission event? This
  needs an explicit answer before any implementation, not a default assumption.
- **Customer UX impact:** potentially the best conversion story (low-friction base purchase, upsell after
  the sender is already emotionally invested in their draft) — but only if the upgrade prompts are well-placed;
  poorly placed, it reads as nickel-and-diming.
- **Testing requirements:** the most extensive of the three — new commission-integrity tests, new
  idempotency tests for the new checkout-total composition, full re-verification of every existing
  `verify:phase0.5/3/5` payment-integrity assertion against the new order shape.

## Recommendation (technical-maintainability perspective only — not a business call)

**Option B**, if a multi-tier catalog is wanted at all, is the right-sized next step: it uses schema, pricing
resolution, and checkout exactly as they already exist and are already tested, and its main new work
(a wizard step, per-product slot limits, server-side product validation) is well-scoped and follows patterns
already established elsewhere in this codebase (the theme-selection step is a near-exact template). Option C
is a materially larger and riskier undertaking — it introduces a new commercial primitive (multi-line-item
orders) into the single most security-and-correctness-tested subsystem in the app, and should only be pursued
if there's a clear product reason Option B's flat per-tier pricing can't satisfy. Option A (do nothing) remains
entirely reasonable if a single flat price is commercially sufficient for the first pilot — nothing about the
current architecture forces a decision here before launch; it was already fully pilot-ready under Option A.

**No implementation of B or C should begin without an explicit go-ahead**, since both change what a partner
actually earns per sale and what a customer is asked to decide before checkout — exactly the two things this
task's instructions named as requiring approval.

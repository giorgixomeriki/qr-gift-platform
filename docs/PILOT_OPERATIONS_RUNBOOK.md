# Pilot Operations Runbook

Day-to-day operating procedures for running the pilot once it's live — who
does what when a partner needs onboarding, a card doesn't work, or something
breaks. This is the "what do I actually do right now" companion to
`docs/PILOT_LAUNCH_CHECKLIST.md` (pre-launch setup) and
`docs/DISASTER_RECOVERY.md` (data-loss/infrastructure scenarios).

## 1. Partner onboarding

Full mechanical steps already live in `PILOT_LAUNCH_CHECKLIST.md` §9–§13
(admin bootstrap, creating the Partner, adding the owner, first QR batch,
physical print test) — this section is the operational sequencing around
those steps, not a duplicate of them.

1. **Before the kickoff call:** confirm an admin account already exists and
   can sign in (§9 is a one-time setup, not per-partner).
2. **On the kickoff call:** create the Partner record (`/admin/partners`)
   live, with the partner's actual name/commission rate agreed in that call
   — don't pre-create speculative partner records that might not match what
   gets agreed.
3. **Same day:** add the partner's real owner by email (§10). Tell them to
   expect an invite email and to check spam — this is the single most common
   "partner says nothing happened" support case (see §3 below).
4. **Within a few days:** the partner (or an admin on their behalf) creates
   their first QR batch and exports the print sheet (§11). Do the physical
   print test (§12) before handing any cards to the partner, not after.
5. **Before cards go out to real customers:** run the real-phone scan test
   (§13) on the actual printed card, not a screen preview.

## 2. Physical QR operations

- Batches are generated in fixed quantities (max 2000 per batch, enforced by
  `qr_batches_quantity_range`) — plan batch sizes around the partner's actual
  print run, not "generate a huge batch just in case." A batch cannot be
  resized after creation; ordering a second batch is the correct move for
  more cards, not trying to edit an existing one.
- `QR_DISTRIBUTED` is a **separate, manually confirmed** event from
  `QR_GENERATED` — a batch existing in the system does not mean cards have
  left the building. Mark codes distributed (`partnerMarkDistributedAction`
  / `adminMarkDistributedAction`) when they actually go out, so the admin
  funnel (`docs/OBSERVABILITY.md`, `admin-metrics.ts`) reflects reality, not
  just "how many were ever printed."
- If a batch is damaged in printing (bad print run, wrong paper, etc.)
  before any card reaches a customer, order a fresh batch — do not attempt
  to reuse or edit the damaged batch's tokens for a reprint of different
  content; a QR token's identity is permanent once generated.
- If one specific already-distributed card is physically damaged (scenario 6
  in `DISASTER_RECOVERY.md`), reprint the **same token** from
  `/print/batch/<batchId>` rather than generating a new one.

## 3. Customer support troubleshooting scripts

For whoever is fielding pilot support questions — a quick diagnostic path
for the failure modes most likely to actually come up, before escalating.

### "The QR code doesn't do anything / shows an error"

1. Ask for the physical card or a photo of it — confirm it's actually from
   this pilot's print run, not a different card.
2. If you can read the token/URL, check its state: is it `not_found`
   (never existed / typo in the printed code — a printing defect, escalate
   to partner ops), `blocked` (moderation action — check
   `/admin/moderation`, this is a deliberate state, not a bug), or does it
   resolve normally when you scan it yourself?
3. If it resolves fine for you but not the customer, this is very likely a
   **device/network issue on their end** — see the mobile QA checklist's
   device list for what's actually been tested; ask what phone/browser
   they're using and compare.

### "I created a greeting but never got a payment confirmation" / "I paid but nothing happened"

1. This is exactly the scenario `PILOT_LAUNCH_CHECKLIST.md` §14 names —
   the browser landing on a return URL is never proof of payment by itself.
2. Look up the order in the admin console (or DB, via the greeting/order id
   if the customer can provide the link they were on). Check its actual
   `status`, not what the customer says they saw.
3. If it's genuinely `PAID` but the Greeting never activated, use the admin
   "reconcile" action (`adminReconcilePaymentAction` — see
   `PILOT_LAUNCH_CHECKLIST.md` §14's own note on this) rather than manually
   editing order state — this asks the payment provider directly what
   actually happened and only activates through the normal path if the
   provider itself confirms success.
4. If it's genuinely not paid, the customer needs to retry checkout — there
   is no way to mark an order paid without the provider (or, in TEST mode,
   the simulate-payment action) actually confirming it, by design.

### "I can't upload my photo/video/voice recording"

1. Ask what the actual error message said — `requestUploadAction`/
   `finalizeMediaUpload` reject specific things for specific reasons (wrong
   MIME type, size limit, slot limit already full) and the message reflects
   which.
2. If the upload UI itself seems frozen/unresponsive rather than showing an
   error, this is very likely a mobile browser/permissions issue (camera/mic
   access denied, or a flaky mobile network mid-upload) — ask them to retry
   on Wi-Fi, and check if it's reproducible on a different device before
   escalating as a code bug.
3. Never ask a customer to reveal their edit-token/URL to "prove" anything
   over chat/email — if you need to look at their draft, do it from the
   admin/DB side using the greeting id they can safely share.

### "The page is in the wrong language"

1. The site's language and the printed card's `defaultLocale` are the
   Partner's configured locale, not the visitor's device language — this is
   intentional (a Partner in Batumi may want Georgian regardless of a
   tourist's phone settings). Confirm what the Partner's `defaultLocale` is
   actually set to before treating this as a bug.
2. The in-page locale switcher changes the current session's language and
   persists via cookie — if it visibly does nothing when clicked, that is a
   real regression (this exact class of bug was found and fixed earlier in
   this engagement — a `revalidatePath` cache-scope issue) and should be
   escalated immediately, not treated as a one-off.

### "The recipient can't see what I made" / "I see a banner I don't understand"

1. Confirm who is looking: the ORIGINAL SENDER revisiting their own
   already-activated Greeting sees a small "your gift is live" banner and
   cannot re-edit it — this is intentional, not a bug (`PILOT_LAUNCH_CHECKLIST.md`
   §16).
2. If a genuine recipient (not the sender) can't see content that should be
   there, check the Greeting's actual status and moderation state in the
   admin console before assuming it's a rendering bug.

## 4. Partner support procedures

- Partners manage their own membership (add/remove/change role) once at
  least one OWNER/ADMIN exists — most "add my colleague" requests should be
  directed to the partner doing it themselves via their dashboard, not
  routed through admin support by default.
- Commission/payout questions: point the partner at their dashboard's own
  unpaid-balance figure first (`PILOT_LAUNCH_CHECKLIST.md` §15) — it's a
  live aggregate, not something support needs to calculate manually.
- A partner reporting "my QR batch numbers look wrong": walk through the
  distinction between `QR_GENERATED` (batch created) and `QR_DISTRIBUTED`
  (manually confirmed handed out) before assuming a data bug — this is the
  single most common point of partner confusion about the funnel.

## 5. Incident response

### Severity levels

- **SEV-1** — payments are broken for all/most customers, or a security
  issue (suspected data exposure, auth bypass). Page whoever holds
  on-call responsibility immediately, regardless of time of day.
- **SEV-2** — a single partner or a subset of functionality is broken
  (e.g. one partner's QR batches 404, media upload broken for one content
  type), but the platform is otherwise healthy. Respond same business day.
- **SEV-3** — a cosmetic issue, a single customer's edge case, or a
  documentation/process gap. Track and fix in normal course of work.

### Example incidents

**SEV-1 example — webhook stops processing payments.**
1. Detect: `logServerError` scope `adminReconcilePaymentAction` or the
   webhook route's own error logs spike, or multiple customers report "I
   paid but nothing happened" in a short window (see §3 script above — if
   this stops being an isolated case, escalate immediately instead of
   working each ticket individually).
2. Check the payment provider's own dashboard/status page — confirm whether
   it's their outage or ours before assuming code is at fault.
3. If it's ours: check recent deploys (`DISASTER_RECOVERY.md` scenario 7)
   and roll back if the timing lines up.
4. Communicate: tell affected partners proactively once the cause is known,
   don't wait for them to ask.

**SEV-1 example — suspected cross-tenant data exposure.**
1. Do not attempt to "quietly patch and move on." Confirm the actual scope
   first (which RLS policy, which table, which partner(s) affected) using
   the admin/superuser connection, not by guessing.
2. If confirmed, this is the highest-severity incident this platform can
   have — every RLS policy exists specifically to prevent this. Fix the
   policy gap immediately, verify with the relevant `verify:*` script(s),
   and only then assess what (if anything) needs disclosing to affected
   partners.

**SEV-2 example — a partner's print sheet renders in the wrong language.**
1. Confirm their `defaultLocale` setting (§3 script above) before assuming
   a bug.
2. If it's genuinely a rendering bug, this is the exact class of issue
   `SetHtmlLang`/`revalidatePath` fixes addressed earlier in this
   engagement — check whether a regression reintroduced the same root cause
   before treating it as new.

**SEV-3 example — a single customer's uploaded photo looks slightly
different than expected after theme rendering.**
Track it, ask for a screenshot and their theme selection, and address in
normal course — this is not a page-someone-at-2am situation.

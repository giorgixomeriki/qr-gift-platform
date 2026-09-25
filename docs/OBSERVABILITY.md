# Observability

## What exists today

Every Server Action's catch block now logs a structured JSON line to stdout
via `src/lib/log.ts`'s `logServerError(scope, err, context)` before returning
its existing `{ ok: false, error }` result to the client. Before this pass, a
failing action returned a friendly message to the browser and logged nothing
server-side at all — an operator had no way to see "checkout is failing at
rate X" from server logs. This is a small, dependency-free addition (plain
`console.error` + `JSON.stringify`), not a logging library or a new paid
service.

Each log line looks like:

```json
{
  "level": "error",
  "scope": "startCheckoutAction",
  "requestId": "5a35...-uuid",
  "message": "A payout already exists for an overlapping period — this looks like a duplicate",
  "greetingId": "b9f1...",
  "timestamp": "2026-09-24T20:56:00.000Z"
}
```

- **`scope`** is always the exact exported action/function name (see the
  full list below) — filter or alert on this field.
- **`requestId`** is a fresh `crypto.randomUUID()` generated per log call, to
  correlate a single failure across multiple log lines if a caller ever logs
  more than once for the same request — not a cross-cutting request ID
  plumbed through every layer (that's a larger change than this pass's scope
  allows without destabilizing the architecture).
- **`context`** is deliberately typed as `Record<string, string | number |
  boolean | null | undefined>` — never `unknown`, never a free-form object.
  This is an intentional type-level constraint, not just a convention: it
  makes it a compile error to pass a password, a reset/edit token, a signed
  URL, or actual greeting content through `context`. Every call site today
  only ever passes id-shaped values (`greetingId`, `orderId`, `partnerId`,
  `memberUserId`, a public QR token). **If you need to log something new,
  widen this type deliberately in `log.ts` and justify it in the same diff —
  don't cast around it.**

### Every scope name currently logging

`startGreetingAction`, `startGreetingAction.rateLimited`, `updateThemeAction`,
`updateMessageAction`, `finalizeUploadAction`, `deleteContentAction`,
`viewPreviewAction`, `getDraftStateAction`, `requestUploadAction`,
`startCheckoutAction`, `simulateTestPaymentAction`, `checkPaymentReturnAction`,
`reconcileActivationsAction`, `adminReconcilePaymentAction`,
`adminRecordPayoutAction`, `adminCreatePartnerAction`,
`adminUpdatePartnerAction`, `adminSetPartnerStatusAction`,
`adminAddPartnerMemberAction`, `adminAddPartnerMemberByEmailAction`,
`adminUpdatePartnerMemberRoleAction`, `adminRemovePartnerMemberAction`,
`partnerAddMemberAction`, `partnerAddMemberByEmailAction`,
`partnerUpdateMemberRoleAction`, `partnerRemoveMemberAction`,
`adminCreateBatchAction`, `partnerCreateBatchAction`,
`partnerMarkDistributedAction`, `adminMarkDistributedAction`,
`lookupGreetingAction`, `listModerationOverviewAction`,
`blockGreetingAction`, `unblockGreetingAction`.

The rate-limit store (`src/lib/rate-limit/store.ts`) also logs its own
`[rate-limit] store check failed for key "..." — failing open` line directly
via `console.error` on a DB error — not through `logServerError`, since it
fires before/outside any action's own try/catch and needs to stay working
even if the rest of the action layer is somehow broken.

## What must never appear in a log line

Passwords, session/reset/edit tokens, signed Storage URLs, raw private media,
or greeting message content. This is enforced by `logServerError`'s own type
signature for everything routed through it — but any new `console.log`/
`console.error` added elsewhere in the codebase does **not** get this
protection automatically. Review any new direct `console.*` call the same
way: does it ever touch a token, a secret, or user-authored content?

## Integration boundary — pointing real monitoring at this

Nothing here talks to an external service, and nothing should be added
silently. Every hosting platform's own log drain already captures stdout —
point it at that, then filter/alert on `level: "error"` and specific `scope`
values (e.g. alert if `startCheckoutAction` or `adminReconcilePaymentAction`
errors exceed some rate). If a paid monitoring/alerting service is wanted
later (Sentry, Datadog, etc.), that is a deliberate, separately-approved
addition — not something this pass introduces implicitly.

## What this pass does not do

- No client-side error reporting (browser exceptions, React error boundaries)
  — only server-side action/route failures.
- No metrics/APM (latency histograms, throughput dashboards) — only
  structured error logs.
- No log retention/rotation policy — that's the hosting platform's log drain
  configuration, not application code.

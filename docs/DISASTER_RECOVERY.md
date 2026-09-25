# Disaster Recovery

Documented procedures for the failure scenarios most likely to actually
happen during the pilot. **This is a procedure, not a tested drill.** No
destructive restore/reset has been run against any real database as part of
writing this document — running one against the shared local dev database
without a disposable copy first would risk the accumulated fixture history
and dev-bootstrap accounts other work in this repo depends on. Where a step
below says "restore from backup," that capability's actual availability
depends on the hosting Supabase project's plan/configuration and must be
confirmed for real (see `docs/PILOT_LAUNCH_CHECKLIST.md` §3) before the pilot
goes live — this document assumes it exists, it does not create it.

Cross-references: `docs/PILOT_LAUNCH_CHECKLIST.md` §3 (migration/backup
procedure), §8 (production database safety), §18 (rollback/contact plan).

---

## 1. Database corruption / bad state

**Detection:** Application errors referencing constraint violations that
shouldn't be possible, `verify:*` scripts failing against production-shaped
data, or a partner/admin reporting data that doesn't match what they did.

**Immediate action:** Do not run any write against the affected table until
the scope is understood. Capture the exact error and affected row ids first
— `logServerError`'s structured output (`docs/OBSERVABILITY.md`) is the
first place to look, since every Server Action failure is already logged
with a `scope` and relevant ids.

**Recovery:** If the corruption is a small number of rows with a known
cause, prefer a targeted, reviewed `UPDATE`/`DELETE` via
`MIGRATIONS_DATABASE_URL` over a full restore. If the cause or scope is
unknown, restore from the most recent point-in-time backup to a **separate**
scratch database first, diff it against production to understand exactly
what changed, then decide the minimal corrective action — never restore
directly over the live production database as a first move.

**Verification:** Re-run the relevant `verify:*` script(s) against the
now-corrected state; confirm the specific data the original report
complained about is now correct.

**Rollback:** If a corrective write itself turns out to be wrong, the same
backup taken before starting is the fallback — this is why the immediate
action step above happens before any write.

---

## 2. Failed migration

**Detection:** `npm run db:migrate` exits non-zero, or exits zero but the
app then fails to start / errors on first RLS-gated query.

**Immediate action:** Do not attempt to manually patch the database into the
state the migration intended — this is exactly the "silent, undocumented
drift from what the migration files say" trap. Read the actual error first.

**Recovery:** Migrations in this codebase are **forward-only by design**
(no `db:reset`/`db:rollback` script exists — see `PILOT_LAUNCH_CHECKLIST.md`
§3). A failed migration is fixed by writing and applying a new, corrective
forward migration — never by hand-editing `src/db/migrations/meta/_journal.json`
to pretend it didn't run, which desyncs Drizzle's own tracking from reality.
If the migration partially applied (e.g. failed halfway through a multi-statement
file) and left the schema in a state no forward migration can cleanly
build on, restore the pre-migration backup (see §3's backup requirement
"before any migration that alters or drops a column/table") to a scratch
database, confirm the intended end-state there with the corrective migration
applied, then apply that same corrective migration to production.

**Verification:** `npm run db:migrate` completes cleanly; `npm run
typecheck` and the full `verify:*` suite pass against the now-migrated
database.

**Rollback:** The pre-migration backup (required by checklist §3) is the
rollback path — there is no in-database "undo."

---

## 3. Deleted/lost media object (Storage)

**Detection:** A signed read URL 404s, or `finalizeMediaUpload`'s own
integrity check (`verifyUploadedContentMatchesMime`) starts failing for
objects that previously succeeded.

**Immediate action:** Confirm scope — one object, one Greeting's objects, or
bucket-wide — by checking the Supabase Storage dashboard directly, not just
inferring from one user report.

**Recovery:** This platform does not maintain its own copy of uploaded media
outside Supabase Storage — there is no separate CDN cache or backup bucket
to fall back to today. If the object is genuinely gone (not a signed-URL
expiry, which is expected and by design), the affected sender's only
recovery path is re-uploading that piece of content via their still-valid
edit-token session (if the Greeting is still `DRAFT`) — there is no way to
recover already-lost bytes for an `ACTIVE` Greeting's media. This is a real
gap this document is naming explicitly, not papering over: **there is
currently no automated Storage backup/replication configured**. If this
risk is judged unacceptable for the pilot's scale, enabling Supabase
Storage's own backup/versioning options (plan-dependent) is a separate,
explicit decision to make before launch, not something this pass adds
silently.

**Verification:** The re-uploaded content passes `finalizeMediaUpload`'s
integrity check and renders correctly in the recipient view.

**Rollback:** Not applicable — there is nothing to roll back to once an
object is genuinely gone; see the gap noted above.

---

## 4. Lost admin access

**Detection:** No account can sign in at `/admin/login`, or the last known
admin's account is locked out (forgotten password with a broken email path,
or the account itself was deleted from Supabase Auth).

**Immediate action:** Confirm this is really "zero working admins," not "one
admin locked out while others still work" — check `admin_users` directly via
`MIGRATIONS_DATABASE_URL`: `select user_id from admin_users;`, then check
which of those still have a working Supabase Auth entry.

**Recovery:** There is deliberately no in-app "recover admin access" flow —
`admin_users` membership is only ever granted by a direct superuser insert
(see `PILOT_LAUNCH_CHECKLIST.md` §9). To recover: create or identify a
Supabase Auth user for the person who should regain access (dashboard →
Authentication), then `insert into admin_users (user_id) values ('<uid>');`
via `MIGRATIONS_DATABASE_URL`. This requires direct database access — whoever
holds `MIGRATIONS_DATABASE_URL` for the environment in question is the actual
recovery mechanism, which is exactly why that credential is called out in
checklist §8 as one to restrict and guard carefully.

**Verification:** The recovered/new admin can sign in at `/admin/login` and
reach the dashboard.

**Rollback:** Not applicable — this is purely additive (granting access),
nothing to undo unless the wrong user was granted admin, in which case
`delete from admin_users where user_id = '<uid>';` reverses it.

---

## 5. Lost partner access

**Detection:** A Partner's OWNER can't sign in, or a Partner has zero
remaining members with the OWNER/ADMIN role able to manage membership.

**Immediate action:** Confirm via `partner_members` whether ANY member with
`OWNER` or `ADMIN` role still has working credentials — if so, they can
re-add the locked-out person themselves via the existing "add member by
email" flow (`partnerAddMemberByEmailAction`), no superuser intervention
needed.

**Recovery:** If truly zero manage-capable members remain, an admin can add
a member on the Partner's behalf via `adminAddPartnerMemberByEmailAction`
(the admin-console equivalent, already gated by `requireAdmin` +
rate-limited per `docs/OBSERVABILITY.md`/Phase 1's rate-limit classification)
— set the re-added person's role to `OWNER` via
`adminUpdatePartnerMemberRoleAction`. This does not require direct database
access, unlike the lost-admin-access scenario, because the admin console
already exposes a legitimate path for it.

**Verification:** The recovered person can sign in at `/partner/login`,
reach the dashboard, and (if given OWNER/ADMIN) manage membership themselves
going forward.

**Rollback:** `adminRemovePartnerMemberAction` reverses an incorrect grant.

---

## 6. Damaged/unreadable data behind a printed QR code

**Detection:** A recipient or sender reports the QR won't scan, or scans to
a "not found" page despite the card being handed out.

**Immediate action:** Confirm the QR's `public_token` actually exists in
`qr_codes` (via an admin lookup, or directly: `select status,
distribution_status from qr_codes where public_token = '<token from the
card, if legible>';`). A truly unreadable/damaged physical code (torn,
smudged past recognition) has no token to look up at all — that's a
physical-object problem, not a data problem.

**Recovery:** If the QR code and its underlying data are intact but the
**physical print** is damaged, generate a fresh printed copy of the same
code from `/print/batch/<batchId>` (the public token and its QR image are
deterministic from the same `qr_codes` row — reprinting produces an
identical, still-valid code, not a new one) and physically replace the card.
If the underlying `qr_codes`/`greetings` row itself is corrupted, treat it
under scenario 1 (database corruption) instead — this scenario is
specifically about the physical artifact, not the data.

**Verification:** The reprinted card scans successfully end-to-end.

**Rollback:** Not applicable — reprinting is non-destructive; nothing to
undo.

---

## 7. Bad deploy regression

**Detection:** Error rates or specific `logServerError` scopes spike
immediately after a deploy, `curl -I` against the live origin shows missing
security headers, or a manual golden-path check
(`docs/STAGING_SETUP_RUNBOOK.md` §4) fails post-deploy.

**Immediate action:** Confirm it's actually the deploy and not a coincident,
unrelated issue (e.g. the Supabase project itself having a problem) by
checking whether the timing lines up with the deploy specifically.

**Recovery:** Roll back to the previous build on the hosting platform
(`PILOT_LAUNCH_CHECKLIST.md` §18 — "know how to do this before launch day,
not during an incident"). This app has no in-database state that a code
rollback would desync from, since migrations are applied as their own
separate, deliberate step (§3) rather than automatically on deploy — so
rolling back the app code alone is safe and does not require a matching
database rollback, unless the bad deploy itself was paired with a migration
(in which case treat the migration side under scenario 2).

**Verification:** Re-run the post-deploy checks from
`docs/STAGING_SETUP_RUNBOOK.md` §4 against the rolled-back build; confirm
the error rate/symptom that triggered this is gone.

**Rollback of the rollback:** Once the underlying bug is fixed and verified
(full regression suite — `docs/PILOT_OPERATIONS_RUNBOOK.md`'s own deploy
checklist, once written), redeploy forward normally.

---

## What this document deliberately does not claim

No scenario above has been rehearsed against a real database in this
session. "Recovery" steps describe the correct procedure given this
codebase's actual architecture (forward-only migrations, no in-app admin
recovery flow, Supabase-managed backups) — they are not a report that a
drill was run and succeeded. Before the pilot goes live, at least the
database-restore path (scenarios 1 and 2) should be rehearsed for real
against a disposable scratch database or Supabase branch, not the shared
local dev database and not production.

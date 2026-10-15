# Shared local dev DB: migration repair plan

Status: **plan, rehearsed on a copy, NOT applied.** This applies only to the shared
**local** Supabase database (`postgres` on `127.0.0.1:54322`), never staging or
production. It needs the owner's approval before it is run.

## What's wrong (inspected read-only, 2026-10-15)

The uncommitted BOG work in `/Users/Shared/qr-gift-platform` ran its migration on
this DB under the tag `0018_payment_refunds`. After the renumbering (PR #6) that
SQL is `0019_payment_refunds`. The file is byte-identical, so it has the same
hash (`5bc7d527…`) and the same `when` (`1790486880000`). The ledger
`drizzle.__drizzle_migrations` therefore already looks like 0019 is applied.

PR #5's `0018_partner_pricing_controls` (`when` `1790400540000`) was **never applied**.
Drizzle only applies migrations whose `when` is later than the newest recorded
one, so `npm run db:migrate` would **silently skip it forever**. That means:

- no price immutability trigger;
- no one-active-price indexes;
- no admin-only commission trigger.

Preconditions for 0018, all checked read-only:

- 0 duplicate active default prices;
- 0 duplicate active overrides;
- 0 non-positive prices;
- none of 0018's objects exist yet;
- no public FK points at `auth.*`.

Unrelated hygiene finding: the ledger rows for `0001` and `0011` carry older hashes
than the current files. Those files were edited after this DB applied them.
Drizzle doesn't check hashes, and the schema matches a fresh migrate (below), so
there's no effect. Don't edit applied migration files in future.

## Repair (no reset, no data loss)

`scripts/ops/repair-shared-dev-db.sql` runs in **one transaction**. It:

1. Guards on the expected state. It stops if 0018 is already recorded, or if
   0019 isn't recorded as expected.
2. Runs `src/db/migrations/0018_partner_pricing_controls.sql` verbatim.
3. Records it in `drizzle.__drizzle_migrations` with its real hash and `when`.

Any error rolls back everything, and the index creation itself refuses
duplicate active prices.

```sh
# from a checkout that contains PR #5 and #6, with .env.local loaded
docker exec supabase_db_QR pg_dump -U postgres -d postgres -Fc -f /tmp/pre-repair-$(date +%F).dump   # backup first
psql "$MIGRATIONS_DATABASE_URL" -f scripts/ops/repair-shared-dev-db.sql
npm run db:migrate          # expected: no-op
```

**Do not** run the #5/#6 `verify:*` suites against this DB before the repair.
Without 0018's unique indexes they can create duplicate active prices, and the
repair then (correctly) refuses until those are cleaned up. This was observed in
the rehearsal.

## Rehearsal evidence (2026-10-15, on a copy: `qr_repair_rehearsal`)

| Step | Result |
|---|---|
| Copy made with `pg_dump` of `public` + `drizzle` (read-only on the shared DB), restored with grants | ✅ 924 partners, 19 ledger rows |
| Repair script | ✅. A second run is refused by the guard |
| `db:migrate` afterwards | ✅ no-op (20 ledger rows) |
| `pg_dump --schema-only` vs a freshly migrated DB (`qr_audit_r1`) | **identical** (apart from pg_dump's random `\restrict` token and the default schema comment) |
| Suites on the repaired copy | ✅ partner-pricing 70/70, bog-integration 42/42, payment-integrity 45/45, pilot-protections 39/39, phase5 41/41, payout-items 49/49 |

## Not part of the repair

- **Dev data:** this DB's platform default price is still **15.00 GEL** (an older
  seed), so `ops:check-launch-pricing` reports it. Changing it is a data decision.
  Use the Super Admin pricing screen (audited) after the repair if wanted.
- **The full reset alternative** (`supabase db reset`, then migrate, seed and
  `db:dev-bootstrap`) also works, but it **destroys all local data**. Use it only
  if the owner prefers a clean slate.

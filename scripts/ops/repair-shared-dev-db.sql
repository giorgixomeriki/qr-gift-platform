-- Repair for the shared LOCAL dev DB only (never staging/production).
-- State before: migrations 0000–0017 + payment_refunds (byte-identical to 0019,
-- recorded with 0019's hash and `when`), but 0018_partner_pricing_controls
-- never applied — drizzle skips it because a later `when` is already recorded.
-- Effect: applies 0018's SQL exactly and records it, in one transaction.
\set ON_ERROR_STOP on
begin;
-- Guard: only run against the expected state.
do $$
begin
  if exists (select 1 from drizzle.__drizzle_migrations where hash = '855a9dc390e323ffcb491c82d2d87e4ed45108b4abd60d1170779c76e4524b4a') then
    raise exception 'repair: 0018_partner_pricing_controls is already recorded — nothing to do';
  end if;
  if not exists (select 1 from drizzle.__drizzle_migrations where hash = '5bc7d527a1e549ddd9c22dfc8eac33001ac152384627284ce0df383f8609c59d' and created_at = 1790486880000) then
    raise exception 'repair: payment_refunds (0019) is not recorded as expected — stop and re-inspect';
  end if;
end $$;
\i src/db/migrations/0018_partner_pricing_controls.sql
insert into drizzle.__drizzle_migrations (hash, created_at)
  values ('855a9dc390e323ffcb491c82d2d87e4ed45108b4abd60d1170779c76e4524b4a', 1790400540000);
commit;

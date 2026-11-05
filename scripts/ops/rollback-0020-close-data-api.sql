-- =============================================================================
-- FULL rollback of migration 0020_close_data_api (SEC-01)
-- =============================================================================
-- !! This RE-OPENS the vulnerability 0020 closes: anyone holding the public
-- anon key can again list every QR token, read ACTIVE greeting content and
-- reset rate limits through the Supabase Data API. Use it only if 0020 breaks
-- something that a targeted fix cannot (docs/security/SEC-01_DATA_API_LOCKDOWN.md
-- §Recovery lists those first), and only while the site is behind the
-- owner-review gate AND `public` is removed from the Data API's exposed
-- schemas. Then fix forward with a new migration.
--
-- Restores exactly the grant state audited on the hosted project on
-- 2026-10-18 (Supabase defaults), and un-registers 0020 so a later
-- `npm run db:migrate` re-applies it.
--
-- Run as postgres in ONE transaction:
--   psql "$MIGRATIONS_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/ops/rollback-0020-close-data-api.sql

grant usage on schema public to public;
grant usage on schema public to anon, authenticated;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proowner = (select oid from pg_roles where rolname = current_user)
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('grant execute on function %s to anon, authenticated, service_role', fn.sig);
  end loop;
end
$$;

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;

do $$
declare
  pol record;
begin
  for pol in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('alter policy %I on public.%I to public', pol.policyname, pol.tablename);
  end loop;
end
$$;

-- drizzle records a migration by its journal `when` (folderMillis).
delete from drizzle.__drizzle_migrations where created_at = 1792310400000;

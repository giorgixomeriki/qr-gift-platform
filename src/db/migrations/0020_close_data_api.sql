-- =============================================================================
-- SEC-01: close the Supabase Data API over the application schema
-- =============================================================================
-- The app reaches its tables only as app_runtime over a direct Postgres
-- connection (src/db/client.ts). Supabase additionally serves the `public`
-- schema over PostgREST (/rest/v1, /rest/v1/rpc) and pg_graphql (/graphql/v1)
-- as the roles anon, authenticated and service_role — and on a hosted project
-- its default privileges grant those roles ALL on every table, sequence and
-- function created in `public`. The anon key ships in the browser bundle
-- (login form), so whatever anon can reach, anyone can reach.
--
-- Every policy since 0001 was written for app_runtime and applies TO public,
-- several of them deliberately open (qr_codes_select USING (true),
-- rate_limit_hits_* USING (true), audit_logs_insert / analytics_events_insert
-- WITH CHECK (true)) on the premise that no listing endpoint exists. Through
-- the Data API one did: anyone could list every QR token, read ACTIVE greeting
-- content, delete or reset rate-limit counters, forge audit/analytics/report
-- rows and call the app_* helpers over RPC; the service-role key could do all
-- of that past RLS. Measured on the hosted project and on a local replica of
-- its grants (scripts/verify-data-api-lockdown.ts).
--
-- Nothing in the app, its scripts or Supabase Auth/Storage uses the Data API
-- over `public` (supabase-js is used only for auth.* and storage.*), so these
-- roles need nothing here. Four independent layers, any one of which closes
-- the hole on its own:
--   1. no table / sequence / function privilege for anon, authenticated or
--      service_role on existing objects;
--   2. no USAGE on schema public for anon / authenticated — including through
--      PUBLIC, which every role inherits — so objects created later by ANY
--      owner (e.g. supabase_admin, whose default privileges this migration's
--      role cannot change) stay unreachable;
--   3. postgres's default privileges in public stop granting to those roles;
--   4. every RLS policy applies TO app_runtime only, so a privilege that
--      comes back by accident still yields zero rows / zero writes.
-- The DO block at the end refuses to commit unless all four hold.
--
-- Not changed: app_runtime's privileges (it already holds explicit USAGE,
-- table DML and EXECUTE on its helpers), postgres / service_role schema USAGE,
-- and every schema other than public (auth, storage, graphql_public, …).
-- Recovery: docs/security/SEC-01_DATA_API_LOCKDOWN.md.

-- 1. Existing objects ---------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

do $$
declare
  fn record;
begin
  -- Application functions only: extension members (btree_gist) belong to
  -- supabase_admin and are covered by layer 2.
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proowner = (select oid from pg_roles where rolname = current_user)
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from anon, authenticated, service_role', fn.sig);
  end loop;
end
$$;

-- 2. The schema ---------------------------------------------------------------
revoke usage on schema public from anon, authenticated;
revoke usage on schema public from public;

-- 3. Future objects -------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;

-- 4. Policies -------------------------------------------------------------------
do $$
declare
  pol record;
begin
  for pol in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('alter policy %I on public.%I to app_runtime', pol.policyname, pol.tablename);
  end loop;
end
$$;

-- Fail closed ---------------------------------------------------------------------
do $$
declare
  leaks text;
begin
  if has_schema_privilege('anon', 'public', 'usage') or has_schema_privilege('authenticated', 'public', 'usage') then
    raise exception 'SEC-01: anon/authenticated still have USAGE on schema public';
  end if;

  select string_agg(distinct grantee || ':' || table_name, ', ') into leaks
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
  if leaks is not null then
    raise exception 'SEC-01: Data API roles still hold table privileges: %', leaks;
  end if;

  select string_agg(a.grantee::regrole::text || ':' || d.defaclobjtype::text, ', ') into leaks
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  where n.nspname = 'public' and d.defaclrole = (select oid from pg_roles where rolname = 'postgres')
    and a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role'));
  if leaks is not null then
    raise exception 'SEC-01: postgres default privileges still grant: %', leaks;
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and roles <> '{app_runtime}'::name[]) then
    raise exception 'SEC-01: a public policy still applies beyond app_runtime';
  end if;

  if not has_schema_privilege('app_runtime', 'public', 'usage')
     or not has_table_privilege('app_runtime', 'public.qr_codes', 'select')
     or not has_function_privilege('app_runtime', 'public.app_is_admin()', 'execute') then
    raise exception 'SEC-01: app_runtime lost access it needs';
  end if;
end
$$;

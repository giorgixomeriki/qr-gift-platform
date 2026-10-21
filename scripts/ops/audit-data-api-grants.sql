-- Read-only grant / RLS audit for the public schema (SEC-01). Safe on production:
--   psql "$MIGRATIONS_DATABASE_URL" -XAq -f scripts/ops/audit-data-api-grants.sql
set default_transaction_read_only = on;
\echo '== server version'
show server_version;
\echo '== schema ACLs (public, graphql_public, extensions, storage)'
select nspname, pg_get_userbyid(nspowner) owner, nspacl from pg_namespace where nspname in ('public','graphql_public','storage','extensions') order by 1;
\echo '== object owners in public'
select c.relkind, pg_get_userbyid(c.relowner) owner, count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','S','p','f') group by 1,2 order by 1,2;
select pg_get_userbyid(p.proowner) fn_owner, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' group by 1;
\echo '== extensions'
select extname, n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1;
\echo '== table privileges for anon/authenticated/PUBLIC (count of tables per privilege)'
select grantee, privilege_type, count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','PUBLIC','service_role') group by 1,2 order by 1,2;
\echo '== column-level grants to anon/authenticated'
select grantee, count(*) from information_schema.column_privileges where table_schema='public' and grantee in ('anon','authenticated') group by 1;
\echo '== sequences usable by anon/authenticated'
select c.relname, c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S';
\echo '== functions executable by anon (non-extension)'
select p.proname, p.prosecdef secdef, has_function_privilege('anon',p.oid,'execute') anon_exec, has_function_privilege('authenticated',p.oid,'execute') auth_exec, p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1;
\echo '== default ACLs'
select pg_get_userbyid(defaclrole) for_role, coalesce(n.nspname,'<all>') schema, defaclobjtype, defaclacl from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace order by 1,2,3;
\echo '== RLS status per table'
select c.relname, c.relrowsecurity rls, c.relforcerowsecurity force from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1;
\echo '== policy roles'
select roles, count(*) from pg_policies where schemaname='public' group by 1;
\echo '== app_runtime privileges summary'
select privilege_type, count(*) from information_schema.role_table_grants where table_schema='public' and grantee='app_runtime' group by 1;
select has_schema_privilege('app_runtime','public','usage') app_runtime_usage, has_schema_privilege('anon','public','usage') anon_usage, has_schema_privilege('authenticated','public','usage') auth_usage;
\echo '== role memberships of app_runtime / anon / authenticated / authenticator'
select r.rolname, array(select b.rolname from pg_auth_members m join pg_roles b on b.oid=m.roleid where m.member=r.oid) member_of, r.rolinherit, r.rolbypassrls from pg_roles r where r.rolname in ('app_runtime','anon','authenticated','authenticator','service_role','postgres');
\echo '== views / matviews in public'
select table_name from information_schema.views where table_schema='public';
\echo '== storage policies / buckets'
select id, public, file_size_limit from storage.buckets;
select policyname, roles, cmd from pg_policies where schemaname='storage';

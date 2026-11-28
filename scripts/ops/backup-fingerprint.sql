-- Backup fingerprint (scripts/ops/prod-backup.sh). Read-only.
-- One line per item, "key<TAB>value", sorted. Run against the source before
-- and after pg_dump and against the restored copy; equal lines = equal state.
-- Volatile tables (written by live traffic during the dump) show up as a
-- pre/post difference on the source and are reported, not failed.
set default_transaction_read_only = on;
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'

with items(k, v) as (
  -- ── schema ────────────────────────────────────────────────────────────
  select 'schema:columns:' || table_schema || '.' || table_name,
         md5(string_agg(column_name || ' ' || data_type || ' ' || coalesce(udt_name, '') || ' ' || is_nullable || ' ' || coalesce(column_default, ''), ',' order by ordinal_position))
    from information_schema.columns
   where table_schema in ('public', 'drizzle')
   group by table_schema, table_name
  union all
  select 'schema:constraints', count(*) || ' ' || md5(coalesce(string_agg(c.conrelid::regclass || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid), '|' order by c.conrelid::regclass::text, c.conname), ''))
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'
  union all
  select 'schema:indexes', count(*) || ' ' || md5(coalesce(string_agg(indexdef, '|' order by indexdef), ''))
    from pg_indexes where schemaname = 'public'
  union all
  select 'schema:policies', count(*) || ' ' || md5(coalesce(string_agg(schemaname || '.' || tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, ''), '|' order by schemaname, tablename, policyname), ''))
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'schema:rls', md5(string_agg(c.relname || ' ' || c.relrowsecurity || ' ' || c.relforcerowsecurity, '|' order by c.relname))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'schema:triggers', count(*) || ' ' || md5(coalesce(string_agg(pg_get_triggerdef(t.oid), '|' order by t.tgrelid::regclass::text, t.tgname), ''))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'public'
  union all
  select 'schema:functions', count(*) || ' ' || md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname, pg_get_function_identity_arguments(p.oid)), ''))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p')
  union all
  select 'schema:enums', md5(string_agg(t.typname || '=' || e.enumlabel, '|' order by t.typname, e.enumsortorder))
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public'
  union all
  select 'schema:grants', count(*) || ' ' || md5(coalesce(string_agg(grantee || ' ' || table_name || ' ' || privilege_type, '|' order by grantee, table_name, privilege_type), ''))
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'app_runtime', 'service_role', 'PUBLIC')
  -- ── data: exact row count + full-content hash of every table ─────────
  union all
  select 'rows:' || n.nspname || '.' || c.relname,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and n.nspname in ('public', 'drizzle', 'auth', 'storage')
  union all
  select 'hash:' || n.nspname || '.' || c.relname,
         (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) as h from %I.%I t', '|', '', n.nspname, c.relname), false, true, '')))[1]::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and n.nspname in ('public', 'drizzle')
  union all
  select 'hash:auth.users', md5(coalesce(string_agg(id::text || ' ' || coalesce(email, '') || ' ' || coalesce(encrypted_password, ''), '|' order by id), '')) from auth.users
  union all
  select 'hash:auth.mfa_factors', md5(coalesce(string_agg(id::text || ' ' || user_id || ' ' || status, '|' order by id), '')) from auth.mfa_factors
  union all
  select 'hash:storage.objects', md5(coalesce(string_agg(bucket_id || '/' || name, '|' order by bucket_id, name), '')) from storage.objects
  -- ── money: per-status totals (readable evidence) ──────────────────────
  union all
  select 'money:orders:' || status, count(*) || ' gross=' || sum(gross_amount_minor) || ' commission=' || sum(partner_commission_minor) || ' platform=' || sum(platform_share_minor)
    from orders group by status
  union all
  select 'money:payments:' || provider || ':' || status, count(*) || ' amount=' || sum(amount_minor) from payments group by provider, status
  union all
  select 'money:ledger:' || type, count(*) || ' amount=' || sum(amount_minor) from partner_ledger_entries group by type
  union all
  select 'money:refunds:' || status, count(*) || ' amount=' || sum(amount_minor) from payment_refunds group by status
  union all
  select 'money:payouts', count(*)::text from partner_payouts
  union all
  select 'money:prices:active', count(*) || ' ' || md5(coalesce(string_agg(coalesce(partner_id::text, 'default') || ' ' || amount_minor || ' ' || currency, '|' order by partner_id nulls first, amount_minor), '')) from prices where active
  union all
  select 'ledger:migrations', count(*) || ' max=' || max(created_at) from drizzle.__drizzle_migrations
)
select k, v from items order by k;

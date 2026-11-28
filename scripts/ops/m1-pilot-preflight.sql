-- Read-only preflight for the 1.00 GEL M1 pilot (docs/bog-release/M1_PILOT_1GEL.md §3).
--   psql "$MIGRATIONS_DATABASE_URL" -v qr=<pilot qr_codes.id> -f scripts/ops/m1-pilot-preflight.sql
-- Every value in the "gates" row must be true before CHECKOUT_PILOT_* is set.
set default_transaction_read_only = on;
\pset footer off
\echo '-- pilot card'
select q.status, q.distribution_status, p.slug as partner, p.status as partner_status, p.commission_rate_bps
  from qr_codes q join partners p on p.id = q.partner_id where q.id = :'qr';
\echo '-- gates (all must be true)'
select
  (select status from qr_codes where id = :'qr') = 'AVAILABLE' as card_available,
  (select count(*) from orders where qr_code_id = :'qr') = 0 as card_has_no_order,
  (select count(*) from greetings where qr_code_id = :'qr') = 0 as card_has_no_greeting,
  (select p.status = 'ACTIVE' and p.commission_rate_bps = 3000 from qr_codes q join partners p on p.id = q.partner_id where q.id = :'qr') as partner_active_30pct,
  (select x.amount_minor from prices x join products pr on pr.id = x.product_id
     where pr.key = 'PREMIUM_GREETING' and x.partner_id is null and x.active) = 1000 as public_price_10_gel,
  not exists (select 1 from prices x join qr_codes q on q.partner_id = x.partner_id where q.id = :'qr' and x.active) as no_partner_price_override,
  (select count(*) from orders where status = 'PENDING_PAYMENT') = 0 as no_open_orders_anywhere,
  (select count(*) from cron.job where active) = 3 as cron_jobs_active,
  (select enabled from private.reconcile_target) as cron_target_enabled,
  (select max(created_at) from audit_logs where action = 'PAYMENT_RECONCILE_RUN' and metadata->>'ok' = 'true') > now() - interval '75 minutes' as reconcile_recent_ok;
\echo '-- money baseline (copy into the evidence file)'
select status, count(*), sum(gross_amount_minor) from orders group by status order by 1;
select provider, status, count(*), sum(amount_minor) from payments group by 1, 2 order by 1, 2;
select type, count(*), sum(amount_minor) from partner_ledger_entries group by type order by 1;
select count(*) as refunds from payment_refunds;
select status, count(*) from qr_codes group by status order by 1;
select count(*) as migrations from drizzle.__drizzle_migrations;

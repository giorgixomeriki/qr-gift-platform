-- Read-only M1 verification (docs/bog-release/M1_PRODUCTION_PAYMENT.md §4).
--   psql "$MIGRATIONS_DATABASE_URL" -v qr=<pilot qr_codes.id> -f scripts/ops/m1-verify.sql
-- Prints statuses and amounts only: no customer text, no tokens, no card data.
set default_transaction_read_only = on;
\pset footer off
\echo '-- pilot card'
select q.status as qr_status, q.distribution_status, q.activated_at, p.slug as partner
  from qr_codes q join partners p on p.id = q.partner_id where q.id = :'qr';
\echo '-- greeting(s) on the card'
select g.status, g.created_at from greetings g where g.qr_code_id = :'qr' order by g.created_at;
\echo '-- orders (expect exactly one PAID, 1000 GEL, commission 300, platform 700)'
select o.id, o.status, o.currency, o.gross_amount_minor, o.partner_commission_minor, o.platform_share_minor, o.commission_rate_bps, o.created_at
  from orders o where o.qr_code_id = :'qr' order by o.created_at;
\echo '-- payments (expect one BOG SUCCEEDED 1000; failed/expired attempts may precede it)'
select p.provider, p.status, p.amount_minor, p.currency, p.confirmed_at, (p.provider_payment_id is not null) as has_bog_ref
  from payments p join orders o on o.id = p.order_id where o.qr_code_id = :'qr' order by p.created_at;
\echo '-- consent evidence (expect one row per bank attempt opened)'
select c.locale, c.accepted_at from checkout_consents c join orders o on o.id = c.order_id where o.qr_code_id = :'qr' order by c.accepted_at;
\echo '-- ledger (expect exactly one COMMISSION_EARNED 300)'
select l.type, l.amount_minor, l.created_at from partner_ledger_entries l join orders o on o.id = l.order_id where o.qr_code_id = :'qr' order by l.created_at;
\echo '-- refunds (expect none)'
select r.status, r.amount_minor from payment_refunds r join orders o on o.id = r.order_id where o.qr_code_id = :'qr';
\echo '-- invariants (all must be true)'
select
  (select count(*) from orders o where o.qr_code_id = :'qr' and o.status = 'PAID') = 1 as one_paid_order,
  (select count(*) from payments p join orders o on o.id = p.order_id where o.qr_code_id = :'qr' and p.status = 'SUCCEEDED') = 1 as one_succeeded_payment,
  (select count(*) from partner_ledger_entries l join orders o on o.id = l.order_id where o.qr_code_id = :'qr' and l.type = 'COMMISSION_EARNED') = 1 as one_commission,
  (select status from qr_codes where id = :'qr') = 'ACTIVE' as card_active,
  (select count(*) from greetings g where g.qr_code_id = :'qr' and g.status = 'ACTIVE') = 1 as greeting_active;
\echo '-- platform-wide totals (compare with the baseline in the runbook)'
select status, count(*), sum(gross_amount_minor) from orders group by status order by 1;
select type, count(*), sum(amount_minor) from partner_ledger_entries group by type order by 1;
\echo '-- reconciliation (last 3 heartbeats)'
select created_at, metadata->>'ok' as ok, metadata->>'remaining' as remaining from audit_logs where action = 'PAYMENT_RECONCILE_RUN' order by created_at desc limit 3;

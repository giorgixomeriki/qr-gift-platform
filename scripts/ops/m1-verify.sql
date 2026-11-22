-- Read-only M1 verification (docs/bog-release/M1_PRODUCTION_PAYMENT.md §4).
--   psql "$MIGRATIONS_DATABASE_URL" -v qr=<pilot qr_codes.id> -v amount=<tetri> -f scripts/ops/m1-verify.sql
--   amount = the expected charge: 100 for the 1.00 GEL pilot (CHECKOUT_PILOT_PRICE_MINOR), 1000 without it.
-- Prints statuses and amounts only: no customer text, no tokens, no card data.
set default_transaction_read_only = on;
\pset footer off
\echo '-- pilot card'
select q.status as qr_status, q.distribution_status, q.activated_at, p.slug as partner
  from qr_codes q join partners p on p.id = q.partner_id where q.id = :'qr';
\echo '-- greeting(s) on the card'
select g.status, g.created_at from greetings g where g.qr_code_id = :'qr' order by g.created_at;
\echo '-- orders (expect exactly one PAID at :amount; 100 → commission 30, platform 70; price_id empty for a pilot price)'
select o.id, o.status, o.currency, o.gross_amount_minor, (o.price_id is null) as pilot_priced, o.partner_commission_minor, o.platform_share_minor, o.commission_rate_bps, o.created_at
  from orders o where o.qr_code_id = :'qr' order by o.created_at;
\echo '-- payments (expect one BOG SUCCEEDED at :amount; failed/expired attempts may precede it)'
select p.provider, p.status, p.amount_minor, p.currency, p.confirmed_at, (p.provider_payment_id is not null) as has_bog_ref
  from payments p join orders o on o.id = p.order_id where o.qr_code_id = :'qr' order by p.created_at;
\echo '-- consent evidence (expect one row per bank attempt opened)'
select c.locale, c.accepted_at from checkout_consents c join orders o on o.id = c.order_id where o.qr_code_id = :'qr' order by c.accepted_at;
\echo '-- ledger (expect exactly one COMMISSION_EARNED = floor(:amount × rate))'
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
\echo '-- amount invariants (all must be true)'
select
  (select o.gross_amount_minor from orders o where o.qr_code_id = :'qr' and o.status = 'PAID') = :amount as order_amount,
  (select o.currency from orders o where o.qr_code_id = :'qr' and o.status = 'PAID') = 'GEL' as order_gel,
  (select o.partner_commission_minor = floor(o.gross_amount_minor * o.commission_rate_bps / 10000.0)
          and o.platform_share_minor = o.gross_amount_minor - o.partner_commission_minor
     from orders o where o.qr_code_id = :'qr' and o.status = 'PAID') as split_ok,
  (select p.amount_minor from payments p join orders o on o.id = p.order_id where o.qr_code_id = :'qr' and p.status = 'SUCCEEDED') = :amount as payment_amount,
  (select l.amount_minor from partner_ledger_entries l join orders o on o.id = l.order_id where o.qr_code_id = :'qr' and l.type = 'COMMISSION_EARNED')
    = (select o.partner_commission_minor from orders o where o.qr_code_id = :'qr' and o.status = 'PAID') as ledger_amount,
  (select count(*) from payments p join orders o on o.id = p.order_id where o.qr_code_id = :'qr' and p.status = 'PENDING') = 0 as no_open_attempt,
  (select count(*) from orders o where o.qr_code_id = :'qr' and o.status = 'PENDING_PAYMENT') = 0 as no_open_order;
\echo '-- pilot price audit (one row per pilot-priced order)'
select a.created_at, a.metadata->>'grossAmountMinor' as gross, a.metadata->>'standardAmountMinor' as standard
  from audit_logs a join orders o on o.id::text = a.target_id where a.action = 'PRICING_PILOT_PRICE_APPLIED' and o.qr_code_id = :'qr' order by a.created_at;
\echo '-- public prices (must be unchanged: PREMIUM_GREETING default 1000, active)'
select pr.key, coalesce(pa.slug, '<default>') as scope, x.amount_minor, x.active from prices x join products pr on pr.id = x.product_id left join partners pa on pa.id = x.partner_id where x.active order by 1, 2;
\echo '-- platform-wide totals (compare with the baseline in the runbook)'
select status, count(*), sum(gross_amount_minor) from orders group by status order by 1;
select type, count(*), sum(amount_minor) from partner_ledger_entries group by type order by 1;
\echo '-- reconciliation (last 3 heartbeats)'
select created_at, metadata->>'ok' as ok, metadata->>'remaining' as remaining from audit_logs where action = 'PAYMENT_RECONCILE_RUN' order by created_at desc limit 3;

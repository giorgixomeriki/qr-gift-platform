-- Read-only preflight for 0027_qr_handover_immediate. Every row must be true.
set default_transaction_read_only = on;
select 'ledger has 27 rows, last = 0026' as gate,
       (select count(*) = 27 and max(created_at) = 1795420800000 from drizzle.__drizzle_migrations) as ok
union all select 'no PENDING/DISPUTED handover (else 0027 refuses)',
       (select count(*) = 0 from qr_handovers where status in ('PENDING', 'DISPUTED'))
union all select 'no card reserved',
       (select count(*) = 0 from qr_handover_items where reserved)
union all select '0027 objects absent',
       to_regproc('app_admin_transfer_qr_cards') is null and to_regclass('qr_handover_reports') is null
union all select 'exactly one central stock, SUSPENDED, 0%',
       (select count(*) = 1 and bool_and(status = 'SUSPENDED' and commission_rate_bps = 0) from partners where is_central_stock);

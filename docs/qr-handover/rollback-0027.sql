-- Rollback of 0027_qr_handover_immediate. NOT a drizzle migration: run by hand,
-- as the migrations role, in ONE transaction, only after a verified backup and
-- together with rolling the app back to a build without 0027 (d8de1d1).
--
-- What it does: restores 0026's two-step flow (admin creates a PENDING
-- handover, the partner confirms). It does NOT undo any transfer that was
-- completed under 0027 — those are real ownership changes and stay, with their
-- history (status ACCEPTED, resolved_actor_type ADMIN), which 0026 accepts.
-- Partner count-mismatch reports are kept (renamed to an archive table that
-- the app role cannot read), never deleted.
begin;

drop trigger trg_qr_handovers_not_left_pending on qr_handovers;
drop function enforce_qr_handover_not_left_pending();
drop function app_admin_transfer_qr_cards(uuid, uuid, uuid, uuid[], text);
drop function app_report_qr_handover_discrepancy(uuid, integer, text);

drop policy qr_handover_reports_select on qr_handover_reports;
revoke all on qr_handover_reports from app_runtime;
alter table qr_handover_reports rename to qr_handover_reports_0027_archive;
alter index qr_handover_reports_handover_idx rename to qr_handover_reports_0027_archive_handover_idx;

-- 0026's grants and policies, exactly as shipped.
grant insert on qr_handovers, qr_handover_items to app_runtime;
create policy qr_handovers_admin_insert on qr_handovers for insert to app_runtime
  with check (app_is_admin() and created_by = app_current_user_id() and status = 'PENDING');
create policy qr_handover_items_admin_insert on qr_handover_items for insert to app_runtime
  with check (app_is_admin() and reserved);
grant execute on function app_accept_qr_handover(uuid) to app_runtime;
grant execute on function app_dispute_qr_handover(uuid, integer, text) to app_runtime;

delete from drizzle.__drizzle_migrations where created_at = 1795507200000;
commit;

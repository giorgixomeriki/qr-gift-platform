-- Rollback of 0026_qr_handovers. NOT a drizzle migration: run by hand, as the
-- migrations role, in ONE transaction, only after a verified backup.
-- Refuses if any handover was ACCEPTED (those are real ownership changes that
-- must not be silently undone) unless you deliberately remove that guard.
begin;

do $$
begin
  if exists (select 1 from qr_handovers where status = 'ACCEPTED') then
    raise exception 'rollback-0026: accepted handovers exist; ownership already moved — keep 0026';
  end if;
end $$;

-- 0013's attribution rule, exactly as shipped in 0013.
create or replace function enforce_qr_code_attribution() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_batch_partner uuid;
begin
  if tg_op = 'UPDATE' then
    if new.partner_id is distinct from old.partner_id
       or new.batch_id is distinct from old.batch_id
       or new.public_token is distinct from old.public_token then
      raise exception 'qr_codes.% attribution is immutable (public_token, batch_id, partner_id)', old.id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select partner_id into v_batch_partner from qr_batches where id = new.batch_id;
  if v_batch_partner is distinct from new.partner_id then
    raise exception 'qr_codes.partner_id must equal its batch''s partner_id'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop function if exists app_accept_qr_handover(uuid);
drop function if exists app_dispute_qr_handover(uuid, integer, text);
drop table qr_handover_acceptance_marks;
drop table qr_handover_items;
drop table qr_handovers;
drop function if exists enforce_qr_handover_update();
drop function if exists enforce_qr_handover_insert();
drop function if exists release_qr_handover_reservations();
drop function if exists enforce_qr_handover_item();
drop function if exists check_qr_handover_quantity();
drop function if exists check_qr_handover_quantity_h();
drop type qr_handover_status;

drop trigger if exists trg_partner_members_no_central_stock on partner_members;
drop trigger if exists trg_partner_invitations_no_central_stock on partner_invitations;
drop function if exists enforce_no_central_stock_login();
drop trigger if exists trg_partners_central_stock_flag on partners;
drop function if exists enforce_partner_central_stock_flag();
-- The central-stock partner row (if created) stays: it owns its batches/cards.
-- It keeps status SUSPENDED; only the flag column goes.
alter table partners drop constraint if exists partners_central_stock_dormant;
drop index if exists partners_one_central_stock;
alter table partners drop column is_central_stock;

delete from drizzle.__drizzle_migrations where created_at = 1795420800000;
commit;

-- =============================================================================
-- Immediate, admin-controlled QR transfers (owner decision 2026-11-22).
--
-- 0026 made a handover a two-step flow: an admin reserved cards (PENDING) and
-- the receiving partner confirmed receipt (app_accept_qr_handover) before the
-- cards changed owner. The admin is now the sole authority over inventory:
-- an admin transfer completes at once, in one transaction, with no partner
-- step.
--
-- Kept from 0026, unchanged: the tables, statuses, history, the state-machine
-- and attribution triggers, the acceptance-mark exception (only a definer
-- function can write a mark, so the app role still cannot move a card by
-- itself), and every eligibility rule.
--
-- Added here:
--   * app_admin_transfer_qr_cards(): the ONLY way to create a handover. Admin
--     only, idempotent per key, locks the cards (id order), re-checks every
--     card, then records the handover AND moves ownership in the same
--     transaction (status ACCEPTED, resolved_actor_type ADMIN). All or
--     nothing.
--   * No handover can be left PENDING at commit (deferred constraint
--     trigger), so the old two-step flow cannot be re-entered.
--   * The app role can no longer insert handovers directly, and partners can
--     no longer accept or dispute (0026's functions stay for history but are
--     not executable by app_runtime).
--   * qr_handover_reports: a partner may report a physical-count mismatch on
--     a completed transfer. Support only — it never changes ownership.
--
-- Precondition: no PENDING or DISPUTED handover exists (production had none
-- on 2026-11-22). If one does, this migration stops and nothing changes:
-- the admin must close it explicitly first (Cancel / Reject in the admin
-- handover page), then re-transfer the cards with the new flow. Historical
-- pending handovers are never auto-accepted.
--
-- Nothing here creates an order, a payment, a ledger entry, a commission or
-- an analytics event, and nothing changes qr_codes.status.
-- =============================================================================

do $$
declare
  v_open integer;
begin
  select count(*) into v_open from qr_handovers where status in ('PENDING', 'DISPUTED');
  if v_open > 0 then
    raise exception '0027: % open (PENDING/DISPUTED) handover(s) exist — cancel or reject them in the admin UI first; nothing was changed', v_open
      using errcode = 'check_violation';
  end if;
end;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. Close the two-step flow.
-- ---------------------------------------------------------------------------
drop policy qr_handovers_admin_insert on qr_handovers;
--> statement-breakpoint
drop policy qr_handover_items_admin_insert on qr_handover_items;
--> statement-breakpoint
revoke insert on qr_handovers, qr_handover_items from app_runtime;
--> statement-breakpoint
revoke execute on function app_accept_qr_handover(uuid) from app_runtime;
--> statement-breakpoint
revoke execute on function app_dispute_qr_handover(uuid, integer, text) from app_runtime;
--> statement-breakpoint

-- Whatever creates or changes a handover, it may not leave it PENDING at
-- commit. (Legacy rows can still be cancelled / rejected: those end terminal.)
create or replace function enforce_qr_handover_not_left_pending() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from qr_handovers h where h.id = new.id and h.status = 'PENDING') then
    raise exception 'qr_handovers.% cannot remain PENDING: transfers complete immediately', new.id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
--> statement-breakpoint
create constraint trigger trg_qr_handovers_not_left_pending
  after insert or update on qr_handovers deferrable initially deferred
  for each row execute function enforce_qr_handover_not_left_pending();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Admin transfer: create + complete in one transaction.
-- Errors (P0001): handover_forbidden, no_cards, too_many_cards, same_partner,
--   partner_not_found, partner_is_central_stock, partner_inactive,
--   idempotency_conflict, handover_not_pending, handover_cards_ineligible:<n>
-- Returns the handover id (also for an idempotent repeat).
-- ---------------------------------------------------------------------------
create or replace function app_admin_transfer_qr_cards(
  p_idempotency_key uuid,
  p_from_partner_id uuid,
  p_to_partner_id uuid,
  p_qr_code_ids uuid[],
  p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := app_current_user_id();
  v_ids uuid[];
  v_n integer;
  v_found integer;
  v_bad integer;
  v_prev qr_handovers%rowtype;
  v_from partners%rowtype;
  v_to partners%rowtype;
  v_handover uuid;
  v_batch uuid;
  v_moved integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_user is null or not app_is_admin() then
    raise exception 'handover_forbidden' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or p_from_partner_id is null or p_to_partner_id is null then
    raise exception 'partner_not_found' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}') into v_ids
    from unnest(coalesce(p_qr_code_ids, '{}'::uuid[])) x where x is not null;
  v_n := cardinality(v_ids);
  if v_n = 0 then
    raise exception 'no_cards' using errcode = 'P0001';
  end if;
  if v_n > 500 then
    raise exception 'too_many_cards' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    v_note := left(v_note, 500);
  end if;

  -- Same key = same request (double tap, retry after a lost response): the
  -- second caller waits here and gets the first one's result.
  perform pg_advisory_xact_lock(hashtextextended('qr_handover:' || p_idempotency_key::text, 0));
  select * into v_prev from qr_handovers where idempotency_key = p_idempotency_key;
  if found then
    if v_prev.from_partner_id <> p_from_partner_id or v_prev.to_partner_id <> p_to_partner_id
       or v_prev.quantity <> v_n then
      raise exception 'idempotency_conflict' using errcode = 'P0001';
    end if;
    if v_prev.status <> 'ACCEPTED' then
      raise exception 'handover_not_pending' using errcode = 'P0001';
    end if;
    return v_prev.id;
  end if;

  if p_from_partner_id = p_to_partner_id then
    raise exception 'same_partner' using errcode = 'P0001';
  end if;
  select * into v_from from partners where id = p_from_partner_id;
  if not found then
    raise exception 'partner_not_found' using errcode = 'P0001';
  end if;
  select * into v_to from partners where id = p_to_partner_id for share;
  if not found then
    raise exception 'partner_not_found' using errcode = 'P0001';
  end if;
  if v_to.is_central_stock then
    raise exception 'partner_is_central_stock' using errcode = 'P0001';
  end if;
  if v_to.status <> 'ACTIVE' then
    raise exception 'partner_inactive' using errcode = 'P0001';
  end if;

  -- Lock every card (id order: no deadlock between concurrent transfers),
  -- then judge them on their now-current rows.
  perform 1 from qr_codes where id = any(v_ids) order by id for update;
  select count(*) into v_found from qr_codes where id = any(v_ids);
  select count(*) into v_bad
    from qr_codes q
   where q.id = any(v_ids)
     and (q.partner_id <> p_from_partner_id
          or q.status <> 'AVAILABLE'
          or exists (select 1 from greetings g where g.qr_code_id = q.id)
          or exists (select 1 from orders o where o.qr_code_id = q.id)
          or exists (select 1 from qr_handover_items i where i.qr_code_id = q.id and i.reserved));
  v_bad := v_bad + (v_n - v_found);
  if v_bad > 0 then
    raise exception 'handover_cards_ineligible:%', v_bad using errcode = 'P0001';
  end if;

  insert into qr_handovers (from_partner_id, to_partner_id, quantity, idempotency_key, note, created_by)
  values (p_from_partner_id, p_to_partner_id, v_n, p_idempotency_key, v_note, v_user)
  returning id into v_handover;

  insert into qr_handover_items (handover_id, qr_code_id, from_batch_id)
  select v_handover, q.id, q.batch_id from qr_codes q where q.id = any(v_ids);

  insert into qr_batches (partner_id, label, quantity)
  values (p_to_partner_id,
          'QR STARR · ' || to_char(now() at time zone 'Asia/Tbilisi', 'YYYY-MM-DD HH24:MI'),
          v_n)
  returning id into v_batch;

  -- The one exception the attribution trigger (0026) accepts.
  insert into qr_handover_acceptance_marks (handover_id, txid) values (v_handover, txid_current());

  update qr_codes q
     set partner_id = p_to_partner_id,
         batch_id = v_batch,
         distribution_status = 'DISTRIBUTED',
         distributed_at = now()
    from qr_handover_items i
   where i.handover_id = v_handover and i.qr_code_id = q.id and i.reserved;
  get diagnostics v_moved = row_count;
  if v_moved <> v_n then
    raise exception 'handover_cards_ineligible:%', v_n - v_moved using errcode = 'P0001';
  end if;

  update qr_handover_items set reserved = false where handover_id = v_handover;
  update qr_handovers
     set status = 'ACCEPTED', resolved_at = now(), resolved_by = v_user,
         resolved_actor_type = 'ADMIN', result_batch_id = v_batch
   where id = v_handover;

  delete from qr_handover_acceptance_marks where handover_id = v_handover;

  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('ADMIN', v_user, 'QR_HANDOVER_TRANSFERRED', 'qr_handover', v_handover::text,
          jsonb_build_object(
            'kind', case when v_from.is_central_stock then 'CENTRAL_TO_PARTNER' else 'PARTNER_TO_PARTNER' end,
            'fromPartnerId', p_from_partner_id, 'toPartnerId', p_to_partner_id,
            'quantity', v_n, 'batchId', v_batch, 'qrCodeIds', to_jsonb(v_ids)));
  return v_handover;
end;
$$;
--> statement-breakpoint
revoke execute on function app_admin_transfer_qr_cards(uuid, uuid, uuid, uuid[], text) from public;
--> statement-breakpoint
grant execute on function app_admin_transfer_qr_cards(uuid, uuid, uuid, uuid[], text) to app_runtime;
--> statement-breakpoint
revoke execute on function enforce_qr_handover_not_left_pending() from public;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Non-blocking discrepancy reports on completed transfers.
-- Append-only; written only by app_report_qr_handover_discrepancy().
-- ---------------------------------------------------------------------------
create table qr_handover_reports (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references qr_handovers(id) on delete restrict,
  partner_id uuid not null references partners(id) on delete restrict,
  reported_by uuid not null,
  received_count integer,
  note text not null,
  created_at timestamptz not null default now(),
  constraint qr_handover_reports_note_len check (char_length(note) between 1 and 1000),
  constraint qr_handover_reports_count check (received_count is null or received_count between 0 and 10000)
);
--> statement-breakpoint
create index qr_handover_reports_handover_idx on qr_handover_reports (handover_id, created_at desc);
--> statement-breakpoint
alter table qr_handover_reports enable row level security;
--> statement-breakpoint
revoke all on qr_handover_reports from public, anon, authenticated, service_role, app_runtime;
--> statement-breakpoint
grant select on qr_handover_reports to app_runtime;
--> statement-breakpoint
create policy qr_handover_reports_select on qr_handover_reports for select to app_runtime
  using (app_is_admin() or app_is_partner_member(partner_id));
--> statement-breakpoint

-- Errors (P0001): handover_not_found, handover_forbidden, handover_not_completed,
--                 dispute_note_invalid, dispute_count_invalid, report_limit
create or replace function app_report_qr_handover_discrepancy(p_handover_id uuid, p_received_count integer, p_note text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := app_current_user_id();
  v_role text;
  h qr_handovers%rowtype;
  v_id uuid;
begin
  if v_user is null or p_handover_id is null then
    raise exception 'handover_not_found' using errcode = 'P0001';
  end if;
  select * into h from qr_handovers where id = p_handover_id for share;
  if not found then
    raise exception 'handover_not_found' using errcode = 'P0001';
  end if;
  v_role := app_partner_role(h.to_partner_id);
  if v_role is null then
    raise exception 'handover_not_found' using errcode = 'P0001';
  end if;
  if v_role not in ('OWNER', 'ADMIN', 'STAFF') then
    raise exception 'handover_forbidden' using errcode = 'P0001';
  end if;
  if h.status <> 'ACCEPTED' then
    raise exception 'handover_not_completed' using errcode = 'P0001';
  end if;
  if p_note is null or char_length(btrim(p_note)) = 0 or char_length(p_note) > 1000 then
    raise exception 'dispute_note_invalid' using errcode = 'P0001';
  end if;
  if p_received_count is not null and (p_received_count < 0 or p_received_count > 10000) then
    raise exception 'dispute_count_invalid' using errcode = 'P0001';
  end if;
  if (select count(*) from qr_handover_reports r where r.handover_id = h.id) >= 5 then
    raise exception 'report_limit' using errcode = 'P0001';
  end if;

  insert into qr_handover_reports (handover_id, partner_id, reported_by, received_count, note)
  values (h.id, h.to_partner_id, v_user, p_received_count, btrim(p_note))
  returning id into v_id;

  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('PARTNER', v_user, 'QR_HANDOVER_DISCREPANCY_REPORTED', 'qr_handover', h.id::text,
          jsonb_build_object('toPartnerId', h.to_partner_id, 'quantity', h.quantity,
                             'receivedCount', p_received_count, 'reportId', v_id));
  return v_id;
end;
$$;
--> statement-breakpoint
revoke execute on function app_report_qr_handover_discrepancy(uuid, integer, text) from public;
--> statement-breakpoint
grant execute on function app_report_qr_handover_discrepancy(uuid, integer, text) to app_runtime;

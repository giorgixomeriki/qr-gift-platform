-- =============================================================================
-- Admin-controlled QR handovers (Scan-to-Assign): physical cards move
--   * from QR STARR's central stock to a partner, or
--   * from one partner to another (admin redistribution).
-- Only an admin creates a handover; partners can only confirm receipt of a
-- handover addressed to them or report a discrepancy. There is no
-- partner-initiated transfer.
--
-- Until now every QR was minted for one partner and its owner could never
-- change (0013: "if reassignment is ever needed it must be a new, deliberate
-- migration"). This is that migration, kept as narrow as possible:
--
--   * partners.is_central_stock marks the ONE partner row that holds QR
--     STARR's own unsorted stock (printed cards not yet given to a store).
--   * qr_handovers / qr_handover_items record which exact cards an admin
--     scanned for which partner. A pending handover RESERVES its cards
--     (partial unique index), so a card can be in at most one open handover.
--   * Ownership moves ONLY inside app_accept_qr_handover(), run by the
--     receiving partner, atomically for every card of the handover, and only
--     for cards that are still pristine: owned by the handover's source,
--     AVAILABLE, never had a greeting, never had an order or payment. Cards keep their public_token (printed
--     URLs never change). They move to a new batch of the receiving partner,
--     so qr_codes.partner_id = qr_batches.partner_id still always holds.
--   * The attribution trigger from 0013 stays in force for every other
--     update. Its one exception requires an acceptance mark row that only
--     app_accept_qr_handover() can write (app_runtime has no privilege on the
--     mark table), so the exception can't be forged by setting a GUC.
--
-- Nothing here creates an order, a payment, a ledger entry or an analytics
-- event, and nothing changes qr_codes.status. Existing rows are untouched
-- except for the new column's default (false).
-- =============================================================================

alter table partners add column is_central_stock boolean not null default false;
--> statement-breakpoint
create unique index partners_one_central_stock on partners ((true)) where is_central_stock;
--> statement-breakpoint
-- Central stock is never a commercial partner: always SUSPENDED (its cards
-- resolve as unavailable on /g/{token}, so nothing can be started or sold
-- before a store accepts them) and never earns commission.
alter table partners add constraint partners_central_stock_dormant
  check (not is_central_stock or (status = 'SUSPENDED' and commission_rate_bps = 0));
--> statement-breakpoint
-- ...and never has a login: no member, no invitation.
create or replace function enforce_no_central_stock_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from partners p where p.id = new.partner_id and p.is_central_stock) then
    raise exception 'central stock partner % cannot have logins or members', new.partner_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger trg_partner_members_no_central_stock
  before insert or update of partner_id on partner_members
  for each row execute function enforce_no_central_stock_login();
--> statement-breakpoint
create trigger trg_partner_invitations_no_central_stock
  before insert or update of partner_id on partner_invitations
  for each row execute function enforce_no_central_stock_login();
--> statement-breakpoint
-- partners_update also lets a partner OWNER/ADMIN edit their own row; only an
-- admin may set or clear the central-stock flag. (Invoker rights on purpose:
-- current_user is the caller.)
create or replace function enforce_partner_central_stock_flag() returns trigger
language plpgsql as $$
begin
  if new.is_central_stock is distinct from old.is_central_stock
     and current_user = 'app_runtime' and not app_is_admin() then
    raise exception 'partners.% is_central_stock can be changed only by an admin', old.id
      using errcode = 'insufficient_privilege';
  end if;
  if new.is_central_stock and not old.is_central_stock and (
       exists (select 1 from partner_members m where m.partner_id = new.id)
       or exists (select 1 from partner_invitations i where i.partner_id = new.id and i.status = 'PENDING')
     ) then
    raise exception 'partners.% has logins and cannot become central stock', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger trg_partners_central_stock_flag
  before update of is_central_stock on partners
  for each row execute function enforce_partner_central_stock_flag();
--> statement-breakpoint

create type qr_handover_status as enum ('PENDING', 'DISPUTED', 'ACCEPTED', 'REJECTED', 'CANCELLED');
--> statement-breakpoint

create table qr_handovers (
  id uuid primary key default gen_random_uuid(),
  from_partner_id uuid not null references partners(id) on delete restrict,
  to_partner_id uuid not null references partners(id) on delete restrict,
  status qr_handover_status not null default 'PENDING',
  quantity integer not null,
  idempotency_key uuid not null unique,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  disputed_at timestamptz,
  disputed_by uuid,
  dispute_received_count integer,
  dispute_note text,
  resolved_at timestamptz,
  resolved_by uuid,
  resolved_actor_type actor_type,
  resolution_note text,
  result_batch_id uuid references qr_batches(id) on delete restrict,
  constraint qr_handovers_distinct_partners check (from_partner_id <> to_partner_id),
  constraint qr_handovers_quantity_range check (quantity between 1 and 500),
  constraint qr_handovers_note_len check (note is null or char_length(note) <= 500),
  constraint qr_handovers_dispute_note_len check (dispute_note is null or char_length(dispute_note) <= 1000),
  constraint qr_handovers_resolution_note_len check (resolution_note is null or char_length(resolution_note) <= 500),
  constraint qr_handovers_dispute_count check (dispute_received_count is null or dispute_received_count between 0 and 10000),
  constraint qr_handovers_resolved_consistent
    check ((status in ('ACCEPTED', 'REJECTED', 'CANCELLED')) = (resolved_at is not null)),
  constraint qr_handovers_accepted_has_batch
    check ((status = 'ACCEPTED') = (result_batch_id is not null))
);
--> statement-breakpoint
create index qr_handovers_to_partner_idx on qr_handovers (to_partner_id, created_at desc);
--> statement-breakpoint
create index qr_handovers_status_idx on qr_handovers (status, created_at desc);
--> statement-breakpoint

create table qr_handover_items (
  handover_id uuid not null references qr_handovers(id) on delete restrict,
  qr_code_id uuid not null references qr_codes(id) on delete restrict,
  -- Where the card came from (its batch at creation time) — permanent history,
  -- the card itself then moves to the receiving partner's new batch.
  from_batch_id uuid not null references qr_batches(id) on delete restrict,
  reserved boolean not null default true,
  primary key (handover_id, qr_code_id)
);
--> statement-breakpoint
-- The reservation: a card is in at most one open (PENDING / DISPUTED) handover.
create unique index qr_handover_items_one_open_reservation on qr_handover_items (qr_code_id) where reserved;
--> statement-breakpoint
create index qr_handover_items_qr_idx on qr_handover_items (qr_code_id);
--> statement-breakpoint

-- Written and deleted only inside app_accept_qr_handover() (definer). The
-- attribution trigger trusts nothing else.
create table qr_handover_acceptance_marks (
  handover_id uuid primary key references qr_handovers(id) on delete cascade,
  txid bigint not null
);
--> statement-breakpoint

alter table qr_handovers enable row level security;
--> statement-breakpoint
alter table qr_handover_items enable row level security;
--> statement-breakpoint
alter table qr_handover_acceptance_marks enable row level security;
--> statement-breakpoint
revoke all on qr_handovers, qr_handover_items, qr_handover_acceptance_marks from public, anon, authenticated, service_role;
--> statement-breakpoint
revoke all on qr_handover_acceptance_marks from app_runtime;
--> statement-breakpoint
revoke delete on qr_handovers, qr_handover_items from app_runtime;
--> statement-breakpoint
grant select, insert, update on qr_handovers, qr_handover_items to app_runtime;
--> statement-breakpoint

-- Admins see and create everything. The receiving partner reads its own
-- handovers (any member) but never writes them directly: accept and dispute
-- go through the definer functions below.
create policy qr_handovers_select on qr_handovers for select to app_runtime
  using (app_is_admin() or app_is_partner_member(to_partner_id));
--> statement-breakpoint
create policy qr_handovers_admin_insert on qr_handovers for insert to app_runtime
  with check (app_is_admin() and created_by = app_current_user_id() and status = 'PENDING');
--> statement-breakpoint
create policy qr_handovers_admin_update on qr_handovers for update to app_runtime
  using (app_is_admin());
--> statement-breakpoint
create policy qr_handover_items_select on qr_handover_items for select to app_runtime
  using (
    app_is_admin()
    or exists (select 1 from qr_handovers h where h.id = handover_id and app_is_partner_member(h.to_partner_id))
  );
--> statement-breakpoint
create policy qr_handover_items_admin_insert on qr_handover_items for insert to app_runtime
  with check (app_is_admin() and reserved);
--> statement-breakpoint
create policy qr_handover_items_admin_update on qr_handover_items for update to app_runtime
  using (app_is_admin());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Handover state machine
--   PENDING  -> ACCEPTED   receiving partner, only via app_accept_qr_handover
--   PENDING  -> DISPUTED   receiving partner (app_dispute_qr_handover) or admin
--   PENDING  -> CANCELLED  admin
--   DISPUTED -> PENDING    admin (recount settled; partner confirms again)
--   DISPUTED -> REJECTED   admin (closes the dispute; cards return to stock)
-- ACCEPTED / REJECTED / CANCELLED are terminal. Identity columns never change.
-- ---------------------------------------------------------------------------
create or replace function enforce_qr_handover_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id is distinct from old.id
     or new.from_partner_id is distinct from old.from_partner_id
     or new.to_partner_id is distinct from old.to_partner_id
     or new.quantity is distinct from old.quantity
     or new.idempotency_key is distinct from old.idempotency_key
     or new.note is distinct from old.note
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'qr_handovers.% identity is immutable', old.id using errcode = 'check_violation';
  end if;

  if old.status in ('ACCEPTED', 'REJECTED', 'CANCELLED') then
    raise exception 'qr_handovers.% is % (terminal)', old.id, old.status using errcode = 'check_violation';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'PENDING' and new.status in ('ACCEPTED', 'DISPUTED', 'CANCELLED'))
    or (old.status = 'DISPUTED' and new.status in ('PENDING', 'REJECTED'))
  ) then
    raise exception 'qr_handovers.% status % -> % is not permitted', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'ACCEPTED' and not exists (
    select 1 from qr_handover_acceptance_marks m where m.handover_id = old.id and m.txid = txid_current()
  ) then
    raise exception 'qr_handovers.% can be accepted only by the receiving partner', old.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;
--> statement-breakpoint
create trigger trg_qr_handovers_update
  before update on qr_handovers
  for each row execute function enforce_qr_handover_update();
--> statement-breakpoint

-- A handover never goes INTO central stock (it has no login to confirm
-- receipt, and stock only ever leaves it).
create or replace function enforce_qr_handover_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from partners p where p.id = new.to_partner_id and p.is_central_stock) then
    raise exception 'qr_handovers: central stock cannot receive a handover' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger trg_qr_handovers_insert
  before insert on qr_handovers
  for each row execute function enforce_qr_handover_insert();
--> statement-breakpoint

-- Cancel / reject release the reservations in the same transaction.
create or replace function release_qr_handover_reservations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('CANCELLED', 'REJECTED') and old.status is distinct from new.status then
    update qr_handover_items set reserved = false where handover_id = new.id and reserved;
  end if;
  return null;
end;
$$;
--> statement-breakpoint
create trigger trg_qr_handovers_release
  after update of status on qr_handovers
  for each row execute function release_qr_handover_reservations();
--> statement-breakpoint

-- Items: added only while their handover is PENDING, never moved to another
-- card or handover, and a released reservation never comes back.
create or replace function enforce_qr_handover_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from qr_handovers h where h.id = new.handover_id and h.status = 'PENDING') then
      raise exception 'qr_handover_items: handover % is not pending', new.handover_id using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from qr_codes q join qr_handovers h on h.id = new.handover_id
       where q.id = new.qr_code_id and q.partner_id = h.from_partner_id and q.batch_id = new.from_batch_id
    ) then
      raise exception 'qr_handover_items: card % is not held by the handover source', new.qr_code_id using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.handover_id is distinct from old.handover_id or new.qr_code_id is distinct from old.qr_code_id
     or new.from_batch_id is distinct from old.from_batch_id then
    raise exception 'qr_handover_items identity is immutable' using errcode = 'check_violation';
  end if;
  if new.reserved and not old.reserved then
    raise exception 'qr_handover_items: a released reservation cannot be re-opened' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger trg_qr_handover_items
  before insert or update on qr_handover_items
  for each row execute function enforce_qr_handover_item();
--> statement-breakpoint

-- quantity always equals the number of items (checked at commit, so the
-- handover row and its items are inserted in one transaction).
create or replace function check_qr_handover_quantity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_quantity integer;
  v_items integer;
begin
  select quantity into v_quantity from qr_handovers where id = new.handover_id;
  if not found then return null; end if;
  select count(*) into v_items from qr_handover_items where handover_id = new.handover_id;
  if v_items <> v_quantity then
    raise exception 'qr_handovers.% quantity % does not match % items', new.handover_id, v_quantity, v_items
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
--> statement-breakpoint
create or replace function check_qr_handover_quantity_h() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_items integer;
begin
  select count(*) into v_items from qr_handover_items where handover_id = new.id;
  if v_items <> new.quantity then
    raise exception 'qr_handovers.% quantity % does not match % items', new.id, new.quantity, v_items
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
--> statement-breakpoint
create constraint trigger trg_qr_handovers_quantity
  after insert on qr_handovers deferrable initially deferred
  for each row execute function check_qr_handover_quantity_h();
--> statement-breakpoint
create constraint trigger trg_qr_handover_items_quantity
  after insert on qr_handover_items deferrable initially deferred
  for each row execute function check_qr_handover_quantity();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 0013's attribution trigger, with exactly one exception: a card moving from
-- central stock to the receiving partner inside app_accept_qr_handover().
-- Everything else is byte-for-byte the old rule.
-- ---------------------------------------------------------------------------
create or replace function enforce_qr_code_attribution() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_batch_partner uuid;
  v_handover qr_handovers%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.partner_id is distinct from old.partner_id
       or new.batch_id is distinct from old.batch_id
       or new.public_token is distinct from old.public_token then

      select h.* into v_handover
        from qr_handover_acceptance_marks m
        join qr_handovers h on h.id = m.handover_id
        join qr_handover_items i on i.handover_id = h.id and i.qr_code_id = old.id and i.reserved
       where m.txid = txid_current()
       limit 1;

      if v_handover.id is null
         or new.public_token is distinct from old.public_token
         or v_handover.status <> 'PENDING'
         or old.partner_id <> v_handover.from_partner_id
         or new.partner_id <> v_handover.to_partner_id
         or old.status <> 'AVAILABLE'
         or new.status <> 'AVAILABLE'
         or exists (select 1 from partners p where p.id = new.partner_id and p.is_central_stock)
         or (select partner_id from qr_batches where id = new.batch_id) is distinct from new.partner_id
         or exists (select 1 from greetings g where g.qr_code_id = old.id)
         or exists (select 1 from orders o where o.qr_code_id = old.id) then
        raise exception 'qr_codes.% attribution is immutable (public_token, batch_id, partner_id)', old.id
          using errcode = 'check_violation';
      end if;
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
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Partner: confirm receipt. Atomic, idempotent (a repeat on an ACCEPTED
-- handover returns the same batch), all-or-nothing: if any card is no longer
-- eligible nothing moves and the error lists how many.
-- Errors (P0001): handover_not_found, handover_forbidden, partner_inactive,
--                 handover_not_pending, handover_cards_ineligible:<n>
-- ---------------------------------------------------------------------------
create or replace function app_accept_qr_handover(p_handover_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := app_current_user_id();
  v_role text;
  h qr_handovers%rowtype;
  v_bad integer;
  v_batch uuid;
  v_moved integer;
begin
  if v_user is null or p_handover_id is null then
    raise exception 'handover_not_found' using errcode = 'P0001';
  end if;

  select * into h from qr_handovers where id = p_handover_id for update;
  if not found then
    raise exception 'handover_not_found' using errcode = 'P0001';
  end if;

  -- Not a member of the receiving partner: indistinguishable from not found.
  v_role := app_partner_role(h.to_partner_id);
  if v_role is null then
    raise exception 'handover_not_found' using errcode = 'P0001';
  end if;
  if v_role not in ('OWNER', 'ADMIN', 'STAFF') then
    raise exception 'handover_forbidden' using errcode = 'P0001';
  end if;

  if h.status = 'ACCEPTED' then
    return h.result_batch_id;
  end if;
  if h.status <> 'PENDING' then
    raise exception 'handover_not_pending' using errcode = 'P0001';
  end if;
  if not app_partner_is_active(h.to_partner_id) then
    raise exception 'partner_inactive' using errcode = 'P0001';
  end if;

  perform 1 from qr_codes q
    join qr_handover_items i on i.qr_code_id = q.id
   where i.handover_id = h.id
   order by q.id
     for update of q;

  select count(*) into v_bad
    from qr_handover_items i
    join qr_codes q on q.id = i.qr_code_id
   where i.handover_id = h.id
     and (not i.reserved
          or q.partner_id <> h.from_partner_id
          or q.status <> 'AVAILABLE'
          or exists (select 1 from greetings g where g.qr_code_id = q.id)
          or exists (select 1 from orders o where o.qr_code_id = q.id));
  if v_bad > 0 then
    raise exception 'handover_cards_ineligible:%', v_bad using errcode = 'P0001';
  end if;

  insert into qr_batches (partner_id, label, quantity)
  values (h.to_partner_id,
          'QR STARR · ' || to_char(now() at time zone 'Asia/Tbilisi', 'YYYY-MM-DD HH24:MI'),
          h.quantity)
  returning id into v_batch;

  insert into qr_handover_acceptance_marks (handover_id, txid) values (h.id, txid_current());

  update qr_codes q
     set partner_id = h.to_partner_id,
         batch_id = v_batch,
         distribution_status = 'DISTRIBUTED',
         distributed_at = now()
    from qr_handover_items i
   where i.handover_id = h.id and i.qr_code_id = q.id and i.reserved;
  get diagnostics v_moved = row_count;
  if v_moved <> h.quantity then
    raise exception 'handover_cards_ineligible:%', h.quantity - v_moved using errcode = 'P0001';
  end if;

  update qr_handover_items set reserved = false where handover_id = h.id;
  update qr_handovers
     set status = 'ACCEPTED', resolved_at = now(), resolved_by = v_user,
         resolved_actor_type = 'PARTNER', result_batch_id = v_batch
   where id = h.id;

  delete from qr_handover_acceptance_marks where handover_id = h.id;

  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('PARTNER', v_user, 'QR_HANDOVER_ACCEPTED', 'qr_handover', h.id::text,
          jsonb_build_object('toPartnerId', h.to_partner_id, 'fromPartnerId', h.from_partner_id,
                             'quantity', h.quantity, 'batchId', v_batch));
  return v_batch;
end;
$$;
--> statement-breakpoint

-- Partner: report a discrepancy. Keeps the reservation for admin resolution.
-- Idempotent on an already-DISPUTED handover.
create or replace function app_dispute_qr_handover(p_handover_id uuid, p_received_count integer, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := app_current_user_id();
  v_role text;
  h qr_handovers%rowtype;
begin
  if v_user is null or p_handover_id is null then
    raise exception 'handover_not_found' using errcode = 'P0001';
  end if;
  select * into h from qr_handovers where id = p_handover_id for update;
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
  if h.status = 'DISPUTED' then
    return;
  end if;
  if h.status <> 'PENDING' then
    raise exception 'handover_not_pending' using errcode = 'P0001';
  end if;
  if p_note is null or char_length(btrim(p_note)) = 0 or char_length(p_note) > 1000 then
    raise exception 'dispute_note_invalid' using errcode = 'P0001';
  end if;
  if p_received_count is not null and (p_received_count < 0 or p_received_count > 10000) then
    raise exception 'dispute_count_invalid' using errcode = 'P0001';
  end if;

  update qr_handovers
     set status = 'DISPUTED', disputed_at = now(), disputed_by = v_user,
         dispute_received_count = p_received_count, dispute_note = btrim(p_note)
   where id = h.id;

  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('PARTNER', v_user, 'QR_HANDOVER_DISPUTED', 'qr_handover', h.id::text,
          jsonb_build_object('toPartnerId', h.to_partner_id, 'quantity', h.quantity,
                             'receivedCount', p_received_count));
end;
$$;
--> statement-breakpoint

revoke execute on function app_accept_qr_handover(uuid) from public;
--> statement-breakpoint
revoke execute on function app_dispute_qr_handover(uuid, integer, text) from public;
--> statement-breakpoint
revoke execute on function enforce_qr_handover_update() from public;
--> statement-breakpoint
revoke execute on function release_qr_handover_reservations() from public;
--> statement-breakpoint
revoke execute on function enforce_qr_handover_item() from public;
--> statement-breakpoint
revoke execute on function enforce_no_central_stock_login() from public;
--> statement-breakpoint
revoke execute on function enforce_qr_handover_insert() from public;
--> statement-breakpoint
revoke execute on function check_qr_handover_quantity() from public;
--> statement-breakpoint
revoke execute on function check_qr_handover_quantity_h() from public;
--> statement-breakpoint
grant execute on function app_accept_qr_handover(uuid) to app_runtime;
--> statement-breakpoint
grant execute on function app_dispute_qr_handover(uuid, integer, text) to app_runtime;

-- =============================================================================
-- Partner attribution + commission ledger integrity.
--
-- The attribution chain QR -> batch -> partner -> order -> commission already
-- existed (0000/0002/0003), but several links were only guaranteed by app
-- code. These triggers/constraints make each link a database fact, so
-- financial attribution survives an application bug, an admin mistake or a
-- multi-partner member's RLS reach:
--
--   1. qr_codes.partner_id must equal its batch's partner_id; QR identity
--      (public_token / batch_id / partner_id) and a batch's partner are
--      immutable once issued. The app has no reassignment feature; if one is
--      ever needed it must be a new, deliberate migration.
--   2. greetings.qr_code_id is immutable (a draft can't hop to another card).
--   3. orders: attribution must match the greeting's QR on insert; the
--      financial snapshot is immutable; PAID/REFUNDED can't be rolled back.
--      commission_rate_bps is now part of the snapshot.
--   4. partner_ledger_entries: COMMISSION_EARNED / COMMISSION_REVERSAL must
--      match their order exactly (partner, currency, amount, order status);
--      at most one reversal per order; sign conventions enforced.
--   5. A PAYOUT can never take a partner's balance below zero — serialized
--      per partner+currency by an advisory lock, so two concurrent payouts
--      can't both spend the same commission.
--
-- All existing local rows were checked against these rules before writing
-- this migration; every ADD CONSTRAINT below validates existing data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. QR ownership
-- ---------------------------------------------------------------------------
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
--> statement-breakpoint

create trigger trg_qr_codes_attribution
  before insert or update of partner_id, batch_id, public_token on qr_codes
  for each row execute function enforce_qr_code_attribution();
--> statement-breakpoint

create or replace function enforce_qr_batch_partner_immutable() returns trigger
language plpgsql as $$
begin
  if new.partner_id is distinct from old.partner_id then
    raise exception 'qr_batches.% partner_id is immutable', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger trg_qr_batches_partner_immutable
  before update of partner_id on qr_batches
  for each row execute function enforce_qr_batch_partner_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Greeting <-> QR link
-- ---------------------------------------------------------------------------
create or replace function enforce_greeting_qr_immutable() returns trigger
language plpgsql as $$
begin
  if new.qr_code_id is distinct from old.qr_code_id then
    raise exception 'greetings.% qr_code_id is immutable', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger trg_greetings_qr_immutable
  before update of qr_code_id on greetings
  for each row execute function enforce_greeting_qr_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Orders: attribution on insert, immutable snapshot, no rollback of money
-- ---------------------------------------------------------------------------
-- Nullable: orders created before this migration never recorded the rate
-- (it can't be recovered exactly from floor-rounded amounts). Every order
-- created from now on sets it (lib/payments/service.ts startCheckout).
alter table orders add column commission_rate_bps integer;
--> statement-breakpoint
alter table orders add constraint orders_commission_rate_bps_range
  check (commission_rate_bps is null or (commission_rate_bps >= 0 and commission_rate_bps <= 10000));
--> statement-breakpoint
alter table partners add constraint partners_commission_rate_bps_range
  check (commission_rate_bps >= 0 and commission_rate_bps <= 10000);
--> statement-breakpoint

create or replace function enforce_order_integrity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_greeting_qr uuid;
  v_qr_partner uuid;
begin
  if tg_op = 'INSERT' then
    select qr_code_id into v_greeting_qr from greetings where id = new.greeting_id;
    select partner_id into v_qr_partner from qr_codes where id = new.qr_code_id;
    if v_greeting_qr is distinct from new.qr_code_id then
      raise exception 'orders.qr_code_id must be the greeting''s own QR'
        using errcode = 'check_violation';
    end if;
    if v_qr_partner is distinct from new.partner_id then
      raise exception 'orders.partner_id must be the QR''s partner'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.greeting_id is distinct from old.greeting_id
     or new.qr_code_id is distinct from old.qr_code_id
     or new.partner_id is distinct from old.partner_id
     or new.product_id is distinct from old.product_id
     or new.currency is distinct from old.currency
     or new.gross_amount_minor is distinct from old.gross_amount_minor
     or new.partner_commission_minor is distinct from old.partner_commission_minor
     or new.platform_share_minor is distinct from old.platform_share_minor
     or new.commission_rate_bps is distinct from old.commission_rate_bps then
    raise exception 'orders.% attribution and financial snapshot are immutable', old.id
      using errcode = 'check_violation';
  end if;

  if old.status = 'PAID' and new.status not in ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED') then
    raise exception 'orders.% is PAID and can only move to a refund status (not %)', old.id, new.status
      using errcode = 'check_violation';
  end if;
  if old.status = 'REFUNDED' and new.status <> 'REFUNDED' then
    raise exception 'orders.% is REFUNDED (terminal)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger trg_orders_integrity
  before insert or update on orders
  for each row execute function enforce_order_integrity();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Ledger: entries must agree with the order / payout they reference
-- ---------------------------------------------------------------------------
alter table partner_ledger_entries add constraint partner_ledger_entries_sign
  check (
    (type = 'COMMISSION_EARNED' and amount_minor >= 0)
    or (type = 'COMMISSION_REVERSAL' and amount_minor <= 0)
    or (type = 'PAYOUT' and amount_minor < 0)
    or type = 'ADJUSTMENT'
  );
--> statement-breakpoint
alter table partner_ledger_entries add constraint partner_ledger_entries_commission_has_order
  check (type not in ('COMMISSION_EARNED', 'COMMISSION_REVERSAL') or order_id is not null);
--> statement-breakpoint
create unique index partner_ledger_one_reversal_per_order
  on partner_ledger_entries (order_id) where type = 'COMMISSION_REVERSAL';
--> statement-breakpoint
alter table partner_payouts add constraint partner_payouts_amount_positive
  check (amount_minor > 0);
--> statement-breakpoint

-- One advisory-lock key per partner+currency balance. Used both by the
-- ledger trigger below and by lib/payments/payouts.ts (so the app's own
-- friendly "exceeds unpaid balance" pre-check is serialized too).
create or replace function app_lock_partner_balance(p_partner_id uuid, p_currency text) returns void
language sql volatile as $$
  select pg_advisory_xact_lock(hashtextextended('partner_balance:' || p_partner_id::text || ':' || p_currency, 0))
$$;
--> statement-breakpoint
revoke execute on function app_lock_partner_balance(uuid, text) from public;
--> statement-breakpoint
grant execute on function app_lock_partner_balance(uuid, text) to app_runtime;
--> statement-breakpoint

create or replace function enforce_ledger_entry_integrity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_balance bigint;
begin
  if new.type in ('COMMISSION_EARNED', 'COMMISSION_REVERSAL') then
    select * into v_order from orders where id = new.order_id;
    if not found then
      raise exception 'ledger % references a missing order', new.type using errcode = 'check_violation';
    end if;
    if new.partner_id <> v_order.partner_id or new.currency <> v_order.currency then
      raise exception 'ledger % partner/currency must match order %', new.type, v_order.id
        using errcode = 'check_violation';
    end if;

    if new.type = 'COMMISSION_EARNED' then
      if v_order.status <> 'PAID' then
        raise exception 'COMMISSION_EARNED requires a PAID order (order % is %)', v_order.id, v_order.status
          using errcode = 'check_violation';
      end if;
      if new.amount_minor <> v_order.partner_commission_minor then
        raise exception 'COMMISSION_EARNED amount must equal order %''s commission snapshot', v_order.id
          using errcode = 'check_violation';
      end if;
    else
      -- Full refunds only: partial refunds have no defined commission rule yet.
      if v_order.status <> 'REFUNDED' then
        raise exception 'COMMISSION_REVERSAL requires a REFUNDED order (order % is %)', v_order.id, v_order.status
          using errcode = 'check_violation';
      end if;
      if not exists (
        select 1 from partner_ledger_entries
         where order_id = v_order.id and type = 'COMMISSION_EARNED'
      ) then
        raise exception 'COMMISSION_REVERSAL for order % has no commission to reverse', v_order.id
          using errcode = 'check_violation';
      end if;
      if new.amount_minor <> -v_order.partner_commission_minor then
        raise exception 'COMMISSION_REVERSAL amount must be the negated commission of order %', v_order.id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.type = 'PAYOUT' then
    perform app_lock_partner_balance(new.partner_id, new.currency);
    select coalesce(sum(amount_minor), 0) into v_balance
      from partner_ledger_entries
     where partner_id = new.partner_id and currency = new.currency;
    if v_balance + new.amount_minor < 0 then
      raise exception 'PAYOUT of % exceeds unpaid balance % for partner %', -new.amount_minor, v_balance, new.partner_id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
--> statement-breakpoint

create trigger trg_partner_ledger_entries_integrity
  before insert on partner_ledger_entries
  for each row execute function enforce_ledger_entry_integrity();

-- =============================================================================
-- Sale-level payout traceability: partner_payout_items.
--
-- Until now a payout was a balance-based debit: "pay X GEL" with no record of
-- WHICH commissions X covered. A payout is now the exact set of ledger rows
-- it settles, so both "payout P paid exactly which commissions?" and "which
-- payout paid commission C?" are direct lookups.
--
-- No second ledger: an item is a pure link (payout_id, ledger_entry_id). The
-- money stays on the existing immutable partner_ledger_entries rows; a
-- payout's amount must equal the SUM of its items' ledger amounts, and its
-- single PAYOUT ledger row must be exactly the negation (checked at COMMIT by
-- a deferred constraint trigger, so payout + items + PAYOUT row are
-- all-or-nothing).
--
-- What a payout may settle:
--   COMMISSION_EARNED    unpaid, and its order has NOT been reversed
--                        (refund before payout: earning + reversal net to
--                        zero and neither is ever paid)
--   COMMISSION_REVERSAL  only when its earning was already paid by an EARLIER
--                        payout (refund after payout: the claw-back is netted
--                        into the next payout; the old item stays as history)
--   ADJUSTMENT           manual admin credits/debits
--   PAYOUT rows are never items.
--
-- Legacy payouts (rows existing before this migration) are kept untouched as
-- itemized = false: the one local legacy payout (200 minor units against
-- 150-unit commissions) cannot be mapped to whole commissions, so no
-- sale-level association is fabricated for it.
-- =============================================================================

alter table partner_payouts add column itemized boolean not null default false;
--> statement-breakpoint
-- Existing rows got false above (legacy); every payout created from now on is itemized.
alter table partner_payouts alter column itemized set default true;
--> statement-breakpoint

-- Targets for the composite foreign keys below: an item can only ever join a
-- payout and a ledger row of the SAME partner and currency.
alter table partner_payouts add constraint partner_payouts_id_partner_currency_unique unique (id, partner_id, currency);
--> statement-breakpoint
alter table partner_ledger_entries add constraint partner_ledger_entries_id_partner_currency_unique unique (id, partner_id, currency);
--> statement-breakpoint

create table partner_payout_items (
  -- Primary key on the ledger row: one ledger entry can belong to at most one payout, ever.
  ledger_entry_id uuid primary key,
  payout_id uuid not null,
  partner_id uuid not null,
  currency text not null,
  created_at timestamp with time zone not null default now(),
  constraint partner_payout_items_payout_fk foreign key (payout_id, partner_id, currency)
    references partner_payouts (id, partner_id, currency) on delete restrict,
  constraint partner_payout_items_ledger_fk foreign key (ledger_entry_id, partner_id, currency)
    references partner_ledger_entries (id, partner_id, currency) on delete restrict
);
--> statement-breakpoint
create index partner_payout_items_payout_id_idx on partner_payout_items (payout_id);
--> statement-breakpoint
create index partner_payout_items_partner_id_idx on partner_payout_items (partner_id);
--> statement-breakpoint
alter table partner_payout_items enable row level security;
--> statement-breakpoint
grant select, insert on partner_payout_items to app_runtime;
--> statement-breakpoint

-- Admin writes (inside recordManualPayout's admin transaction); the owning
-- partner may read its own items. No update/delete policy: append-only.
create policy partner_payout_items_select on partner_payout_items for select
  using (app_is_admin() or app_is_partner_member(partner_id));
--> statement-breakpoint
create policy partner_payout_items_insert on partner_payout_items for insert
  with check (app_is_admin());
--> statement-breakpoint

-- One PAYOUT ledger row per payout.
create unique index partner_ledger_one_payout_row_per_payout
  on partner_ledger_entries (payout_id) where type = 'PAYOUT';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Item eligibility, checked on insert
-- ---------------------------------------------------------------------------
create or replace function enforce_payout_item_eligibility() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_entry partner_ledger_entries%rowtype;
  v_itemized boolean;
begin
  select itemized into v_itemized from partner_payouts where id = new.payout_id;
  if not v_itemized then
    raise exception 'legacy payout % cannot receive items', new.payout_id using errcode = 'check_violation';
  end if;

  select * into v_entry from partner_ledger_entries where id = new.ledger_entry_id;
  if v_entry.type = 'PAYOUT' then
    raise exception 'a PAYOUT ledger row cannot be a payout item' using errcode = 'check_violation';
  end if;

  if v_entry.type = 'COMMISSION_EARNED' and exists (
    select 1 from partner_ledger_entries r
     where r.order_id = v_entry.order_id and r.type = 'COMMISSION_REVERSAL'
  ) then
    raise exception 'commission % was reversed before payout and is not payable', v_entry.id
      using errcode = 'check_violation';
  end if;

  if v_entry.type = 'COMMISSION_REVERSAL' and not exists (
    select 1 from partner_ledger_entries e
      join partner_payout_items i on i.ledger_entry_id = e.id
     where e.order_id = v_entry.order_id and e.type = 'COMMISSION_EARNED' and i.payout_id <> new.payout_id
  ) then
    raise exception 'reversal % can only be settled after its commission was paid by an earlier payout', v_entry.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
--> statement-breakpoint
create trigger trg_partner_payout_items_eligibility
  before insert on partner_payout_items
  for each row execute function enforce_payout_item_eligibility();
--> statement-breakpoint

create or replace function forbid_update() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = 'check_violation';
end;
$$;
--> statement-breakpoint
create trigger trg_partner_payout_items_immutable
  before update on partner_payout_items
  for each row execute function forbid_update();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A payout's financial facts never change after creation
-- ---------------------------------------------------------------------------
create or replace function enforce_payout_immutable() returns trigger
language plpgsql as $$
begin
  if new.partner_id is distinct from old.partner_id
     or new.currency is distinct from old.currency
     or new.amount_minor is distinct from old.amount_minor
     or new.period_from is distinct from old.period_from
     or new.period_to is distinct from old.period_to
     or new.itemized is distinct from old.itemized then
    raise exception 'partner_payouts.% partner, currency, amount, period and itemized are immutable', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger trg_partner_payouts_immutable
  before update on partner_payouts
  for each row execute function enforce_payout_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- At COMMIT: an itemized payout's amount = SUM(items) and its PAYOUT ledger
-- row is exactly -amount. Fires for a new payout and for any item added to an
-- existing one, so items can never be added to (or missing from) a payout.
-- ---------------------------------------------------------------------------
create or replace function check_payout_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payout_id uuid;
  v_payout partner_payouts%rowtype;
  v_items_count int;
  v_items_sum bigint;
  v_ledger_amount bigint;
begin
  if tg_table_name = 'partner_payouts' then
    v_payout_id := new.id;
  else
    v_payout_id := new.payout_id;
  end if;
  select * into v_payout from partner_payouts where id = v_payout_id;
  if not v_payout.itemized then return null; end if;

  select count(*), coalesce(sum(l.amount_minor), 0) into v_items_count, v_items_sum
    from partner_payout_items i join partner_ledger_entries l on l.id = i.ledger_entry_id
   where i.payout_id = v_payout_id;
  if v_items_count = 0 or v_items_sum <> v_payout.amount_minor then
    raise exception 'payout % amount % does not equal the sum % of its % items', v_payout_id, v_payout.amount_minor, v_items_sum, v_items_count
      using errcode = 'check_violation';
  end if;

  select amount_minor into v_ledger_amount from partner_ledger_entries
   where payout_id = v_payout_id and type = 'PAYOUT';
  if v_ledger_amount is distinct from -v_payout.amount_minor then
    raise exception 'payout % must have exactly one PAYOUT ledger row of %', v_payout_id, -v_payout.amount_minor
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
--> statement-breakpoint
create constraint trigger trg_partner_payouts_totals
  after insert on partner_payouts
  deferrable initially deferred
  for each row execute function check_payout_totals();
--> statement-breakpoint
create constraint trigger trg_partner_payout_items_totals
  after insert on partner_payout_items
  deferrable initially deferred
  for each row execute function check_payout_totals();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- PAYOUT ledger rows (extends 0013's trigger): new rows must reference their
-- payout and match its partner/currency. Existing rows are untouched.
-- ---------------------------------------------------------------------------
create or replace function enforce_ledger_entry_integrity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_payout partner_payouts%rowtype;
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
    select * into v_payout from partner_payouts where id = new.payout_id;
    if not found then
      raise exception 'PAYOUT ledger row must reference its partner_payouts row' using errcode = 'check_violation';
    end if;
    if new.partner_id <> v_payout.partner_id or new.currency <> v_payout.currency or new.amount_minor <> -v_payout.amount_minor then
      raise exception 'PAYOUT ledger row must match payout % (partner, currency, -amount)', v_payout.id
        using errcode = 'check_violation';
    end if;

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

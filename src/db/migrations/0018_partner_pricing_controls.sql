-- =============================================================================
-- Partner pricing controls (Super Admin–managed activation price + commission).
--
-- Pricing was already data (prices rows; partners.commission_rate_bps) and
-- every order already snapshots its own amounts (0013 makes that snapshot
-- immutable). What this adds makes "who may change pricing, and how" a
-- database fact rather than only an app-code convention:
--
--   1. A price amount is a positive integer (tetri); a row's financial
--      identity (product, partner, currency, amount, effective_from) is
--      immutable. A price change is "deactivate the old row, insert a new
--      one", so orders.price_id always points at the exact price it paid.
--      (Enforced for the app's app_runtime role; the migration/superuser
--      connection used by operators and CI fixtures is trusted, as with RLS.
--      Orders' own snapshot stays immutable for every role — 0013.)
--   2. At most one ACTIVE platform-default price per product, and at most one
--      ACTIVE override per (product, partner). resolveActivePrice can never
--      see two candidates, and two concurrent admin edits can't both leave an
--      active row behind.
--   3. partners.commission_rate_bps may only be changed by a platform admin.
--      partners_update (0001) also lets a partner's own OWNER/ADMIN update
--      their row (name, locale) — without this, that policy would let a
--      partner raise its own commission.
--
-- Rounding is defined in lib/payments/split.ts: partner commission =
-- floor(gross × bps / 10000), the platform gets the remainder, so
-- gross = commission + platform exactly (orders_amounts_reconcile, 0002).
--
-- Existing local rows were checked before writing this migration (no
-- duplicate active prices, no non-positive amounts); every ADD CONSTRAINT /
-- CREATE UNIQUE INDEX below validates existing data and fails loudly if not.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Price rows: positive, append-only financial identity
-- ---------------------------------------------------------------------------
alter table prices add constraint prices_amount_minor_positive check (amount_minor > 0);
--> statement-breakpoint

create or replace function enforce_price_immutable() returns trigger
language plpgsql as $$
begin
  if current_user = 'app_runtime' and (
     new.product_id is distinct from old.product_id
     or new.partner_id is distinct from old.partner_id
     or new.currency is distinct from old.currency
     or new.amount_minor is distinct from old.amount_minor
     or new.effective_from is distinct from old.effective_from) then
    raise exception 'prices.% is immutable except for active — insert a new price row instead', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger trg_prices_immutable
  before update on prices
  for each row execute function enforce_price_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. One active price per scope
-- ---------------------------------------------------------------------------
create unique index prices_one_active_default_per_product
  on prices (product_id) where active and partner_id is null;
--> statement-breakpoint
create unique index prices_one_active_per_partner_product
  on prices (product_id, partner_id) where active and partner_id is not null;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Commission rate: platform admin only
-- ---------------------------------------------------------------------------
-- Applies to the app's restricted role only. The migration/superuser
-- connection (operators, CI fixtures) is already outside RLS entirely.
create or replace function enforce_partner_commission_admin_only() returns trigger
language plpgsql as $$
begin
  if new.commission_rate_bps is distinct from old.commission_rate_bps
     and current_user = 'app_runtime'
     and not app_is_admin() then
    raise exception 'partners.commission_rate_bps can only be changed by a platform admin'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
--> statement-breakpoint

create trigger trg_partners_commission_admin_only
  before update of commission_rate_bps on partners
  for each row execute function enforce_partner_commission_admin_only();

-- =============================================================================
-- Asynchronous provider refunds (docs/integration/BOG_PAYMENT_MANAGER_PLAN.md §3.6).
--
-- Bank of Georgia accepts a refund request ("request_received") and confirms
-- the money movement later (callback + receipt). One row here is one refund
-- of one charge, from request to its provider-confirmed outcome:
--
--   REQUESTED  → we asked (or are about to ask) the provider
--   COMPLETED  → the provider confirmed the money is returned
--   REJECTED   → the provider refused, or the request was never sent
--
-- Payment/order status and the COMMISSION_REVERSAL change only once a refund
-- is COMPLETED (lib/payments/refunds.ts), so a requested-but-unconfirmed
-- refund never reverses commission or marks anything REFUNDED.
--
-- Hard guarantees:
--   * at most one non-rejected refund per charge (partial unique index) —
--     a second request for the same charge reuses the first;
--   * the refund is for that charge's own order, currency and full amount;
--   * identity and amount columns are immutable; status only moves
--     REQUESTED → COMPLETED | REJECTED, and those are terminal.
-- =============================================================================
create type payment_refund_status as enum ('REQUESTED', 'COMPLETED', 'REJECTED');
--> statement-breakpoint
create type payment_refund_reason as enum ('ADMIN', 'INELIGIBLE', 'DUPLICATE_CAPTURE', 'CHARGEBACK');
--> statement-breakpoint
create table payment_refunds (
  id uuid primary key default gen_random_uuid(),
  -- Cascade only matters to superuser fixture cleanup: the app can never
  -- delete payments or orders (no delete policy on either, migrations/0003).
  payment_id uuid not null references payments(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null,
  reason payment_refund_reason not null,
  status payment_refund_status not null default 'REQUESTED',
  -- The admin who asked, for ADMIN refunds: completion books the reversal
  -- on their behalf (the ledger policy requires an admin context).
  requested_by uuid,
  provider_action_id text,
  provider_code text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint payment_refunds_admin_has_actor check (reason <> 'ADMIN' or requested_by is not null),
  constraint payment_refunds_resolved_when_terminal check ((status = 'REQUESTED') = (resolved_at is null))
);
--> statement-breakpoint
create unique index payment_refunds_one_open_per_payment on payment_refunds (payment_id) where status <> 'REJECTED';
--> statement-breakpoint
create index payment_refunds_order_id_idx on payment_refunds (order_id);
--> statement-breakpoint
create index payment_refunds_requested_idx on payment_refunds (requested_at) where status = 'REQUESTED';
--> statement-breakpoint

create or replace function payment_refunds_integrity() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_payment payments%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_payment from payments where id = new.payment_id;
    if v_payment.order_id is distinct from new.order_id then
      raise exception 'payment_refunds: payment % does not belong to order %', new.payment_id, new.order_id
        using errcode = 'check_violation';
    end if;
    if new.amount_minor <> v_payment.amount_minor or new.currency <> v_payment.currency then
      raise exception 'payment_refunds: only a full refund of payment % (% %) is allowed', new.payment_id, v_payment.amount_minor, v_payment.currency
        using errcode = 'check_violation';
    end if;
    if new.status <> 'REQUESTED' then
      raise exception 'payment_refunds: a refund starts as REQUESTED' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.payment_id is distinct from old.payment_id
     or new.order_id is distinct from old.order_id
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.reason is distinct from old.reason
     or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at then
    raise exception 'payment_refunds.% identity and amount are immutable', old.id using errcode = 'check_violation';
  end if;
  if old.status <> 'REQUESTED' and new.status is distinct from old.status then
    raise exception 'payment_refunds.% is % (terminal)', old.id, old.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger trg_payment_refunds_integrity
  before insert or update on payment_refunds
  for each row execute function payment_refunds_integrity();
--> statement-breakpoint

alter table payment_refunds enable row level security;
--> statement-breakpoint
grant select, insert, update on payment_refunds to app_runtime;
--> statement-breakpoint
-- Same scoping as payments (0003): only the payment service, working on one
-- order it has been handed (app.payment_activation_order_id), or an admin.
create policy payment_refunds_select on payment_refunds for select
  using (app_is_admin() or order_id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid);
--> statement-breakpoint
create policy payment_refunds_insert_by_payment_service on payment_refunds for insert
  with check (order_id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid);
--> statement-breakpoint
create policy payment_refunds_update_by_payment_service on payment_refunds for update
  using (order_id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid);

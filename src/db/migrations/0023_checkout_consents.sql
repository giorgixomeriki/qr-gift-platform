-- Checkout consent evidence (docs/bog-merchant-readiness/PAYMENT_READINESS_2026-11-16.md).
--
-- One row each time the buyer ticks "I agree…" and presses Pay. Written by
-- acceptCheckoutTerms (lib/payments/checkout.ts) under the sender's
-- edit-token context, for that greeting's own PENDING_PAYMENT order only;
-- a real provider payment is created only after the row exists.
--
-- Append-only for the app: app_runtime gets SELECT and INSERT only (UPDATE,
-- DELETE and TRUNCATE from the default privileges are revoked below). Not
-- exposed to anon/authenticated/service_role: migrations/0020's default
-- privileges already exclude them, and nothing is granted to them here.
-- No personal data is stored.

create table checkout_consents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  greeting_id uuid not null references greetings(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  locale text not null,
  consent_text_sha256 text not null,
  policies_effective_date date,
  constraint checkout_consents_locale check (locale in ('ka', 'en')),
  constraint checkout_consents_sha256 check (consent_text_sha256 ~ '^[0-9a-f]{64}$')
);

create index checkout_consents_order_id_idx on checkout_consents (order_id);

alter table checkout_consents enable row level security;

-- postgres's default privileges grant app_runtime full DML on new tables;
-- evidence must not be editable, so take back everything but read + append.
revoke all on checkout_consents from app_runtime;
grant select, insert on checkout_consents to app_runtime;

-- Only the edit-token holder, only for their own greeting's open order.
create policy checkout_consents_insert_by_token on checkout_consents for insert to app_runtime
  with check (
    greeting_id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
    and exists (
      select 1 from orders o
      where o.id = checkout_consents.order_id
        and o.greeting_id = checkout_consents.greeting_id
        and o.status = 'PENDING_PAYMENT'
    )
  );

-- Admins (disputes, audit); the sender for their own greeting; the payment
-- service for the order it is settling.
create policy checkout_consents_select on checkout_consents for select to app_runtime
  using (
    app_is_admin()
    or greeting_id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
    or order_id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid
  );

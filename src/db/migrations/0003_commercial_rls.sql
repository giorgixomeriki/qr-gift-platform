-- =============================================================================
-- Grants for the new commercial tables (app_runtime — see 0001 for why)
-- =============================================================================
grant select, insert, update, delete on orders, payments, partner_ledger_entries, partner_payouts to app_runtime;

-- =============================================================================
-- Narrow the pre-Phase-0.5 self-activation pathways
-- =============================================================================
-- Previously the sender's own edit-token context could flip a greeting straight
-- to ACTIVE (architecture plan Phase 0 §4). The V1 commercial model requires
-- payment confirmation first — "a normal browser/client must NOT be capable of
-- directly setting the Greeting or QR to ACTIVE." Narrowed to DRAFT-only edits;
-- activation now happens exclusively via *_activate_by_payment below.
alter policy greetings_update_by_token on greetings
  using (status = 'DRAFT' and id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid)
  with check (status = 'DRAFT' and id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid);

-- Previously this let the same claim context push a QR through ANY status
-- transition (it was combined with editable_greeting_id for old-style
-- activation). Narrowed to only the original AVAILABLE -> DRAFT claim.
alter policy qr_codes_update_by_claim on qr_codes
  using (status = 'AVAILABLE' and id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid)
  with check (status = 'DRAFT' and id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid);

-- =============================================================================
-- New activation pathway: payment-confirmed only
-- =============================================================================
-- app.payment_activation_order_id is set ONLY inside the trusted server-side
-- payment confirmation service (lib/payments/service.ts), never by any
-- user-facing route handler directly, and never derived from client input —
-- see withPaymentActivation in src/db/client.ts. The WITH CHECK requires a
-- genuinely PAID order (status already committed within the same transaction,
-- read-your-own-writes) referencing this exact greeting/QR — not merely "some
-- context variable is set," so a bug that set this context for the wrong
-- order still can't activate an unpaid greeting.
create policy greetings_activate_by_payment on greetings for update
  using (status = 'DRAFT')
  with check (
    status = 'ACTIVE'
    and exists (
      select 1 from orders o
      where o.id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid
        and o.greeting_id = greetings.id
        and o.status = 'PAID'
    )
  );

create policy qr_codes_activate_by_payment on qr_codes for update
  using (status = 'DRAFT')
  with check (
    status = 'ACTIVE'
    and exists (
      select 1 from orders o
      where o.id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid
        and o.qr_code_id = qr_codes.id
        and o.status = 'PAID'
    )
  );

-- =============================================================================
-- Policies: orders
-- =============================================================================
-- Read: admin, the owning partner (their own commercial data only — never
-- another partner's, never Greeting content), or the sender who holds the
-- edit token for the greeting the order belongs to (so the checkout/preview
-- page can poll its own order's status).
create policy orders_select on orders for select
  using (
    app_is_admin()
    or app_is_partner_member(partner_id)
    or greeting_id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
  );

-- Checkout creation: only the sender who holds the edit token for their own
-- DRAFT greeting, and the inserted qr_code_id/partner_id are cross-checked
-- against what the greeting's QR ACTUALLY resolves to server-side — never
-- trusted from the inserted values alone. This is the RLS backstop behind
-- "Partner attribution MUST come exclusively from the QR record."
create policy orders_insert_by_token on orders for insert
  with check (
    greeting_id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
    and exists (
      select 1 from greetings g
      join qr_codes qc on qc.id = g.qr_code_id
      where g.id = orders.greeting_id
        and g.status = 'DRAFT'
        and qc.id = orders.qr_code_id
        and qc.partner_id = orders.partner_id
    )
  );

-- Status transitions (PENDING_PAYMENT -> PAID/FAILED/...) happen exclusively
-- inside the trusted payment service, never by the sender or partner.
create policy orders_update_by_payment_service on orders for update
  using (id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid);

create policy orders_update_admin on orders for update
  using (app_is_admin());

-- =============================================================================
-- Policies: payments
-- =============================================================================
-- No sender or partner visibility at all — provider-level payment detail isn't
-- needed by either surface (the sender polls orders.status; the partner
-- dashboard reads orders/ledger, not raw payment records).
create policy payments_select on payments for select
  using (app_is_admin());

create policy payments_insert_by_payment_service on payments for insert
  with check (order_id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid);

create policy payments_update_by_payment_service on payments for update
  using (order_id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid);

-- =============================================================================
-- Policies: partner_ledger_entries (append-only — no update/delete policy)
-- =============================================================================
create policy partner_ledger_entries_select on partner_ledger_entries for select
  using (app_is_admin() or app_is_partner_member(partner_id));

-- COMMISSION_EARNED is written only by the payment service, scoped to the
-- specific order it just confirmed (the partial unique index on
-- (order_id) WHERE type='COMMISSION_EARNED' is the hard duplicate guard).
-- COMMISSION_REVERSAL/PAYOUT/ADJUSTMENT are admin-only for now.
create policy partner_ledger_entries_insert on partner_ledger_entries for insert
  with check (
    app_is_admin()
    or (
      type = 'COMMISSION_EARNED'
      and order_id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid
    )
  );

-- =============================================================================
-- Policies: partner_payouts
-- =============================================================================
create policy partner_payouts_select on partner_payouts for select
  using (app_is_admin() or app_is_partner_member(partner_id));

create policy partner_payouts_insert on partner_payouts for insert
  with check (app_is_admin());

create policy partner_payouts_update on partner_payouts for update
  using (app_is_admin());

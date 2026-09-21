-- =============================================================================
-- Checkout needs a partner's commission rate to compute the commercial split,
-- but `partners` itself isn't publicly readable (only admin/its own members).
-- SECURITY DEFINER, same rationale as app_partner_role in 0001: exposes only
-- this one numeric field, never the partner's full row, to an unauthenticated
-- checkout request.
-- =============================================================================
create or replace function app_partner_commission_rate_bps(p_partner_id uuid) returns integer
language sql stable security definer set search_path = public as $$
  select commission_rate_bps from partners where id = p_partner_id
$$;

revoke execute on function app_partner_commission_rate_bps(uuid) from public;
grant execute on function app_partner_commission_rate_bps(uuid) to app_runtime;

-- =============================================================================
-- SELECT policies for the trusted payment-service context (missed in 0003 —
-- confirmPaymentSuccess/activatePaidOrder need to SELECT ... FOR UPDATE and
-- read back UPDATE ... RETURNING rows, both of which require a matching
-- SELECT policy in addition to the UPDATE policies already added).
-- =============================================================================
create policy orders_select_by_payment_service on orders for select
  using (id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid);

create policy payments_select_by_payment_service on payments for select
  using (order_id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid);

-- =============================================================================
-- Enforce partner suspension (Phase 1 "Partner status management"). Until now
-- `partners.status` was purely decorative — SUSPENDED had no actual effect.
-- A suspended partner's own OWNER/ADMIN/STAFF can no longer create QR batches,
-- mint QR codes, or mark distribution; admins are exempt (they need to be able
-- to act on a suspended partner to investigate/fix/reactivate it).
-- =============================================================================
create or replace function app_partner_is_active(p_partner_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select status = 'ACTIVE' from partners where id = p_partner_id
$$;

revoke execute on function app_partner_is_active(uuid) from public;
grant execute on function app_partner_is_active(uuid) to app_runtime;

alter policy qr_batches_insert on qr_batches
  with check (app_is_admin() or (app_partner_role(partner_id) in ('OWNER', 'ADMIN') and app_partner_is_active(partner_id)));

alter policy qr_codes_insert on qr_codes
  with check (app_is_admin() or (app_partner_role(partner_id) in ('OWNER', 'ADMIN') and app_partner_is_active(partner_id)));

alter policy qr_codes_update_staff on qr_codes
  using (app_is_admin() or (app_partner_role(partner_id) in ('OWNER', 'ADMIN', 'STAFF') and app_partner_is_active(partner_id)));

-- Payment release safety (docs/bog-release/BOG_RELEASE_2026-11-21.md).
-- Closes the functional audit's FA-02 and FA-01 in the database, so the app
-- code is not the only line of defence. Additive only: one policy, one
-- policy, one trigger. No data is changed.

-- =============================================================================
-- FA-02: an ADMIN/CHARGEBACK refund completes without the requesting admin.
-- =============================================================================
-- BOG confirms a refund days after it is asked for. Completion used to book
-- the COMMISSION_REVERSAL under the requesting admin's identity, so a revoked
-- admin left the order PAID and the commission unreversed while the money was
-- already back with the customer. The payment service may now book exactly
-- that reversal for exactly the order it is settling, and only once a
-- COMPLETED refund of that order exists in the same transaction.
-- enforce_ledger_entry_integrity (0013) still requires a REFUNDED order, an
-- earlier COMMISSION_EARNED and the exact negated commission; the partial
-- unique index still allows one reversal per order.
create policy partner_ledger_entries_insert_refund_completion on partner_ledger_entries for insert
  with check (
    type = 'COMMISSION_REVERSAL'
    and order_id = nullif(current_setting('app.payment_activation_order_id', true), '')::uuid
    and exists (
      select 1 from payment_refunds r
      where r.order_id = partner_ledger_entries.order_id
        and r.status = 'COMPLETED'
        and r.reason in ('ADMIN', 'CHARGEBACK')
    )
  );
--> statement-breakpoint

-- =============================================================================
-- FA-01: an abandoned draft can be released back to inventory, by an admin only.
-- =============================================================================
-- greetings.qr_code_id is unique and immutable (0013), so a card keeps its one
-- greeting row for life. An admin release (lib/greetings/release.ts) erases
-- the abandoned draft's content, clears its edit token hash (the old link
-- stops working) and returns the QR to AVAILABLE. The next sender who starts
-- the card re-claims that same row with a fresh token, in the same
-- transaction as the AVAILABLE -> DRAFT claim.
--
-- A DRAFT greeting without an edit token hash exists only after a release:
-- startGreeting always sets one, and no other code path clears it on a draft.
create policy greetings_reclaim_released on greetings for update
  using (
    status = 'DRAFT'
    and edit_token_hash is null
    and qr_code_id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid
  )
  with check (
    status = 'DRAFT'
    and edit_token_hash is not null
    and qr_code_id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid
    and exists (select 1 from qr_codes q where q.id = greetings.qr_code_id and q.status = 'DRAFT')
  );
--> statement-breakpoint

-- Card status transitions for the application role. qr_codes_update_staff
-- (0001/0006) lets partner staff update their cards, which the app uses only
-- for distribution; it also let them rewrite status (audit P2), e.g. push a
-- customer's DRAFT card back to AVAILABLE so that someone else could start
-- it. From here on, for app_runtime:
--   AVAILABLE -> DRAFT    the sender's claim (app.claimable_qr_id = this card)
--   DRAFT -> ACTIVE       payment activation (qr_codes_activate_by_payment checks the PAID order)
--   DRAFT -> AVAILABLE    an admin release of this card (app.draft_release_qr_id),
--                         only with no live order and with the greeting already reset
--   anything else         a platform admin (moderation: block / unblock)
-- Other roles (migrations, ops scripts, seeds) are not app traffic and are
-- not restricted here. Not SECURITY DEFINER on purpose: current_user is the
-- caller, and RLS still applies to the checks below.
create or replace function enforce_qr_status_transition() returns trigger
language plpgsql as $$
begin
  if new.status is not distinct from old.status or current_user <> 'app_runtime' then
    return new;
  end if;

  if old.status = 'AVAILABLE' and new.status = 'DRAFT'
     and new.id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid then
    return new;
  end if;

  if old.status = 'DRAFT' and new.status = 'ACTIVE'
     and nullif(current_setting('app.payment_activation_order_id', true), '') is not null then
    return new;
  end if;

  if old.status = 'DRAFT' and new.status = 'AVAILABLE' then
    if not (app_is_admin() and new.id = nullif(current_setting('app.draft_release_qr_id', true), '')::uuid) then
      raise exception 'qr_codes.% can return to AVAILABLE only through an admin draft release', new.id
        using errcode = 'insufficient_privilege';
    end if;
    if exists (
      select 1 from orders o
      where o.qr_code_id = new.id and o.status not in ('FAILED', 'CANCELED')
    ) then
      raise exception 'qr_codes.% has an order that is not failed or canceled; it cannot be released', new.id
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from greetings g
      where g.qr_code_id = new.id and (g.status <> 'DRAFT' or g.edit_token_hash is not null)
    ) then
      raise exception 'qr_codes.% greeting must be a reset DRAFT before release', new.id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if app_is_admin() then
    return new;
  end if;

  raise exception 'qr_codes.% status % -> % is not permitted for this caller', new.id, old.status, new.status
    using errcode = 'insufficient_privilege';
end;
$$;
--> statement-breakpoint

create trigger trg_qr_codes_status_transition
  before update of status on qr_codes
  for each row execute function enforce_qr_status_transition();

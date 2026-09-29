-- =============================================================================
-- Purchase eligibility (pilot QA fixes QA-02 / QA-03 / QA-04).
--
-- One database-side definition of "may this greeting be bought right now?",
-- used by the app before creating an order or confirming a payment, and by
-- RLS as a backstop so a bug in app code still cannot create an order for an
-- ineligible greeting or claim a card of a suspended partner.
-- =============================================================================

-- A payment the provider captured for a greeting that was no longer eligible
-- by the time it arrived (blocked by moderation, partner suspended, message
-- missing). No commission, no activation; the money must go back to the
-- customer. REFUNDED once the provider confirms the refund.
alter type order_status add value if not exists 'REFUND_REQUIRED';
--> statement-breakpoint

-- Returns NULL when the greeting is purchasable, otherwise a reason code:
--   GREETING_NOT_FOUND | GREETING_NOT_DRAFT | QR_NOT_DRAFT |
--   PARTNER_SUSPENDED  | MISSING_MESSAGE
-- p_lock = true takes a row lock on the greeting for the rest of the caller's
-- transaction, so a concurrent moderation block waits until the payment
-- decision has committed (and vice versa) instead of interleaving with it.
-- The message rule mirrors the product: a message is the one required part
-- of a greeting (greetingMessageSchema, min 1 after trim); media is optional.
create or replace function app_greeting_purchase_blocker(p_greeting_id uuid, p_lock boolean default false)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_greeting_status text;
  v_qr_code_id uuid;
  v_qr_status text;
  v_partner_status text;
begin
  if p_lock then
    select status::text, qr_code_id into v_greeting_status, v_qr_code_id
      from greetings where id = p_greeting_id for update;
  else
    select status::text, qr_code_id into v_greeting_status, v_qr_code_id
      from greetings where id = p_greeting_id;
  end if;
  if not found then return 'GREETING_NOT_FOUND'; end if;
  if v_greeting_status <> 'DRAFT' then return 'GREETING_NOT_DRAFT'; end if;

  select q.status::text, p.status::text into v_qr_status, v_partner_status
    from qr_codes q join partners p on p.id = q.partner_id
   where q.id = v_qr_code_id;
  if v_qr_status is distinct from 'DRAFT' then return 'QR_NOT_DRAFT'; end if;
  if v_partner_status is distinct from 'ACTIVE' then return 'PARTNER_SUSPENDED'; end if;

  if not exists (
    select 1 from greeting_content c
     where c.greeting_id = p_greeting_id
       and c.type = 'text'
       and c.status = 'READY'
       -- any non-whitespace character (btrim alone only strips spaces)
       and coalesce(c.text_value, '') ~ '\S'
  ) then
    return 'MISSING_MESSAGE';
  end if;

  return null;
end;
$$;
--> statement-breakpoint

revoke execute on function app_greeting_purchase_blocker(uuid, boolean) from public;
--> statement-breakpoint
grant execute on function app_greeting_purchase_blocker(uuid, boolean) to app_runtime;
--> statement-breakpoint

-- QA-04: a suspended partner's AVAILABLE cards can no longer be claimed.
alter policy qr_codes_update_by_claim on qr_codes
  using (status = 'AVAILABLE' and id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid and app_partner_is_active(partner_id))
  with check (status = 'DRAFT' and id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid and app_partner_is_active(partner_id));
--> statement-breakpoint

-- QA-02/03/04: no order can be created for a greeting that isn't purchasable.
alter policy orders_insert_by_token on orders
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
    and app_greeting_purchase_blocker(orders.greeting_id) is null
  );

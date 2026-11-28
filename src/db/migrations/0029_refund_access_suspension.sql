-- =============================================================================
-- Refund Model C — public access to a greeting is suspended after a confirmed
-- full refund (owner decision M5 + Refund Model C, 2026-11-25).
--
-- 1. app_greeting_refund_suspended(greeting_id) — the ONE authority for "has
--    this greeting's purchase been fully returned". True when the greeting has
--    an order in REFUNDED and no order in PAID. REFUNDED is set only by a
--    completed ADMIN refund or a recorded CHARGEBACK of a PAID order
--    (lib/payments/refunds.ts applyRefundCompletion); a DUPLICATE_CAPTURE
--    refund leaves the order PAID, and PARTIALLY_REFUNDED is not REFUNDED, so
--    neither suspends a paid greeting. SECURITY DEFINER because the public
--    context cannot read orders (orders_select); it returns one boolean and
--    nothing else.
--
-- 2. greeting_content_select: the public branch now also requires the
--    greeting NOT to be refund-suspended, so content rows (and so media
--    storage keys) of a refunded greeting cannot be read publicly even if an
--    app-layer check were bypassed. Admin and the sender's own DRAFT branch
--    are unchanged.
--
-- Nothing is deleted or rewritten: greetings, greeting_content, media,
-- qr_codes (token + status), orders, payments, refunds and the partner
-- ledger are untouched. Rollback: docs/refund-model-c/rollback-0029.sql.
-- =============================================================================

create or replace function app_greeting_refund_suspended(p_greeting_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orders o where o.greeting_id = p_greeting_id and o.status = 'REFUNDED')
     and not exists (select 1 from orders o where o.greeting_id = p_greeting_id and o.status = 'PAID')
$$;
--> statement-breakpoint
revoke execute on function app_greeting_refund_suspended(uuid) from public;
--> statement-breakpoint
grant execute on function app_greeting_refund_suspended(uuid) to app_runtime;
--> statement-breakpoint

drop policy if exists greeting_content_select on greeting_content;
--> statement-breakpoint
-- TO app_runtime: every public policy is scoped to the app role since migrations/0020.
create policy greeting_content_select on greeting_content for select to app_runtime
  using (
    app_is_admin()
    or exists (
      select 1 from greetings g
      where g.id = greeting_content.greeting_id
        and (
          (g.status = 'ACTIVE' and not app_greeting_refund_suspended(g.id))
          or g.id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
        )
    )
  );

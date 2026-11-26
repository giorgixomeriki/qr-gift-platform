-- =============================================================================
-- Scheduled Reveal + Celebration Countdown (docs/countdown/SCHEDULED-REVEAL.md)
--
-- 1. greetings.unlock_at / unlock_time_zone — the sender may choose when the
--    recipient can open the greeting. Before that instant the QR still scans,
--    but only a locked envelope and a countdown are shown; no message, no
--    media URL, no countdown details leave the server.
--
-- 2. 'countdown' content type — an optional countdown to another event, stored
--    like "Our Song": one greeting_content row (slot 0) whose text_value is a
--    validated JSON document (src/lib/greetings/countdown.ts). Being content,
--    it is covered by greeting_content's RLS and by the unlock rule below.
--
-- 3. app_greeting_public_state(greeting_id) — the ONE authority for "may the
--    public see this greeting's content right now", evaluated on the database
--    clock (now()), so the page, the media signer and RLS can never disagree
--    about whether the moment has come (no app-server clock involved):
--      OPEN       greeting ACTIVE, QR ACTIVE, unlocked, not refunded
--      SCHEDULED  as OPEN but unlock_at is still in the future
--      SUSPENDED  a confirmed full refund — delegated to Refund Model C's
--                 app_greeting_refund_suspended() (migrations/0029), never
--                 re-implemented here. Checked BEFORE the schedule: a
--                 countdown can never re-open a refunded greeting.
--      UNAVAILABLE anything else (draft, blocked, missing)
--    The 12-month availability window stays in the app (lib/greetings/
--    availability.ts) exactly as before.
--
-- 4. greeting_content_select: the public branch now requires
--    app_greeting_public_state(...) = 'OPEN' instead of 0029's
--    "ACTIVE and not refund-suspended" (OPEN implies both). Admin and the sender's own DRAFT branch are unchanged.
--
-- 5. Once a greeting leaves DRAFT its schedule is frozen (trigger), whoever
--    the caller is: what the sender paid for is what the recipient gets.
--
-- Requires 0029_refund_access_suspension (app_greeting_refund_suspended).
-- Nothing here touches orders, payments, ledger, inventory or qr_codes.
-- Additive and idempotent where possible; rollback: docs/countdown/rollback-0030.sql
-- =============================================================================

alter table greetings add column if not exists unlock_at timestamptz;
--> statement-breakpoint
alter table greetings add column if not exists unlock_time_zone text;
--> statement-breakpoint
alter table greetings drop constraint if exists greetings_unlock_pair;
--> statement-breakpoint
alter table greetings add constraint greetings_unlock_pair check (
  (unlock_at is null and unlock_time_zone is null)
  or (unlock_at is not null and unlock_time_zone is not null and length(unlock_time_zone) between 1 and 64)
);
--> statement-breakpoint

insert into content_types (key, category, active)
values ('countdown', 'event', true)
on conflict (key) do nothing;
--> statement-breakpoint

create or replace function app_greeting_public_state(p_greeting_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when g.id is null then 'UNAVAILABLE'
    when g.status <> 'ACTIVE' then 'UNAVAILABLE'
    when not exists (select 1 from qr_codes q where q.id = g.qr_code_id and q.status = 'ACTIVE') then 'UNAVAILABLE'
    when app_greeting_refund_suspended(g.id) then 'SUSPENDED'
    when g.unlock_at is not null and g.unlock_at > now() then 'SCHEDULED'
    else 'OPEN'
  end
  from (select 1) one
  left join greetings g on g.id = p_greeting_id
$$;
--> statement-breakpoint
revoke execute on function app_greeting_public_state(uuid) from public;
--> statement-breakpoint
grant execute on function app_greeting_public_state(uuid) to app_runtime;
--> statement-breakpoint

drop policy if exists greeting_content_select on greeting_content;
--> statement-breakpoint
-- TO app_runtime: every public policy is scoped to the app role since migrations/0020 (verify:data-api-lockdown A7).
create policy greeting_content_select on greeting_content for select to app_runtime
  using (
    app_is_admin()
    or app_greeting_public_state(greeting_content.greeting_id) = 'OPEN'
    or exists (
      select 1 from greetings g
      where g.id = greeting_content.greeting_id
        and g.id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
    )
  );
--> statement-breakpoint

create or replace function enforce_greeting_schedule_frozen()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'DRAFT'
     and (new.unlock_at is distinct from old.unlock_at or new.unlock_time_zone is distinct from old.unlock_time_zone) then
    raise exception 'greetings.% schedule is frozen once the greeting leaves DRAFT', old.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
revoke execute on function enforce_greeting_schedule_frozen() from public;
--> statement-breakpoint
drop trigger if exists trg_greetings_schedule_frozen on greetings;
--> statement-breakpoint
create trigger trg_greetings_schedule_frozen
  before update of unlock_at, unlock_time_zone on greetings
  for each row execute function enforce_greeting_schedule_frozen();
--> statement-breakpoint

-- Countdown content is frozen with the rest of the content by the existing
-- DRAFT-only insert/update/delete policies; nothing new needed there.

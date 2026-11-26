-- =============================================================================
-- Rollback of 0030_greeting_schedule (Scheduled Reveal + Celebration Countdown)
--
-- ORDER: redeploy the previous app version FIRST, then run this.
--   * Old code + 0030 still in the DB is fail-closed: a scheduled greeting's
--     content stays hidden by RLS until its moment (the page shows an empty
--     greeting instead of a lock, but nothing leaks early).
--   * This script REFUSES to run while any ACTIVE greeting is still waiting
--     for its unlock moment: dropping the schedule would open it early.
--     Wait until they have opened, or contact the senders first.
--
-- Kept on purpose (harmless to old code, which ignores them): the 'countdown'
-- content_types row and any 'countdown' greeting_content rows.
-- Refund Model C (0029) is NOT rolled back: app_greeting_refund_suspended()
-- is kept and greeting_content_select is restored to its exact 0029 form, so a
-- refunded greeting stays hidden after this rollback.
-- =============================================================================
do $$
begin
  if exists (select 1 from greetings where status = 'ACTIVE' and unlock_at > now()) then
    raise exception 'rollback-0030: % ACTIVE greeting(s) are still scheduled to open later; rolling back would open them early',
      (select count(*) from greetings where status = 'ACTIVE' and unlock_at > now());
  end if;
end $$;

drop policy if exists greeting_content_select on greeting_content;
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

drop trigger if exists trg_greetings_schedule_frozen on greetings;
drop function if exists enforce_greeting_schedule_frozen();
drop function if exists app_greeting_public_state(uuid);
alter table greetings drop constraint if exists greetings_unlock_pair;
alter table greetings drop column if exists unlock_at;
alter table greetings drop column if exists unlock_time_zone;

delete from drizzle.__drizzle_migrations where hash = (select hash from drizzle.__drizzle_migrations order by created_at desc limit 1)
  and created_at = 1795766400000;

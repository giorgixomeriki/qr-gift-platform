-- Rollback for 0029_refund_access_suspension. Run as the migrations role, in one transaction.
-- Restores greeting_content_select exactly as 0001 + 0020 left it, then drops the helper and the ledger row.
-- Roll the APP back first (code from before Model C never calls app_greeting_refund_suspended).
begin;
drop policy if exists greeting_content_select on greeting_content;
create policy greeting_content_select on greeting_content for select to app_runtime
  using (
    app_is_admin()
    or exists (
      select 1 from greetings g
      where g.id = greeting_content.greeting_id
        and (
          g.status = 'ACTIVE'
          or g.id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
        )
    )
  );
drop function if exists app_greeting_refund_suspended(uuid);
delete from drizzle.__drizzle_migrations where created_at = 1795680000000;
commit;

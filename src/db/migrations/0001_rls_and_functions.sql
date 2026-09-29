-- =============================================================================
-- Restricted runtime role
-- =============================================================================
-- Supabase's default local superuser ("postgres") BYPASSES row level security
-- entirely, so RLS policies below would be silently no-ops if the app connected
-- as that role. `app_runtime` is what src/db/client.ts actually connects as at
-- runtime; only drizzle-kit migrations use the superuser connection.
--
-- The password below is a fixed LOCAL-DEV-ONLY value, mirroring Supabase CLI's
-- own convention of shipping fixed local credentials (postgres/postgres, the
-- demo JWT secret, etc). It must be rotated before any non-local deployment —
-- see README. It is never used to authenticate anything except this local
-- Postgres instance.
--
-- IMPORTANT (audit finding F-01): because this migration is forward-only and
-- immutable, running `npm run db:migrate` against a FRESH production/staging
-- database creates app_runtime with this exact, publicly-visible password —
-- migrations cannot "skip" this line for production. The mandatory step
-- immediately after the first production migration run is:
--   ALTER ROLE app_runtime WITH PASSWORD '<fresh output of: openssl rand -base64 32>';
-- then update that environment's DATABASE_URL secret to match, before any
-- application traffic is pointed at that database. See
-- docs/PILOT_LAUNCH_CHECKLIST.md §1/§3 for this as an explicit deploy-runbook step.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime with
      login
      password 'HH1mUPcwnyz1NGyM8jbeLsQqbwc'
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      nobypassrls;
  end if;
end
$$;

grant usage on schema public to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
alter default privileges in schema public grant select, insert, update, delete on tables to app_runtime;

-- =============================================================================
-- Context helper functions
-- =============================================================================
-- These read Postgres session variables set via `set_config(..., true)` inside a
-- transaction (see withPartnerContext / withAdminContext / withEditableGreeting /
-- withClaimableQr in src/db/client.ts). `true` scopes the setting to the current
-- transaction (SET LOCAL semantics), so it can never leak across pooled
-- connections into an unrelated request.
--
-- SECURITY DEFINER + fixed search_path: these functions query admin_users /
-- partner_members / greetings, tables whose OWN select policies call these same
-- functions. Without SECURITY DEFINER, evaluating e.g. admin_users' policy would
-- re-invoke app_is_admin(), which re-queries admin_users, re-evaluating the same
-- policy — infinite recursion. SECURITY DEFINER makes the function body run as
-- its owner (the migration superuser), which bypasses RLS for that lookup only;
-- the function's own return value is still what every other table's policy is
-- conditioned on, so this does not widen what any caller can see.

create or replace function app_current_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Role a user holds on a specific partner, or NULL if they are not a member.
-- This is the single source of truth partner authorization checks build on —
-- it is deliberately NOT derived from any client-supplied partnerId, only from
-- the verified app.user_id set by server code after checking a Supabase session.
create or replace function app_partner_role(p_partner_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select pm.role::text
  from partner_members pm
  where pm.partner_id = p_partner_id
    and pm.user_id = app_current_user_id()
  limit 1
$$;

create or replace function app_is_partner_member(p_partner_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app_partner_role(p_partner_id) is not null
$$;

create or replace function app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admin_users au where au.user_id = app_current_user_id()
  )
$$;

-- Resolves the owning partner of a greeting via its QR code, for policies on
-- greetings/greeting_content that need to check partner membership.
create or replace function app_greeting_partner_id(p_greeting_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select qc.partner_id
  from greetings g
  join qr_codes qc on qc.id = g.qr_code_id
  where g.id = p_greeting_id
$$;

revoke execute on function app_current_user_id() from public;
revoke execute on function app_partner_role(uuid) from public;
revoke execute on function app_is_partner_member(uuid) from public;
revoke execute on function app_is_admin() from public;
revoke execute on function app_greeting_partner_id(uuid) from public;
grant execute on function app_current_user_id() to app_runtime;
grant execute on function app_partner_role(uuid) to app_runtime;
grant execute on function app_is_partner_member(uuid) to app_runtime;
grant execute on function app_is_admin() to app_runtime;
grant execute on function app_greeting_partner_id(uuid) to app_runtime;

-- =============================================================================
-- Policies: admin_users
-- =============================================================================
-- No insert/update/delete policy is defined for app_runtime on purpose: the
-- app can never grant itself or anyone else admin rights. Admin provisioning is
-- a superuser/migration-only operation, off the app's attack surface entirely.
create policy admin_users_select on admin_users for select
  using (app_is_admin());

-- =============================================================================
-- Policies: partners / partner_members
-- =============================================================================
create policy partners_select on partners for select
  using (app_is_admin() or app_is_partner_member(id));

create policy partners_insert on partners for insert
  with check (app_is_admin());

create policy partners_update on partners for update
  using (app_is_admin() or app_partner_role(id) in ('OWNER', 'ADMIN'));

create policy partner_members_select on partner_members for select
  using (app_is_admin() or app_is_partner_member(partner_id));

create policy partner_members_insert on partner_members for insert
  with check (app_is_admin() or app_partner_role(partner_id) in ('OWNER', 'ADMIN'));

create policy partner_members_update on partner_members for update
  using (app_is_admin() or app_partner_role(partner_id) in ('OWNER', 'ADMIN'));

create policy partner_members_delete on partner_members for delete
  using (app_is_admin() or app_partner_role(partner_id) in ('OWNER', 'ADMIN'));

-- =============================================================================
-- Policies: reference/config data (themes, products, prices, content_types)
-- =============================================================================
-- These need to be readable with NO actor context at all: an anonymous sender
-- picking a theme, or reading the price of a product, has no Supabase session.
create policy themes_select on themes for select
  using (active or app_is_admin());
create policy themes_write on themes for insert with check (app_is_admin());
create policy themes_update on themes for update using (app_is_admin());

create policy products_select on products for select
  using (active or app_is_admin());
create policy products_write on products for insert with check (app_is_admin());
create policy products_update on products for update using (app_is_admin());

create policy prices_select on prices for select
  using (active or app_is_admin() or (partner_id is not null and app_is_partner_member(partner_id)));
create policy prices_write on prices for insert with check (app_is_admin());
create policy prices_update on prices for update using (app_is_admin());

create policy content_types_select on content_types for select
  using (active or app_is_admin());
create policy content_types_write on content_types for insert with check (app_is_admin());
create policy content_types_update on content_types for update using (app_is_admin());

-- =============================================================================
-- Policies: qr_batches
-- =============================================================================
create policy qr_batches_select on qr_batches for select
  using (app_is_admin() or app_is_partner_member(partner_id));

create policy qr_batches_insert on qr_batches for insert
  with check (app_is_admin() or app_partner_role(partner_id) in ('OWNER', 'ADMIN'));

create policy qr_batches_update on qr_batches for update
  using (app_is_admin() or app_partner_role(partner_id) in ('OWNER', 'ADMIN'));

-- =============================================================================
-- Policies: qr_codes
-- =============================================================================
-- Publicly readable: the QR public_token is the permanent, unguessable public
-- identity (architecture plan §5/§9) and the recipient/sender flows resolve
-- state with NO actor context. There is deliberately no "list all QR codes"
-- endpoint anywhere in the app, so this does not expose an enumeration surface
-- — entropy of public_token is the actual protection, not row-level secrecy.
create policy qr_codes_select on qr_codes for select using (true);

create policy qr_codes_insert on qr_codes for insert
  with check (app_is_admin() or app_partner_role(partner_id) in ('OWNER', 'ADMIN'));

-- Admin/partner-staff-driven changes (e.g. blocking).
create policy qr_codes_update_staff on qr_codes for update
  using (app_is_admin() or app_partner_role(partner_id) in ('OWNER', 'ADMIN', 'STAFF'));

-- Anonymous sender-driven state transitions (AVAILABLE -> DRAFT -> ACTIVE). The
-- app sets app.claimable_qr_id ONLY after independently verifying the
-- transition is legitimate (row currently AVAILABLE for draft-start, or the
-- presented edit token hash matches for activation) — this policy is a narrow
-- capability grant, not a trust decision by itself.
create policy qr_codes_update_by_claim on qr_codes for update
  using (id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid);

-- =============================================================================
-- Policies: greetings
-- =============================================================================
-- Row visibility here is metadata-only (id/status/theme/product), never
-- content — greeting_content stays gated separately below. A DRAFT row's mere
-- existence is no more sensitive than its parent QR's DRAFT status, which is
-- already public (qr_codes_select); the public dispatcher (resolveQrState)
-- needs this to render "draft in progress" instead of a false "blocked".
create policy greetings_select on greetings for select
  using (
    status in ('ACTIVE', 'DRAFT')
    or app_is_admin()
    or id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
    or app_is_partner_member(app_greeting_partner_id(id))
  );

-- A greeting can only ever be created as the child of the QR the caller has
-- just legitimately claimed in this same transaction (see qr_codes_update_by_claim).
create policy greetings_insert_by_claim on greetings for insert
  with check (qr_code_id = nullif(current_setting('app.claimable_qr_id', true), '')::uuid);

-- Sender content edits + the DRAFT -> ACTIVE activation transition.
create policy greetings_update_by_token on greetings for update
  using (status = 'DRAFT' and id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid)
  with check (status in ('DRAFT', 'ACTIVE') and id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid);

-- Moderation (block/delete). Partners intentionally have no update policy here:
-- per the architecture plan, partners get sales/analytics visibility into
-- greetings but do not edit or moderate greeting content — only admins do.
create policy greetings_update_admin on greetings for update
  using (app_is_admin());

-- =============================================================================
-- Policies: greeting_content
-- =============================================================================
create policy greeting_content_select on greeting_content for select
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

create policy greeting_content_insert on greeting_content for insert
  with check (
    greeting_id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
    and exists (select 1 from greetings g where g.id = greeting_id and g.status = 'DRAFT')
  );

create policy greeting_content_update on greeting_content for update
  using (
    app_is_admin()
    or (
      greeting_id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
      and exists (select 1 from greetings g where g.id = greeting_id and g.status = 'DRAFT')
    )
  );

create policy greeting_content_delete on greeting_content for delete
  using (
    app_is_admin()
    or (
      greeting_id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
      and exists (select 1 from greetings g where g.id = greeting_id and g.status = 'DRAFT')
    )
  );

-- =============================================================================
-- Policies: reports
-- =============================================================================
-- Anyone can file a report against a currently-active greeting (the recipient
-- "Report" affordance has no auth) — but not against a draft or nonexistent id.
create policy reports_insert on reports for insert
  with check (exists (select 1 from greetings g where g.id = greeting_id and g.status = 'ACTIVE'));

create policy reports_select on reports for select
  using (app_is_admin());

create policy reports_update on reports for update
  using (app_is_admin());

-- =============================================================================
-- Policies: audit_logs (append-only)
-- =============================================================================
-- Written only via lib/audit.ts, never with raw/free-text user input, so a
-- permissive insert policy at the RLS layer is an acceptable tradeoff — the
-- real gate is the typed helper, same pattern as analytics_events below.
create policy audit_logs_insert on audit_logs for insert
  with check (true);

create policy audit_logs_select on audit_logs for select
  using (app_is_admin());

-- =============================================================================
-- Policies: analytics_events (append-only)
-- =============================================================================
create policy analytics_events_insert on analytics_events for insert
  with check (true);

create policy analytics_events_select on analytics_events for select
  using (app_is_admin() or (partner_id is not null and app_is_partner_member(partner_id)));

-- =============================================================================
-- Invariant: an ACTIVE QR must reference exactly one ACTIVE greeting
-- =============================================================================
create or replace function enforce_qr_active_has_active_greeting() returns trigger
language plpgsql as $$
begin
  if new.status = 'ACTIVE' and not exists (
    select 1 from greetings g where g.qr_code_id = new.id and g.status = 'ACTIVE'
  ) then
    raise exception 'qr_codes.% cannot become ACTIVE without a referencing ACTIVE greeting', new.id;
  end if;
  return new;
end;
$$;

create trigger trg_qr_codes_activation_invariant
  before insert or update on qr_codes
  for each row execute function enforce_qr_active_has_active_greeting();

-- If a greeting is blocked or deleted while its QR is ACTIVE, the recipient
-- experience must stop being servable too — otherwise moderation would be
-- pointless (content gone from the dashboard but still live behind the QR).
create or replace function cascade_greeting_block_to_qr() returns trigger
language plpgsql as $$
begin
  if new.status in ('BLOCKED', 'DELETED') and old.status = 'ACTIVE' then
    update qr_codes set status = 'BLOCKED' where id = new.qr_code_id and status = 'ACTIVE';
  end if;
  return new;
end;
$$;

create trigger trg_greeting_block_cascade
  after update on greetings
  for each row execute function cascade_greeting_block_to_qr();

-- Partner login access: contact details, invitations, verified claiming.
--
-- One partner = one login account. The admin records the partner's contact
-- (Georgian mobile and/or email). A login is linked to the partner only after
-- its owner proves control of that contact:
--   EMAIL  a single-use activation link, delivered to the address, valid for
--          a few days. Only its SHA-256 is stored here.
--   PHONE  an SMS one-time code from Supabase Auth. The phone the session
--          verified must equal the invitation's phone.
-- partner_members stays the only grant of partner access. This migration
-- adds no new path into it except app_accept_partner_invitation(), which
-- re-checks every rule under row locks.
--
-- Changes nothing about QR activation, orders, payments, the ledger or any
-- existing membership. Existing partners keep their logins; their contact
-- columns start empty.

alter table partners add column contact_email text;
--> statement-breakpoint
alter table partners add column contact_phone text;
--> statement-breakpoint
alter table partners add constraint partners_contact_email_format
  check (contact_email is null or (contact_email = lower(btrim(contact_email)) and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(contact_email) <= 254));
--> statement-breakpoint
-- Georgian mobile numbers only, E.164: +995 5XX XXX XXX.
alter table partners add constraint partners_contact_phone_format
  check (contact_phone is null or contact_phone ~ '^\+9955[0-9]{8}$');
--> statement-breakpoint
-- A contact identifies exactly one partner, so a code or link can never be
-- ambiguous about which partner it opens.
create unique index partners_contact_email_unique on partners (contact_email) where contact_email is not null;
--> statement-breakpoint
create unique index partners_contact_phone_unique on partners (contact_phone) where contact_phone is not null;
--> statement-breakpoint

create type partner_invitation_channel as enum ('EMAIL', 'PHONE');
--> statement-breakpoint
create type partner_invitation_purpose as enum ('ACTIVATION', 'RECOVERY');
--> statement-breakpoint
create type partner_invitation_status as enum ('PENDING', 'ACCEPTED', 'REVOKED');
--> statement-breakpoint

create table partner_invitations (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  channel partner_invitation_channel not null,
  purpose partner_invitation_purpose not null default 'ACTIVATION',
  -- Normalized: lowercase email, or +9955XXXXXXXX.
  contact text not null,
  -- SHA-256 (hex) of the emailed token. PHONE invitations carry no token:
  -- the SMS code is the proof.
  token_hash text unique,
  -- RECOVERY only: the existing login whose password may be reset.
  target_user_id uuid,
  status partner_invitation_status not null default 'PENDING',
  expires_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  accepted_user_id uuid,
  accepted_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  constraint partner_invitations_token_by_channel
    check ((channel = 'EMAIL') = (token_hash is not null)),
  constraint partner_invitations_token_format
    check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint partner_invitations_recovery_target
    check ((purpose = 'RECOVERY') = (target_user_id is not null)),
  constraint partner_invitations_recovery_email_only
    check (purpose = 'ACTIVATION' or channel = 'EMAIL'),
  constraint partner_invitations_phone_format
    check (channel = 'EMAIL' or contact ~ '^\+9955[0-9]{8}$'),
  constraint partner_invitations_email_format
    check (channel = 'PHONE' or (contact = lower(contact) and contact like '%@%')),
  constraint partner_invitations_accepted_consistent
    check ((status = 'ACCEPTED') = (accepted_user_id is not null and accepted_at is not null)),
  constraint partner_invitations_revoked_consistent
    check ((status = 'REVOKED') = (revoked_at is not null)),
  constraint partner_invitations_expiry_bounded
    check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);
--> statement-breakpoint
-- At most one open invitation per partner: issuing a new one revokes the old.
create unique index partner_invitations_one_pending on partner_invitations (partner_id) where status = 'PENDING';
--> statement-breakpoint
create index partner_invitations_contact_pending on partner_invitations (channel, contact) where status = 'PENDING';
--> statement-breakpoint

alter table partner_invitations enable row level security;
--> statement-breakpoint
grant select, insert, update on partner_invitations to app_runtime;
--> statement-breakpoint
-- Admin only. Partners never read invitations (not even their own), and the
-- not-yet-linked person reaches theirs only through the two functions below.
create policy partner_invitations_admin_select on partner_invitations for select to app_runtime
  using (app_is_admin());
--> statement-breakpoint
create policy partner_invitations_admin_insert on partner_invitations for insert to app_runtime
  with check (app_is_admin() and created_by = app_current_user_id());
--> statement-breakpoint
create policy partner_invitations_admin_update on partner_invitations for update to app_runtime
  using (app_is_admin());
--> statement-breakpoint

-- What the activation page may show to the holder of an emailed token:
-- partner name and the invitation's state. Nothing for a wrong token.
create or replace function app_partner_invitation_by_token(p_token_hash text)
returns table (
  invitation_id uuid,
  partner_id uuid,
  partner_name text,
  partner_active boolean,
  channel partner_invitation_channel,
  purpose partner_invitation_purpose,
  contact text,
  target_user_id uuid,
  status partner_invitation_status,
  expired boolean
)
language sql stable security definer set search_path = public as $$
  select i.id, i.partner_id, p.name, p.status = 'ACTIVE', i.channel, i.purpose, i.contact,
         i.target_user_id, i.status, i.expires_at <= now()
  from partner_invitations i
  join partners p on p.id = i.partner_id
  where p_token_hash ~ '^[0-9a-f]{64}$' and i.token_hash = p_token_hash
$$;
--> statement-breakpoint

-- The open phone invitation (if any) for this number: unexpired, for an
-- active partner. Decides whether a phone may receive a first sign-in code,
-- and which invitation a verified phone claims. Already-linked phone logins
-- are checked by the app against Supabase Auth, not here.
create or replace function app_open_phone_invitation(p_phone text) returns uuid
language sql stable security definer set search_path = public as $$
  select i.id from partner_invitations i join partners p on p.id = i.partner_id
  where i.channel = 'PHONE' and i.purpose = 'ACTIVATION' and i.status = 'PENDING'
    and i.contact = p_phone and i.expires_at > now() and p.status = 'ACTIVE'
  order by i.created_at desc
  limit 1
$$;
--> statement-breakpoint

-- How many partners a user can reach, for the "one login = one partner" rule.
create or replace function app_user_partner_count(p_user_id uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from partner_members where user_id = p_user_id
$$;
--> statement-breakpoint

-- The only way an invitation becomes a membership. The caller (server code)
-- must already have verified, against Supabase Auth, that p_user_id is the
-- signed-in or just-created user and that p_verified_contact is an email or
-- phone that user controls. Everything else is enforced here, under row
-- locks, so two concurrent claims cannot both succeed.
create or replace function app_accept_partner_invitation(
  p_invitation_id uuid,
  p_user_id uuid,
  p_verified_contact text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv partner_invitations%rowtype;
  partner_state partner_status;
begin
  if p_invitation_id is null or p_user_id is null or p_verified_contact is null then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  select * into inv from partner_invitations where id = p_invitation_id for update;
  if not found then raise exception 'invitation_invalid' using errcode = 'P0001'; end if;
  if inv.status <> 'PENDING' then raise exception 'invitation_used' using errcode = 'P0001'; end if;
  if inv.expires_at <= now() then raise exception 'invitation_expired' using errcode = 'P0001'; end if;
  if inv.contact <> p_verified_contact then raise exception 'contact_mismatch' using errcode = 'P0001'; end if;

  select status into partner_state from partners where id = inv.partner_id for update;
  if partner_state is distinct from 'ACTIVE' then raise exception 'partner_inactive' using errcode = 'P0001'; end if;

  if exists (select 1 from admin_users where user_id = p_user_id) then
    raise exception 'admin_account' using errcode = 'P0001';
  end if;

  if inv.purpose = 'ACTIVATION' then
    -- One partner = one login, and one login = one partner.
    if exists (select 1 from partner_members where partner_id = inv.partner_id) then
      raise exception 'partner_has_login' using errcode = 'P0001';
    end if;
    if exists (select 1 from partner_members where user_id = p_user_id) then
      raise exception 'user_has_partner' using errcode = 'P0001';
    end if;
    insert into partner_members (partner_id, user_id, role) values (inv.partner_id, p_user_id, 'OWNER');
  else
    -- RECOVERY: only the login it was issued for, and only while still linked.
    if inv.target_user_id <> p_user_id
       or not exists (select 1 from partner_members where partner_id = inv.partner_id and user_id = p_user_id) then
      raise exception 'recovery_target_mismatch' using errcode = 'P0001';
    end if;
  end if;

  update partner_invitations
     set status = 'ACCEPTED', accepted_user_id = p_user_id, accepted_at = now()
   where id = inv.id;

  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('PARTNER', p_user_id,
          case when inv.purpose = 'ACTIVATION' then 'PARTNER_LOGIN_ACTIVATED' else 'PARTNER_LOGIN_RECOVERED' end,
          'partner', inv.partner_id::text,
          jsonb_build_object('invitationId', inv.id, 'channel', inv.channel));

  return inv.partner_id;
end
$$;
--> statement-breakpoint

revoke execute on function app_partner_invitation_by_token(text) from public;
--> statement-breakpoint
revoke execute on function app_open_phone_invitation(text) from public;
--> statement-breakpoint
revoke execute on function app_user_partner_count(uuid) from public;
--> statement-breakpoint
revoke execute on function app_accept_partner_invitation(uuid, uuid, text) from public;
--> statement-breakpoint
grant execute on function app_partner_invitation_by_token(text) to app_runtime;
--> statement-breakpoint
grant execute on function app_open_phone_invitation(text) to app_runtime;
--> statement-breakpoint
grant execute on function app_user_partner_count(uuid) to app_runtime;
--> statement-breakpoint
grant execute on function app_accept_partner_invitation(uuid, uuid, text) to app_runtime;

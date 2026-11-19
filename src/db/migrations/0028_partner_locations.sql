-- =============================================================================
-- Partner locations: the physical shops where customers can pick up a
-- QR STARR card ("Where to find QR STARR" on the home page).
-- docs/partner-locations/PARTNER-LOCATIONS.md
--
-- Numbered 0028: production holds 0000-0027 (last 0027_qr_handover_immediate,
-- when 1795507200000); this journal `when` (1795593600000) is later, so
-- drizzle applies it next. Nothing here depends on 0022-0027.
--
-- One partner may have many branches. A row is shown publicly only when ALL
-- of these hold (app_public_partner_locations below, the ONLY public read):
--   - an admin switched it public (is_public);
--   - an admin verified its address + map pin (coordinates_verified_at), and
--     no address/coordinate edit happened since (the trigger clears it);
--   - its partner is ACTIVE (a suspended partner disappears everywhere);
--   - it is not a test fixture (is_mock) — unless the caller explicitly asks
--     for mocks, which only a non-production server does (lib/env.ts guard).
--
-- Availability is never invented. The function derives it from inventory the
-- platform already trusts:
--   AVAILABLE  the admin says this branch stocks cards AND the partner holds
--              at least one card that is DISTRIBUTED (physically handed out to
--              the shop, partner/admin-confirmed) and still AVAILABLE (unsold).
--   OUT        the admin marked this branch as not stocking cards right now.
--   UNKNOWN    anything else — the public page shows no availability claim.
-- Distribution is recorded per partner, not per branch, which is why the
-- branch-level admin switch is part of the rule. No counts are exposed.
--
-- Security: admin-only table (RLS: app_is_admin()); app_runtime holds DML,
-- anon/authenticated/service_role hold nothing (0020's default privileges and
-- the explicit revokes below). The public function is SECURITY DEFINER with a
-- fixed search_path and returns only display columns — never partner ids,
-- commission, members, notes, audit fields or private data.
-- =============================================================================

create table partner_locations (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete restrict,
  branch_name text,
  category text not null default 'GIFTS',
  address_ka text not null,
  address_en text,
  city_ka text not null,
  city_en text,
  district_ka text,
  district_en text,
  latitude double precision not null,
  longitude double precision not null,
  phone text,
  hours_ka text,
  hours_en text,
  stocks_cards boolean not null default true,
  is_public boolean not null default false,
  is_mock boolean not null default false,
  coordinates_verified_at timestamptz,
  coordinates_verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_locations_category_check
    check (category in ('FLOWERS', 'GIFTS', 'CONFECTIONERY', 'BOOKS', 'JEWELRY', 'CAFE', 'OTHER')),
  constraint partner_locations_latitude_range check (latitude between -90 and 90),
  constraint partner_locations_longitude_range check (longitude between -180 and 180),
  -- Free text stays short; nothing long-form or private belongs here.
  constraint partner_locations_text_lengths check (
    char_length(address_ka) between 3 and 200
    and coalesce(char_length(address_en), 3) between 3 and 200
    and char_length(city_ka) between 2 and 80
    and coalesce(char_length(city_en), 2) between 2 and 80
    and coalesce(char_length(district_ka), 2) between 2 and 80
    and coalesce(char_length(district_en), 2) between 2 and 80
    and coalesce(char_length(branch_name), 2) between 2 and 80
    and coalesce(char_length(hours_ka), 2) between 2 and 120
    and coalesce(char_length(hours_en), 2) between 2 and 120
  ),
  constraint partner_locations_phone_format check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  -- A pin that was never verified cannot be public.
  constraint partner_locations_public_requires_verified
    check (not is_public or coordinates_verified_at is not null)
);
--> statement-breakpoint
create index partner_locations_partner_id_idx on partner_locations (partner_id);
--> statement-breakpoint

-- Any change to where the shop is (address, city, district or the pin) voids
-- the verification and takes the row off the public map until re-verified.
create or replace function partner_locations_guard() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and (
       new.latitude is distinct from old.latitude
       or new.longitude is distinct from old.longitude
       or new.address_ka is distinct from old.address_ka
       or new.address_en is distinct from old.address_en
       or new.city_ka is distinct from old.city_ka
       or new.district_ka is distinct from old.district_ka)
     and new.coordinates_verified_at is not distinct from old.coordinates_verified_at then
    new.coordinates_verified_at := null;
    new.coordinates_verified_by := null;
    new.is_public := false;
  end if;
  -- A fresh row starts unverified and hidden whatever the caller sent.
  if tg_op = 'INSERT' and current_user = 'app_runtime' then
    new.coordinates_verified_at := null;
    new.coordinates_verified_by := null;
    new.is_public := false;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger trg_partner_locations_guard
  before insert or update on partner_locations
  for each row execute function partner_locations_guard();
--> statement-breakpoint

alter table partner_locations enable row level security;
--> statement-breakpoint
revoke all on partner_locations from anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on partner_locations to app_runtime;
--> statement-breakpoint
create policy partner_locations_admin_select on partner_locations for select to app_runtime
  using (app_is_admin());
--> statement-breakpoint
create policy partner_locations_admin_insert on partner_locations for insert to app_runtime
  with check (app_is_admin());
--> statement-breakpoint
create policy partner_locations_admin_update on partner_locations for update to app_runtime
  using (app_is_admin()) with check (app_is_admin());
--> statement-breakpoint
create policy partner_locations_admin_delete on partner_locations for delete to app_runtime
  using (app_is_admin());
--> statement-breakpoint

create or replace function app_public_partner_locations(p_include_mock boolean default false)
returns table (
  id uuid,
  partner_name text,
  branch_name text,
  category text,
  address_ka text,
  address_en text,
  city_ka text,
  city_en text,
  district_ka text,
  district_en text,
  latitude double precision,
  longitude double precision,
  phone text,
  hours_ka text,
  hours_en text,
  availability text,
  is_mock boolean
)
language sql stable security definer set search_path = public as $$
  select
    l.id,
    p.name,
    l.branch_name,
    l.category,
    l.address_ka,
    l.address_en,
    l.city_ka,
    l.city_en,
    l.district_ka,
    l.district_en,
    l.latitude,
    l.longitude,
    l.phone,
    l.hours_ka,
    l.hours_en,
    case
      when not l.stocks_cards then 'OUT'
      when exists (
        select 1 from qr_codes q
        where q.partner_id = l.partner_id
          and q.status = 'AVAILABLE'
          and q.distribution_status = 'DISTRIBUTED'
      ) then 'AVAILABLE'
      else 'UNKNOWN'
    end,
    l.is_mock
  from partner_locations l
  join partners p on p.id = l.partner_id
  where l.is_public
    and l.coordinates_verified_at is not null
    and p.status = 'ACTIVE'
    and (not l.is_mock or p_include_mock)
  order by l.city_ka, p.name, l.branch_name nulls first, l.id
$$;
--> statement-breakpoint
revoke all on function app_public_partner_locations(boolean) from public;
--> statement-breakpoint
revoke all on function app_public_partner_locations(boolean) from anon, authenticated, service_role;
--> statement-breakpoint
revoke all on function partner_locations_guard() from public;
--> statement-breakpoint
revoke all on function partner_locations_guard() from anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function app_public_partner_locations(boolean) to app_runtime;

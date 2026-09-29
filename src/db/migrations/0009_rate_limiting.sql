-- =============================================================================
-- Distributed, DB-backed rate limiting (fixed-window counter).
-- =============================================================================
-- Deliberately NOT an in-memory Map: this app can run as multiple serverless
-- instances, which would each keep their own independent (and therefore
-- meaningless) counters. Postgres is already the one piece of shared
-- infrastructure every instance talks to, so it is the correct place for a
-- distributed counter without introducing a new paid dependency (Redis/
-- Upstash/etc) for a pilot-scale app.
--
-- No sensitive data lives here — `key` is a caller-constructed string like
-- "greeting-start:<qr token>" or "admin-action:<user id>", never a token,
-- password, or content. Same trust model as `analytics_events`/`audit_logs`:
-- a permissive insert/update policy is acceptable because the only writer is
-- the typed `checkRateLimit()` helper, never raw user input.
create table rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (key, window_start)
);

alter table rate_limit_hits enable row level security;

grant select, insert, update, delete on rate_limit_hits to app_runtime;

-- No read policy at all: nothing in the app ever needs to SELECT this table
-- back through an RLS-scoped context (checkRateLimit reads its own INSERT's
-- RETURNING value in the same statement) — this closes off even an
-- accidental read path for what is otherwise fully anonymous-writable data.
create policy rate_limit_hits_insert on rate_limit_hits for insert with check (true);
create policy rate_limit_hits_update on rate_limit_hits for update using (true);
create policy rate_limit_hits_delete on rate_limit_hits for delete using (true);

create index rate_limit_hits_window_start_idx on rate_limit_hits (window_start);

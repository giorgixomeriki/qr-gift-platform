-- 0009 gave rate_limit_hits INSERT/UPDATE/DELETE policies but no SELECT
-- policy. Postgres re-checks SELECT visibility for RETURNING on an
-- INSERT/UPDATE (even though the row already passed its own WITH CHECK),
-- and raises "new row violates row-level security policy" instead of
-- silently omitting the row — so checkRateLimit's `.returning({ count })`
-- was failing on every single call, only masked because the store fails
-- open. This table holds no sensitive data (just a key/window/count
-- counter, no PII, no tokens), so a permissive SELECT policy is safe.
create policy rate_limit_hits_select on rate_limit_hits for select using (true);

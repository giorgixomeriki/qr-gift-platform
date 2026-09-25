-- =============================================================================
-- Audit finding F-05: close the payout-period race at the DB level.
-- =============================================================================
-- recordManualPayout (lib/payments/payouts.ts) already rejects an overlapping
-- period via a SELECT-then-INSERT check inside one transaction — but that is
-- a TOCTOU race under genuine concurrency: two admins' transactions can each
-- run the SELECT, each see no overlap (neither has committed yet under Read
-- Committed isolation), and both INSERT. This exclusion constraint is the
-- real backstop: Postgres enforces it at the index level across concurrent
-- transactions, so the second concurrent INSERT blocks and then fails with a
-- 23P01 (exclusion_violation) once the first commits — exactly the same
-- guarantee a UNIQUE constraint gives against duplicate rows, generalized to
-- overlapping ranges.
--
-- btree_gist is required so the equality columns (partner_id, currency) can
-- participate in a GiST exclusion constraint alongside the range overlap
-- operator (&&) on period_from/period_to.
create extension if not exists btree_gist;

alter table partner_payouts
  add constraint partner_payouts_no_overlapping_period
  exclude using gist (
    partner_id with =,
    currency with =,
    tstzrange(period_from, period_to, '[]') with &&
  );

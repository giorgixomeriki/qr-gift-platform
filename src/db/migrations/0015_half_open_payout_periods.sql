-- =============================================================================
-- Payout periods are half-open [period_from, period_to).
--
-- Business days are now interpreted in the business timezone
-- (lib/business-calendar.ts, Asia/Tbilisi) and a payout period ends at the
-- START of the day after its last date. With the old closed '[]' range, two
-- consecutive months (Oct ends at Nov 1 00:00, Nov starts at Nov 1 00:00)
-- would "overlap" at that shared instant and the second payout would be
-- refused. The old workaround — ending a period at 23:59:59.999 — left a
-- sub-millisecond gap (timestamptz has microsecond precision) where a
-- commission could belong to no period at all. '[)' gives every instant
-- exactly one period.
--
-- Same constraint name, same rule (no two payouts of one partner+currency may
-- share any instant); only the boundary semantics change. Every existing row
-- satisfies '[)' because '[]' was strictly stronger.
-- =============================================================================
alter table partner_payouts drop constraint partner_payouts_no_overlapping_period;
--> statement-breakpoint
alter table partner_payouts
  add constraint partner_payouts_no_overlapping_period
  exclude using gist (
    partner_id with =,
    currency with =,
    tstzrange(period_from, period_to, '[)') with &&
  );

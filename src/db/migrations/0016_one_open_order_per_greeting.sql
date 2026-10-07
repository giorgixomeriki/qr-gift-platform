-- =============================================================================
-- At most one open (PENDING_PAYMENT) order per greeting.
--
-- Two checkout requests arriving together (double tap, two tabs, a retry
-- racing the original) could both find no open order and both insert one:
-- two orders, two live provider sessions, a way to be charged twice for one
-- greeting. App code cannot close that race (the check and the insert are
-- separate statements); this index makes it a database fact. The request that
-- loses the race reuses the winner's order (lib/payments/checkout.ts).
--
-- Existing duplicates (older open orders of the same greeting) are closed as
-- CANCELED first, keeping the most recent. Closing an order never loses
-- money: a charge that still lands on it is honoured or returned
-- (lib/payments/service.ts confirmPaymentSuccess — late success).
-- Complements orders_one_paid_per_greeting (0002).
-- =============================================================================
update orders o
   set status = 'CANCELED'
 where o.status = 'PENDING_PAYMENT'
   and exists (
     select 1 from orders newer
      where newer.greeting_id = o.greeting_id
        and newer.status = 'PENDING_PAYMENT'
        and (newer.created_at, newer.id) > (o.created_at, o.id)
   );
--> statement-breakpoint
create unique index orders_one_open_per_greeting on orders (greeting_id) where status = 'PENDING_PAYMENT';

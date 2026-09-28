import postgres from "postgres";

/**
 * Test-data helpers for the e2e suite. Talks to the local Supabase Postgres
 * directly via the superuser connection (same pattern the verify-*.ts
 * scripts already use) — never through the app's own RLS-scoped client,
 * since these fixtures need to bypass RLS to set up state a real actor
 * couldn't create for themselves (an AVAILABLE QR code, a partner row).
 *
 * Requires MIGRATIONS_DATABASE_URL in the environment — set it before
 * running `npx playwright test` (the same var `npm run db:migrate` uses).
 */
const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(migrationsUrl, { max: 1 });

/** admin@dev.local / partner@dev.local — created by `npm run db:dev-bootstrap`, which the e2e README asks to be run once before the suite. */
export const DEV_ADMIN_EMAIL = "admin@dev.local";
export const DEV_PARTNER_EMAIL = "partner@dev.local";
export const DEV_PASSWORD = "dev-password-only";

function randomToken(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/** Creates a fresh AVAILABLE QR code under a throwaway partner, for one greeting-flow test run. */
export async function createAvailableQr() {
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const qrId = crypto.randomUUID();
  const publicToken = randomToken("E2E");
  const slug = `e2e-${crypto.randomUUID().slice(0, 8)}`;

  await sql`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${slug}, 'E2E Test Partner', 3000, 'ACTIVE')`;
  await sql`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'e2e-batch', 1)`;
  await sql`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${publicToken}, ${batchId}, ${partnerId}, 'AVAILABLE')`;

  return {
    publicToken,
    partnerId,
    cleanup: async () => {
      await sql`delete from analytics_events where qr_code_id = ${qrId}`;
      await sql`delete from greeting_content where greeting_id in (select id from greetings where qr_code_id = ${qrId})`;
      await sql`delete from payments where order_id in (select id from orders where qr_code_id = ${qrId})`;
      await sql`delete from partner_ledger_entries where order_id in (select id from orders where qr_code_id = ${qrId})`;
      await sql`delete from orders where qr_code_id = ${qrId}`;
      await sql`delete from greetings where qr_code_id = ${qrId}`;
      await sql`delete from qr_codes where id = ${qrId}`;
      await sql`delete from qr_batches where id = ${batchId}`;
      await sql`delete from partners where id = ${partnerId}`;
    },
  };
}

/** Suspends or reactivates a fixture partner (QA-04 coverage). */
export async function setPartnerStatus(partnerId: string, status: "ACTIVE" | "SUSPENDED") {
  await sql`update partners set status = ${status} where id = ${partnerId}`;
}

/** Order statuses and greeting/QR state behind a public token — for asserting what a flow did (or didn't) create. */
export async function commercialStateOf(publicToken: string) {
  const [row] = await sql`
    select g.status as greeting, q.status as qr,
      coalesce((select array_agg(o.status::text order by o.created_at) from orders o where o.qr_code_id = q.id), '{}') as orders,
      (select o.id from orders o where o.qr_code_id = q.id order by o.created_at desc limit 1) as latest_order_id,
      (select p.provider_payment_id from payments p join orders o on o.id = p.order_id where o.qr_code_id = q.id order by p.created_at desc limit 1) as latest_payment_id
    from qr_codes q left join greetings g on g.qr_code_id = q.id
    where q.public_token = ${publicToken}`;
  return {
    greeting: (row?.greeting ?? null) as string | null,
    qr: row?.qr as string,
    orders: (row?.orders ?? []) as string[],
    latestOrderId: (row?.latest_order_id ?? null) as string | null,
    latestPaymentId: (row?.latest_payment_id ?? null) as string | null,
  };
}

export async function closeFixtures() {
  await sql.end();
}

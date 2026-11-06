import Module from "node:module";

// See verify-commercial-invariants.ts: neutralize `import "server-only"` for
// this standalone process only, so the REAL service code runs unmodified.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { GREETING_AVAILABILITY_MONTHS, greetingAvailableUntil, isGreetingExpired } =
  require("../src/lib/greetings/availability") as typeof import("../src/lib/greetings/availability");
const { generateEditToken, hashEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startCheckout, confirmPaymentSuccess, activatePaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { resolveQrState } = require("../src/lib/qr/resolve-state") as typeof import("../src/lib/qr/resolve-state");
const { loadActiveGreetingForRecipient, RecipientAccessError } = require("../src/lib/greetings/recipient") as typeof import("../src/lib/greetings/recipient");

/**
 * 12-month greeting availability (owner decision 2026-11-06,
 * lib/greetings/availability.ts): the calendar arithmetic, then the real
 * resolve/recipient path on a real paid + activated greeting, with
 * activated_at moved by the superuser connection (fixture only). Checks that
 * expiry hides the greeting but deletes and changes nothing.
 */
const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const admin = postgres(migrationsUrl, { max: 2 });

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

const created = { partners: [] as string[], batches: [] as string[] };

async function main() {
  console.log("1. Calendar arithmetic (UTC)");
  const iso = (d: Date) => d.toISOString();
  check("12 months is the configured period", GREETING_AVAILABILITY_MONTHS === 12);
  check("2026-11-06T10:00Z → 2027-11-06T10:00Z", iso(greetingAvailableUntil(new Date("2026-11-06T10:00:00Z"))) === "2027-11-06T10:00:00.000Z");
  check("29 Feb 2028 clamps to 28 Feb 2029", iso(greetingAvailableUntil(new Date("2028-02-29T12:00:00Z"))) === "2029-02-28T12:00:00.000Z");
  check("31 Jan → 31 Jan next year", iso(greetingAvailableUntil(new Date("2027-01-31T00:00:00Z"))) === "2028-01-31T00:00:00.000Z");
  const act = new Date("2026-11-06T10:00:00Z");
  check("available one millisecond before the end", !isGreetingExpired(act, new Date("2027-11-06T09:59:59.999Z")));
  check("expired exactly at the end", isGreetingExpired(act, new Date("2027-11-06T10:00:00.000Z")));
  check("no activation timestamp is never treated as expired", !isGreetingExpired(null, new Date("2100-01-01T00:00:00Z")));

  console.log("\n2. Real paid + activated greeting");
  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING' limit 1`;
  const [theme] = await admin`select id from themes where key = 'minimal' limit 1`;
  if (!product || !theme) throw new Error("Seed data missing — run npm run db:seed first");
  const partnerId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps) values (${partnerId}, ${`avail-${partnerId.slice(0, 8)}`}, 'Availability verify', 3000)`;
  created.partners.push(partnerId);
  const batchId = crypto.randomUUID();
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'AVAIL', 1)`;
  created.batches.push(batchId);
  const qrId = crypto.randomUUID();
  const token = generatePublicToken();
  const greetingId = crypto.randomUUID();
  const editToken = generateEditToken();
  await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${batchId}, ${partnerId}, 'DRAFT')`;
  await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values (${greetingId}, ${qrId}, ${theme.id}, ${product.id}, 'DRAFT', ${hashEditToken(editToken)})`;
  await admin`insert into greeting_content (greeting_id, type, slot, text_value, status) values (${greetingId}, 'text', 0, 'availability verify', 'READY')`;
  const { order } = await startCheckout({ greetingId, editToken, productId: product.id as string });
  await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: `test_${order.grossAmountMinor}_${order.currency}_${crypto.randomUUID()}`, orderId: order.id, amountMinor: order.grossAmountMinor, currency: order.currency });
  await activatePaidOrder(order.id);
  const [g] = await admin`select activated_at from greetings where id = ${greetingId}`;
  check("activation sets greetings.activated_at (source of truth)", g?.activated_at instanceof Date);

  const fresh = await resolveQrState(token);
  check("freshly activated → active", fresh.kind === "active", fresh.kind);
  const loaded = await loadActiveGreetingForRecipient(greetingId).then(() => true, () => false);
  check("freshly activated → recipient content loads", loaded);

  await admin`update greetings set activated_at = now() - interval '11 months 29 days' where id = ${greetingId}`;
  const almost = await resolveQrState(token);
  check("11 months 29 days after activation → still active", almost.kind === "active", almost.kind);

  const before = await admin`select (select count(*) from greeting_content where greeting_id = ${greetingId})::int as content, (select status from greetings where id = ${greetingId}) as g, (select status from qr_codes where id = ${qrId}) as q, (select count(*) from partner_ledger_entries where order_id = ${order.id})::int as ledger, (select status from orders where id = ${order.id}) as o`;
  await admin`update greetings set activated_at = now() - interval '12 months 1 day' where id = ${greetingId}`;
  const expired = await resolveQrState(token);
  check("12 months + 1 day → expired", expired.kind === "expired", expired.kind);
  const blocked = await loadActiveGreetingForRecipient(greetingId).then(
    () => "loaded",
    (e) => (e instanceof RecipientAccessError ? "refused" : String(e)),
  );
  check("expired → recipient loader refuses (no signed media URL is issued)", blocked === "refused", blocked);
  const after = await admin`select (select count(*) from greeting_content where greeting_id = ${greetingId})::int as content, (select status from greetings where id = ${greetingId}) as g, (select status from qr_codes where id = ${qrId}) as q, (select count(*) from partner_ledger_entries where order_id = ${order.id})::int as ledger, (select status from orders where id = ${order.id}) as o`;
  check("expiry deletes and changes nothing (content, statuses, order, commission)", JSON.stringify(before) === JSON.stringify(after), { before, after });

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error(err);
    failed++;
  })
  .finally(async () => {
    // Fixtures stay (append-only ledger/orders); they are isolated test-partner rows.
    await admin.end();
    process.exit(failed === 0 ? 0 : 1);
  });

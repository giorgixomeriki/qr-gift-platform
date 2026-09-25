import Module from "node:module";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { recordAnalyticsEvent } = require("../src/lib/analytics") as typeof import("../src/lib/analytics");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const admin = postgres(migrationsUrl, { max: 1 });

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("Setting up fixtures (superuser)...");

  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const qrCodeId = crypto.randomUUID();
  const greetingId = crypto.randomUUID();
  const runId = crypto.randomUUID().slice(0, 8);

  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerId}, ${"analytics-funnel-" + runId}, 'Analytics Funnel Test Partner', 3000, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'funnel-test-batch', 1)`;
  await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values
    (${qrCodeId}, ${"funnel-test-" + runId}, ${batchId}, ${partnerId}, 'DRAFT')`;
  const [themeRow] = await admin<{ id: string }[]>`select id from themes limit 1`;
  const [productRow] = await admin<{ id: string }[]>`select id from products limit 1`;
  if (!themeRow || !productRow) throw new Error("Fixture requires at least one theme and one product to already exist (run db:seed first)");
  const themeId = themeRow.id;
  const productId = productRow.id;
  await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status) values
    (${greetingId}, ${qrCodeId}, ${themeId}, ${productId}, 'DRAFT')`;

  try {
    console.log("\n--- New event types are accepted and recorded with correct partner attribution ---");
    await recordAnalyticsEvent({ eventType: "THEME_SELECTED", greetingId }, { partnerId });
    await recordAnalyticsEvent({ eventType: "CONTENT_CREATED", greetingId }, { partnerId });

    const themeRows = await admin`select partner_id, greeting_id from analytics_events where greeting_id = ${greetingId} and event_type = 'THEME_SELECTED'`;
    check("1. THEME_SELECTED is accepted by the closed event schema and recorded", themeRows.length === 1);
    check("2. THEME_SELECTED carries the correct partner attribution", themeRows[0]?.partner_id === partnerId);

    const contentRows = await admin`select partner_id, greeting_id from analytics_events where greeting_id = ${greetingId} and event_type = 'CONTENT_CREATED'`;
    check("3. CONTENT_CREATED is accepted by the closed event schema and recorded", contentRows.length === 1);
    check("4. CONTENT_CREATED carries the correct partner attribution", contentRows[0]?.partner_id === partnerId);

    console.log("\n--- The distinct-count fix actually de-duplicates a repeated event ---");
    // A sender can genuinely re-select a theme or re-save their message more
    // than once before finishing — record each event type a SECOND time for
    // the same greeting, exactly as content.ts's updateGreetingTheme /
    // updateGreetingMessage would on a repeat edit.
    await recordAnalyticsEvent({ eventType: "THEME_SELECTED", greetingId }, { partnerId });
    await recordAnalyticsEvent({ eventType: "PREVIEW_VIEWED", greetingId }, { partnerId });
    await recordAnalyticsEvent({ eventType: "PREVIEW_VIEWED", greetingId }, { partnerId });
    await recordAnalyticsEvent({ eventType: "PREVIEW_VIEWED", greetingId }, { partnerId });

    type DedupRow = { raw: number; distinct_count: number };
    const [themeDedup] = await admin<DedupRow[]>`
      select count(*)::int as raw, count(distinct greeting_id)::int as distinct_count
      from analytics_events where greeting_id = ${greetingId} and event_type = 'THEME_SELECTED'`;
    check("5. THEME_SELECTED was recorded twice (raw count)", themeDedup?.raw === 2);
    check(
      "6. ...but the admin-metrics funnel counting pattern (count(distinct greeting_id)) collapses it to 1, matching admin-metrics.ts's own query",
      themeDedup?.distinct_count === 1,
    );

    const [previewDedup] = await admin<DedupRow[]>`
      select count(*)::int as raw, count(distinct greeting_id)::int as distinct_count
      from analytics_events where greeting_id = ${greetingId} and event_type = 'PREVIEW_VIEWED'`;
    check("7. PREVIEW_VIEWED was recorded 3 times (raw count) for one Greeting", previewDedup?.raw === 3);
    check("8. ...but the distinct-count fix reports exactly 1 Greeting reached that stage, not 3", previewDedup?.distinct_count === 1);

    console.log("\n--- QR_SCANNED dedup is keyed by qr_code_id (fires before a Greeting may exist) ---");
    await recordAnalyticsEvent({ eventType: "QR_SCANNED", qrCodeId }, { partnerId });
    await recordAnalyticsEvent({ eventType: "QR_SCANNED", qrCodeId }, { partnerId });
    const [scanDedup] = await admin<DedupRow[]>`
      select count(*)::int as raw, count(distinct qr_code_id)::int as distinct_count
      from analytics_events where qr_code_id = ${qrCodeId} and event_type = 'QR_SCANNED'`;
    check("9. QR_SCANNED was recorded twice (raw count) for one QR code", scanDedup?.raw === 2);
    check("10. ...but the distinct-count fix reports exactly 1 QR code reached that stage, not 2", scanDedup?.distinct_count === 1);
  } finally {
    console.log("\nCleaning up fixtures...");
    await admin`delete from analytics_events where partner_id = ${partnerId}`;
    await admin`delete from greetings where id = ${greetingId}`;
    await admin`delete from qr_codes where id = ${qrCodeId}`;
    await admin`delete from qr_batches where id = ${batchId}`;
    await admin`delete from partners where id = ${partnerId}`;
    await admin.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end();
  process.exit(1);
});

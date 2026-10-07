import Module from "node:module";
import { execFileSync } from "node:child_process";

// See verify-commercial-invariants.ts: neutralize `import "server-only"`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const cal = require("../src/lib/business-calendar") as typeof import("../src/lib/business-calendar");

/**
 * Business-day boundaries (Asia/Tbilisi) for payout periods and date-based
 * financial reporting.
 *
 * Part 1 — pure calendar rules, evaluated in child processes under several
 * HOST timezones; results must be identical (nothing may depend on the
 * machine's or browser's zone).
 * Part 2 — real sales booked at boundary instants, statements and itemized
 * payouts per business month/year: every commission lands in exactly one
 * period and is paid exactly once.
 */

// ---------------------------------------------------------------------------
// Part 1 payload — also executed standalone in child processes (CALENDAR_PROBE=1).
// ---------------------------------------------------------------------------
function probe() {
  const at = (iso: string) => cal.businessDateOf(new Date(iso));
  return {
    zone: cal.BUSINESS_TIME_ZONE,
    // 23:59:59 / 00:00:00 / 00:00:01 Tbilisi == 19:59:59 / 20:00:00 / 20:00:01 UTC (current +04)
    "2026-10-04T19:59:59Z": at("2026-10-04T19:59:59Z"),
    "2026-10-04T20:00:00Z": at("2026-10-04T20:00:00Z"),
    "2026-10-04T20:00:01Z": at("2026-10-04T20:00:01Z"),
    "2026-10-04T19:59:00Z": at("2026-10-04T19:59:00Z"),
    "2026-10-04T20:01:00Z": at("2026-10-04T20:01:00Z"),
    // the spec's example: 00:30 Georgia on Oct 5 = 20:30 UTC on Oct 4
    "2026-10-04T20:30:00Z": at("2026-10-04T20:30:00Z"),
    dayStart_2026_10_05: cal.businessDayStart("2026-10-05").toISOString(),
    range_oct5: Object.values(cal.businessDayRange("2026-10-05", "2026-10-05")).map((d) => d.toISOString()),
    range_oct2025: Object.values(cal.businessDayRange("2025-10-01", "2025-10-31")).map((d) => d.toISOString()),
    range_nov2025: Object.values(cal.businessDayRange("2025-11-01", "2025-11-30")).map((d) => d.toISOString()),
    range_dec2025: Object.values(cal.businessDayRange("2025-12-01", "2025-12-31")).map((d) => d.toISOString()),
    range_jan2026: Object.values(cal.businessDayRange("2026-01-01", "2026-01-31")).map((d) => d.toISOString()),
    "2025-10-31T19:59:00Z": at("2025-10-31T19:59:00Z"),
    "2025-10-31T20:00:00Z": at("2025-10-31T20:00:00Z"),
    "2025-12-31T19:59:00Z": at("2025-12-31T19:59:00Z"),
    "2025-12-31T20:00:00Z": at("2025-12-31T20:00:00Z"),
    today_at_2026_10_04T20_30Z: cal.businessToday(new Date("2026-10-04T20:30:00Z")),
    lastClosed_at_2026_10_04T20_30Z: cal.lastClosedBusinessDate(new Date("2026-10-04T20:30:00Z")),
    today_at_2026_10_04T19_59Z: cal.businessToday(new Date("2026-10-04T19:59:00Z")),
    // closed rule at 2026-10-04T20:30Z (Oct 5 00:30 Tbilisi): Oct 4 closed, Oct 5 not
    oct4Closed: cal.isPeriodClosed(cal.businessDayRange("2026-10-04", "2026-10-04").periodTo, new Date("2026-10-04T20:30:00Z")),
    oct5Closed: cal.isPeriodClosed(cal.businessDayRange("2026-10-05", "2026-10-05").periodTo, new Date("2026-10-04T20:30:00Z")),
    // at 19:59Z (Oct 4 23:59 Tbilisi) — even though UTC is the same date, Oct 4 is NOT closed yet
    oct4ClosedAt1959Z: cal.isPeriodClosed(cal.businessDayRange("2026-10-04", "2026-10-04").periodTo, new Date("2026-10-04T19:59:00Z")),
    lastDateOfOctPeriod: cal.lastBusinessDateOfPeriod(cal.businessDayRange("2025-10-01", "2025-10-31").periodTo),
    leapDay: cal.isBusinessDate("2028-02-29"),
    notADate: cal.isBusinessDate("2026-02-30"),
    addAcrossYear: cal.addBusinessDays("2025-12-31", 1),
  };
}

if (process.env.CALENDAR_PROBE === "1") {
  process.stdout.write(JSON.stringify(probe()));
  process.exit(0);
}

const postgres = require("postgres") as typeof import("postgres");
const { generateEditToken, hashEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startCheckout, confirmPaymentSuccess } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { recordManualPayout, getPartnerPayoutStatement, getPartnerUnpaidBalance } = require("../src/lib/payments/payouts") as typeof import("../src/lib/payments/payouts");
const { withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");

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
  console.log("--- Part 1: calendar rules are independent of the host timezone ---");
  const hostZones = ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Tbilisi"];
  const results = hostZones.map((tz) =>
    JSON.parse(
      execFileSync(process.execPath, [...process.execArgv, __filename], { env: { ...process.env, TZ: tz, CALENDAR_PROBE: "1" }, encoding: "utf8" }),
    ) as ReturnType<typeof probe>,
  );
  const r = results[0]!;
  check(`identical results under host TZ ${hostZones.join(", ")}`, results.every((x) => JSON.stringify(x) === JSON.stringify(r)));
  check("business zone is the single configured IANA zone (Asia/Tbilisi)", r.zone === "Asia/Tbilisi");
  check("23:59:59 Tbilisi (19:59:59Z) -> Oct 4", r["2026-10-04T19:59:59Z"] === "2026-10-04");
  check("00:00:00 Tbilisi (20:00:00Z) -> Oct 5", r["2026-10-04T20:00:00Z"] === "2026-10-05");
  check("00:00:01 Tbilisi (20:00:01Z) -> Oct 5", r["2026-10-04T20:00:01Z"] === "2026-10-05");
  check("19:59 UTC -> Oct 4; 20:00 UTC -> Oct 5; 20:01 UTC -> Oct 5", r["2026-10-04T19:59:00Z"] === "2026-10-04" && r["2026-10-04T20:01:00Z"] === "2026-10-05");
  check("00:30 Georgia on Oct 5 (20:30Z Oct 4) belongs to Oct 5, not Oct 4", r["2026-10-04T20:30:00Z"] === "2026-10-05");
  check("Oct 5 begins at 2026-10-04T20:00:00.000Z", r.dayStart_2026_10_05 === "2026-10-04T20:00:00.000Z");
  check("Oct 5 = half-open [Oct 4 20:00Z, Oct 5 20:00Z)", JSON.stringify(r.range_oct5) === JSON.stringify(["2026-10-04T20:00:00.000Z", "2026-10-05T20:00:00.000Z"]));
  check("month boundary: Oct 31 23:59 -> Oct 31, Nov 1 00:00 -> Nov 1", r["2025-10-31T19:59:00Z"] === "2025-10-31" && r["2025-10-31T20:00:00Z"] === "2025-11-01");
  check("year boundary: Dec 31 23:59 -> Dec 31, Jan 1 00:00 -> Jan 1", r["2025-12-31T19:59:00Z"] === "2025-12-31" && r["2025-12-31T20:00:00Z"] === "2026-01-01");
  check("consecutive months tile exactly (Oct end = Nov start, Dec end = Jan start)", r.range_oct2025[1] === r.range_nov2025[0] && r.range_dec2025[1] === r.range_jan2026[0]);
  check("'today' follows Tbilisi: at 20:30Z on Oct 4 it is Oct 5; at 19:59Z still Oct 4", r.today_at_2026_10_04T20_30Z === "2026-10-05" && r.today_at_2026_10_04T19_59Z === "2026-10-04");
  check("closed rule: at Oct 5 00:30 Tbilisi, Oct 4 is closed and Oct 5 is not", r.oct4Closed === true && r.oct5Closed === false && r.lastClosed_at_2026_10_04T20_30Z === "2026-10-04");
  check("closed rule: at Oct 4 23:59 Tbilisi (UTC date also Oct 4), Oct 4 is NOT closed", r.oct4ClosedAt1959Z === false);
  check("period display shows its last business date (Oct 31), not the exclusive end", r.lastDateOfOctPeriod === "2025-10-31");
  check("date validation: leap day valid, Feb 30 rejected, Dec 31 + 1 = Jan 1", r.leapDay && !r.notADate && r.addAcrossYear === "2026-01-01");

  // -------------------------------------------------------------------------
  console.log("\n--- Part 2: boundary sales -> statements -> itemized payouts ---");
  const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
  if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
  const admin = postgres(migrationsUrl, { max: 2 });
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const adminUserId = crypto.randomUUID();
  const greetingIds: string[] = [];

  try {
    const [product] = await admin`select id from products where key = 'PHOTO_GREETING' limit 1`;
    const [theme] = await admin`select id from themes where key = 'minimal' limit 1`;
    await admin`insert into partners (id, slug, name, commission_rate_bps) values (${partnerId}, ${`bizcal-${partnerId.slice(0, 8)}`}, 'Business Calendar Verify', 2000)`;
    await admin`insert into prices (product_id, partner_id, currency, amount_minor) values (${product!.id}, ${partnerId}, 'GEL', 1500)`;
    await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'BIZCAL', 10)`;
    await admin`insert into admin_users (user_id) values (${adminUserId})`;

    /**
     * A real sale whose payment + commission are then dated to `localWallTime`
     * in the business zone (superuser fixture only). `::text::timestamp`: a
     * bare `::timestamp` parameter makes the driver run the string through
     * JS `new Date()` (host timezone, ms precision) — exactly the host
     * dependence this suite guards against.
     */
    async function saleAt(localWallTime: string) {
      const qrId = crypto.randomUUID();
      const greetingId = crypto.randomUUID();
      const editToken = generateEditToken();
      await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${generatePublicToken()}, ${batchId}, ${partnerId}, 'DRAFT')`;
      await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values (${greetingId}, ${qrId}, ${theme!.id}, ${product!.id}, 'DRAFT', ${hashEditToken(editToken)})`;
      await admin`insert into greeting_content (greeting_id, type, slot, text_value, status) values (${greetingId}, 'text', 0, 'bizcal', 'READY')`;
      greetingIds.push(greetingId);
      const { order } = await startCheckout({ greetingId, editToken, productId: product!.id });
      await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: `test_1500_GEL_${crypto.randomUUID()}`, orderId: order.id, amountMinor: 1500, currency: "GEL" });
      const [row] = await admin`
        with t as (select (${localWallTime}::text::timestamp at time zone ${cal.BUSINESS_TIME_ZONE}) as at)
        update partner_ledger_entries set created_at = (select at from t) where order_id = ${order.id} and type = 'COMMISSION_EARNED'
        returning id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as utc`;
      await admin`update orders set paid_at = (${localWallTime}::text::timestamp at time zone ${cal.BUSINESS_TIME_ZONE}) where id = ${order.id}`;
      return { ledgerId: row!.id as string, utc: row!.utc as string, orderId: order.id };
    }

    const sales = {
      oct31_235959: await saleAt("2025-10-31 23:59:59"),
      oct31_last_us: await saleAt("2025-10-31 23:59:59.999999"),
      nov1_000000: await saleAt("2025-11-01 00:00:00"),
      nov1_000001: await saleAt("2025-11-01 00:00:01"),
      dec31_2359: await saleAt("2025-12-31 23:59:00"),
      jan1_0000: await saleAt("2026-01-01 00:00:00"),
    };
    check("fixture: Nov 1 00:00 Tbilisi is stored as 2025-10-31T20:00:00Z (UTC storage unchanged)", sales.nov1_000000.utc === "2025-10-31T20:00:00.000000Z", sales.nov1_000000.utc);
    check("fixture: the last microsecond of Oct 31 is stored as 19:59:59.999999Z", sales.oct31_last_us.utc === "2025-10-31T19:59:59.999999Z", sales.oct31_last_us.utc);

    const statement = (from: string, to: string) => withAdminContext(adminUserId, (tx) => getPartnerPayoutStatement(tx, { partnerId, currency: "GEL", ...cal.businessDayRange(from, to) }));
    const pay = async (from: string, to: string) => {
      const s = await statement(from, to);
      const p = await withAdminContext(adminUserId, (tx) =>
        recordManualPayout(tx, adminUserId, { partnerId, currency: "GEL", ...cal.businessDayRange(from, to), expectedAmountMinor: s.payableMinor, expectedLedgerEntryIds: s.eligibleLedgerEntryIds }),
      );
      const items = (await admin`select ledger_entry_id from partner_payout_items where payout_id = ${p.id}`).map((x) => x.ledger_entry_id as string).sort();
      return { s, p, items };
    };
    const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

    const octDay = await statement("2025-10-31", "2025-10-31");
    const novDay = await statement("2025-11-01", "2025-11-01");
    check("Oct 31 statement holds 23:59:59 and 23:59:59.999999 — not 00:00:00", same(octDay.eligibleLedgerEntryIds, [sales.oct31_235959.ledgerId, sales.oct31_last_us.ledgerId]));
    check("Nov 1 statement holds 00:00:00 and 00:00:01 (UTC date of 00:00:00 is still Oct 31)", same(novDay.eligibleLedgerEntryIds, [sales.nov1_000000.ledgerId, sales.nov1_000001.ledgerId]));
    check("daily reporting: Oct 31 = 2 activations / 30.00 gross; Nov 1 = 2 / 30.00", octDay.paidActivations === 2 && octDay.grossSalesMinor === 3000 && novDay.paidActivations === 2 && novDay.grossSalesMinor === 3000);

    const oct = await pay("2025-10-01", "2025-10-31");
    check("October payout = exactly the two Oct 31 commissions (incl. the last microsecond)", same(oct.items, [sales.oct31_235959.ledgerId, sales.oct31_last_us.ledgerId]) && oct.p.amountMinor === 600);
    const nov = await pay("2025-11-01", "2025-11-30");
    check("November payout (sharing the Nov 1 00:00 boundary with October) is accepted", nov.p.amountMinor === 600);
    check("November payout = exactly the two Nov 1 commissions", same(nov.items, [sales.nov1_000000.ledgerId, sales.nov1_000001.ledgerId]));
    const dec = await pay("2025-12-01", "2025-12-31");
    const jan = await pay("2026-01-01", "2026-01-31");
    check("year boundary: December payout = Dec 31 23:59; January payout = Jan 1 00:00", same(dec.items, [sales.dec31_2359.ledgerId]) && same(jan.items, [sales.jan1_0000.ledgerId]));
    check("stored periods are half-open business days (Oct = [Sep 30 20:00Z, Oct 31 20:00Z))", oct.p.periodFrom.toISOString() === "2025-09-30T20:00:00.000Z" && oct.p.periodTo.toISOString() === "2025-10-31T20:00:00.000Z");

    const [coverage] = await admin`
      select count(*)::int as commissions,
             count(i.ledger_entry_id)::int as paid,
             count(distinct i.ledger_entry_id)::int as distinct_paid
        from partner_ledger_entries l left join partner_payout_items i on i.ledger_entry_id = l.id
       where l.partner_id = ${partnerId} and l.type = 'COMMISSION_EARNED'`;
    check("no commission disappeared or was paid twice: 6 commissions, 6 items, 6 distinct", coverage?.commissions === 6 && coverage?.paid === 6 && coverage?.distinct_paid === 6, JSON.stringify(coverage));
    check("balance is zero after the four monthly payouts", (await withAdminContext(adminUserId, (tx) => getPartnerUnpaidBalance(tx, partnerId, "GEL"))) === 0);
    const octAgain = await statement("2025-10-01", "2025-10-31");
    check("re-running October shows both rows as already paid and blocks a second payout", octAgain.alreadyPaidCount === 2 && octAgain.blocker === "PERIOD_OVERLAPS_PAYOUT");

    const today = cal.businessToday();
    const todayStatement = await statement(today, today);
    const yesterdayStatement = await statement(cal.lastClosedBusinessDate(), cal.lastClosedBusinessDate());
    check(`server closed-period rule: today in Tbilisi (${today}) is rejected as not closed`, todayStatement.blocker === "PERIOD_NOT_CLOSED");
    check("server closed-period rule: yesterday in Tbilisi is not rejected as open", yesterdayStatement.blocker !== "PERIOD_NOT_CLOSED");
  } finally {
    await admin`delete from partner_payout_items where partner_id = ${partnerId}`;
    await admin`delete from partner_ledger_entries where partner_id = ${partnerId}`;
    await admin`delete from partner_payouts where partner_id = ${partnerId}`;
    await admin`delete from payments where order_id in (select id from orders where partner_id = ${partnerId})`;
    await admin`delete from orders where partner_id = ${partnerId}`;
    if (greetingIds.length) {
      await admin`delete from greeting_content where greeting_id in ${admin(greetingIds)}`;
      await admin`delete from greetings where id in ${admin(greetingIds)}`;
    }
    await admin`delete from qr_codes where partner_id = ${partnerId}`;
    await admin`delete from qr_batches where partner_id = ${partnerId}`;
    await admin`delete from partners where id = ${partnerId}`;
    await admin`delete from audit_logs where actor_id = ${adminUserId}`;
    await admin`delete from admin_users where user_id = ${adminUserId}`;
    await admin.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

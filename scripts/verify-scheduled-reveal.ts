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
const S = require("../src/lib/greetings/schedule") as typeof import("../src/lib/greetings/schedule");
const C = require("../src/lib/greetings/countdown") as typeof import("../src/lib/greetings/countdown");
const F = require("../src/lib/greetings/moment-format") as typeof import("../src/lib/greetings/moment-format");
const { generateEditToken, hashEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startCheckout, confirmPaymentSuccess, activatePaidOrder, refundPaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { resolveQrState } = require("../src/lib/qr/resolve-state") as typeof import("../src/lib/qr/resolve-state");
const R = require("../src/lib/greetings/recipient") as typeof import("../src/lib/greetings/recipient");
const Content = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { createSignedUploadUrl, deleteStorageObject } = require("../src/lib/storage/media") as typeof import("../src/lib/storage/media");
const uploaded: string[] = [];

/**
 * Scheduled Reveal + Celebration Countdown (migrations/0030,
 * docs/countdown/SCHEDULED-REVEAL.md).
 *
 *  1. Time arithmetic: zones, daylight saving (skipped + repeated hours),
 *     invalid dates, bounds, countdown units and phases.
 *  2. Stored countdown: validation and tolerant parsing.
 *  3. Real draft → paid → activated greetings through the real services:
 *     immediate access, a future unlock (page, loaders, media signer and RLS
 *     as app_runtime all refuse), access exactly at the unlock instant, the
 *     schedule frozen after activation, both features together, repeated
 *     scans, and Refund Model C (a confirmed full refund suspends public
 *     access and a schedule never re-opens it; nothing is deleted).
 *
 * Fixture-only superuser writes are marked FIXTURE. Needs a migrated, seeded
 * local database and PAYMENTS_PROVIDER=TEST.
 */
const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
const runtimeUrl = process.env.DATABASE_URL;
if (!migrationsUrl || !runtimeUrl) throw new Error("MIGRATIONS_DATABASE_URL and DATABASE_URL are required");
if ((process.env.PAYMENTS_PROVIDER ?? "TEST") !== "TEST") throw new Error("Run with PAYMENTS_PROVIDER=TEST");
const admin = postgres(migrationsUrl, { max: 2 });
const runtime = postgres(runtimeUrl, { max: 2 });

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
async function rejects(p: Promise<unknown>, match: (e: unknown) => boolean): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e) {
    return match(e);
  }
}
const iso = (r: ReturnType<typeof S.zonedWallTimeToUtc>) => (r.ok ? r.instant.toISOString() : r.error);
const DAY = 86_400_000;

async function main() {
  console.log("1. Time arithmetic");
  check("Tbilisi 14 Feb 2027 20:00 → 16:00Z (UTC+4, no DST)", iso(S.zonedWallTimeToUtc("2027-02-14", "20:00", "Asia/Tbilisi")) === "2027-02-14T16:00:00.000Z");
  check("New York spring-forward 02:30 does not exist → refused", iso(S.zonedWallTimeToUtc("2027-03-14", "02:30", "America/New_York")) === "nonexistent");
  check("New York fall-back 01:30 happens twice → the first (EDT, 05:30Z)", iso(S.zonedWallTimeToUtc("2027-11-07", "01:30", "America/New_York")) === "2027-11-07T05:30:00.000Z");
  check("London 28 Mar 2027 01:30 (skipped) → refused", iso(S.zonedWallTimeToUtc("2027-03-28", "01:30", "Europe/London")) === "nonexistent");
  check("London 31 Oct 2027 01:30 (repeated) → first, 00:30Z", iso(S.zonedWallTimeToUtc("2027-10-31", "01:30", "Europe/London")) === "2027-10-31T00:30:00.000Z");
  check("Berlin across DST: 30 Mar 2027 09:00 → 07:00Z (CEST)", iso(S.zonedWallTimeToUtc("2027-03-30", "09:00", "Europe/Berlin")) === "2027-03-30T07:00:00.000Z");
  check("Lord Howe half-hour DST zone converts", iso(S.zonedWallTimeToUtc("2027-06-01", "00:00", "Australia/Lord_Howe")) === "2027-05-31T13:30:00.000Z");
  check("31 April → invalid", iso(S.zonedWallTimeToUtc("2027-04-31", "10:00", "Asia/Tbilisi")) === "invalid");
  check("29 Feb in a non-leap year → invalid", iso(S.zonedWallTimeToUtc("2027-02-29", "10:00", "Asia/Tbilisi")) === "invalid");
  check("25:00 → invalid", iso(S.zonedWallTimeToUtc("2027-02-14", "25:00", "Asia/Tbilisi")) === "invalid");
  check("unknown zone → invalid", iso(S.zonedWallTimeToUtc("2027-02-14", "10:00", "Mars/Olympus")) === "invalid");
  check("garbage date → invalid", iso(S.zonedWallTimeToUtc("14/02/2027", "10:00", "Asia/Tbilisi")) === "invalid");
  const back = S.utcToZonedFields(new Date("2027-11-07T06:30:00Z"), "America/New_York");
  check("round trip to fields (second 01:30 in NY)", back.date === "2027-11-07" && back.time === "01:30", back);
  const now = Date.parse("2026-11-26T12:00:00Z");
  check("unlock in 30 s → past (min lead 60 s)", S.checkUnlockInstant(new Date(now + 30_000), now) === "past");
  check("unlock in 2 min → ok", S.checkUnlockInstant(new Date(now + 120_000), now) === null);
  check(`unlock in ${S.UNLOCK_MAX_DAYS} days → ok`, S.checkUnlockInstant(new Date(now + S.UNLOCK_MAX_DAYS * DAY), now) === null);
  check(`unlock in ${S.UNLOCK_MAX_DAYS} days + 1 min → too_far`, S.checkUnlockInstant(new Date(now + S.UNLOCK_MAX_DAYS * DAY + 60_000), now) === "too_far");
  check("unlock window stays inside 12-month availability", S.UNLOCK_MAX_DAYS < 365);
  check("countdown in the past → past", S.checkCountdownInstant(new Date(now - 1), now) === "past");
  check("countdown 3 years ahead → ok; 4 years → too_far", S.checkCountdownInstant(new Date(now + 3 * 365 * DAY), now) === null && S.checkCountdownInstant(new Date(now + 4 * 366 * DAY), now) === "too_far");
  const p = S.countdownParts(2 * DAY + 3 * 3_600_000 + 4 * 60_000 + 5_400);
  check("parts: 2 d 3 h 4 m 6 s (a partial second rounds up — never 0 early)", p.days === 2 && p.hours === 3 && p.minutes === 4 && p.seconds === 6, p);
  const z = S.countdownParts(-5000);
  check("negative remaining → all zeros, never negative", z.days === 0 && z.hours === 0 && z.minutes === 0 && z.seconds === 0 && z.totalMs === 0);
  check("400 ms left still shows 1 s", S.countdownParts(400).seconds === 1);
  check("phase: before → counting", S.countdownPhase(now + 1, now) === "counting");
  check("phase: at the instant → today", S.countdownPhase(now, now) === "today");
  check("phase: 23 h after → today; 25 h after → celebrated", S.countdownPhase(now - 23 * 3_600_000, now) === "today" && S.countdownPhase(now - 25 * 3_600_000, now) === "celebrated");
  const m = F.formatMoment("2027-02-14T16:00:00.000Z", "Asia/Tbilisi", "ka", now);
  check("Georgian moment: weekday + month in Georgian, 24-hour time, genitive zone", /კვირა/.test(m.day) && /თებერვალი/.test(m.day) && m.time === "20:00" && m.zone === "თბილისის დროით", m);
  const me = F.formatMoment("2027-02-14T16:00:00.000Z", "Asia/Tbilisi", "en", now);
  check("English moment: 'Sunday 14 February 2027', 20:00, 'Tbilisi time'", /Sunday/.test(me.day) && /2027/.test(me.day) && me.time === "20:00" && me.zone === "Tbilisi time", me);
  check("viewer in another zone sees their own time", F.localTimeIfDifferent("2027-02-14T16:00:00.000Z", "Asia/Tbilisi", "en", "Europe/London") === "16:00");
  check("viewer in the same zone sees nothing extra", F.localTimeIfDifferent("2027-02-14T16:00:00.000Z", "Asia/Tbilisi", "en", "Asia/Tbilisi") === null);

  console.log("\n2. Stored countdown");
  const ok = C.countdownInputSchema.safeParse({ title: "  Our\n wedding  ", date: "2027-06-12", time: "16:00", timeZone: "Asia/Tbilisi", style: "atelier", note: "See you\nthere" });
  check("input normalises whitespace (single line)", ok.success && ok.data.title === "Our wedding" && ok.data.note === "See you there", ok.success ? ok.data : ok.error.issues);
  check("empty title refused", !C.countdownInputSchema.safeParse({ title: "   ", date: "2027-06-12", time: "16:00", timeZone: "Asia/Tbilisi", style: "atelier" }).success);
  check(`title over ${C.COUNTDOWN_TITLE_MAX} refused`, !C.countdownInputSchema.safeParse({ title: "x".repeat(C.COUNTDOWN_TITLE_MAX + 1), date: "2027-06-12", time: "16:00", timeZone: "Asia/Tbilisi", style: "atelier" }).success);
  check("unknown style refused", !C.countdownInputSchema.safeParse({ title: "A", date: "2027-06-12", time: "16:00", timeZone: "Asia/Tbilisi", style: "neon" }).success);
  check("bad zone refused", !C.countdownInputSchema.safeParse({ title: "A", date: "2027-06-12", time: "16:00", timeZone: "Nowhere/City", style: "atelier" }).success);
  const ser = C.serializeCountdown({ title: "Wedding", at: "2027-06-12T12:00:00.000Z", timeZone: "Asia/Tbilisi", style: "midnight", note: null, occasion: "wedding" });
  check("serialize → parse round trip", JSON.stringify(C.parseStoredCountdown(ser)) === JSON.stringify({ title: "Wedding", at: "2027-06-12T12:00:00.000Z", timeZone: "Asia/Tbilisi", style: "midnight", note: null, occasion: "wedding" }));
  check("garbage stored value → null (never rendered, never thrown)", C.parseStoredCountdown("{not json") === null && C.parseStoredCountdown('{"v":2}') === null && C.parseStoredCountdown(null) === null);

  console.log("\n3. Real greetings (draft → paid → activated)");
  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING' limit 1`;
  const [theme] = await admin`select id from themes where key = 'romantic' limit 1`;
  if (!product || !theme) throw new Error("Seed data missing — run npm run db:seed first");
  const partnerId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps) values (${partnerId}, ${`sched-${partnerId.slice(0, 8)}`}, 'Scheduled reveal verify', 3000)`;
  const batchId = crypto.randomUUID();
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'SCHED', 6)`;
  const adminUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;

  async function draft(message: string) {
    const qrId = crypto.randomUUID();
    const token = generatePublicToken();
    const greetingId = crypto.randomUUID();
    const editToken = generateEditToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${batchId}, ${partnerId}, 'DRAFT')`;
    await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values (${greetingId}, ${qrId}, ${theme!.id}, ${product!.id}, 'DRAFT', ${hashEditToken(editToken)})`;
    await Content.updateGreetingMessage(greetingId, editToken, message);
    // FIXTURE: a READY photo row backed by a real (tiny) object, so signing it is meaningful.
    const key = `verify-scheduled/${greetingId}/photo-0.jpg`;
    const up = await createSignedUploadUrl(key);
    const put = await fetch(up.signedUrl, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) });
    if (!put.ok) throw new Error(`fixture upload failed: ${put.status}`);
    uploaded.push(key);
    await admin`insert into greeting_content (greeting_id, type, slot, storage_key, mime_type, size_bytes, status) values (${greetingId}, 'photo', 0, ${key}, 'image/jpeg', 4, 'READY')`;
    return { qrId, token, greetingId, editToken };
  }
  async function activate(g: { greetingId: string; editToken: string }) {
    const { order } = await startCheckout({ greetingId: g.greetingId, editToken: g.editToken, productId: product!.id as string });
    await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: `test_${order.grossAmountMinor}_${order.currency}_${crypto.randomUUID()}`, orderId: order.id, amountMinor: order.grossAmountMinor, currency: order.currency });
    await activatePaidOrder(order.id);
    return order.id as string;
  }
  const rlsRows = async (greetingId: string) => (await runtime`select id from greeting_content where greeting_id = ${greetingId}`).length;
  const state = async (greetingId: string) => (await admin`select app_greeting_public_state(${greetingId}::uuid) as s`)[0]!.s as string;
  const tzNow = (plusMs: number) => S.utcToZonedFields(new Date(Date.now() + plusMs), "Asia/Tbilisi");

  // ---- A. Immediate (regression) ----
  const a = await draft("Immediate greeting");
  await activate(a);
  check("A immediate: resolve → active", (await resolveQrState(a.token)).kind === "active");
  const aLoaded = await R.loadActiveGreetingForRecipient(a.greetingId);
  check("A immediate: content loads with the message", aLoaded.content.some((c) => c.type === "text" && c.textValue === "Immediate greeting"));
  check("A immediate: RLS as app_runtime shows content", (await rlsRows(a.greetingId)) === 2);
  check("A immediate: no countdown", aLoaded.countdown === null);

  // ---- B. Scheduled ----
  const b = await draft("Scheduled secret message");
  const pastIn = tzNow(-120_000);
  check(
    "B schedule in the past refused (server clock)",
    await rejects(Content.setGreetingSchedule(b.greetingId, b.editToken, { date: pastIn.date, time: pastIn.time, timeZone: "Asia/Tbilisi" }), (e) => e instanceof Content.ScheduleInputError && e.code === "past"),
  );
  const far = S.utcToZonedFields(new Date(Date.now() + 400 * DAY), "Asia/Tbilisi");
  check(
    "B schedule 400 days ahead refused",
    await rejects(Content.setGreetingSchedule(b.greetingId, b.editToken, { date: far.date, time: far.time, timeZone: "Asia/Tbilisi" }), (e) => e instanceof Content.ScheduleInputError && e.code === "too_far"),
  );
  check(
    "B schedule with a bogus zone refused",
    await rejects(Content.setGreetingSchedule(b.greetingId, b.editToken, { date: "2027-01-01", time: "10:00", timeZone: "Bogus/Zone" }), (e) => e instanceof Content.ScheduleInputError),
  );
  check(
    "B schedule with a wrong edit token refused",
    await rejects(Content.setGreetingSchedule(b.greetingId, generateEditToken(), { date: "2027-01-01", time: "10:00", timeZone: "Asia/Tbilisi" }), (e) => e instanceof Content.InvalidEditTokenError),
  );
  const future = tzNow(2 * DAY);
  const saved = await Content.setGreetingSchedule(b.greetingId, b.editToken, { date: future.date, time: future.time, timeZone: "Asia/Tbilisi" });
  check("B schedule saved as an instant + zone", typeof saved.unlockAt === "string" && saved.timeZone === "Asia/Tbilisi", saved);
  // Countdown before the unlock → refused; after → accepted.
  const beforeUnlock = tzNow(DAY);
  check(
    "B countdown before the unlock refused (before_unlock)",
    await rejects(
      Content.setGreetingCountdown(b.greetingId, b.editToken, { title: "Too early", date: beforeUnlock.date, time: beforeUnlock.time, timeZone: "Asia/Tbilisi", style: "editorial" }),
      (e) => e instanceof Content.ScheduleInputError && e.code === "before_unlock",
    ),
  );
  const wedding = tzNow(40 * DAY);
  const cd = await Content.setGreetingCountdown(b.greetingId, b.editToken, { title: "Our wedding", date: wedding.date, time: wedding.time, timeZone: "Asia/Tbilisi", style: "midnight", note: "See you there", occasion: "wedding" });
  check("B countdown saved (both features together)", cd.title === "Our wedding" && cd.style === "midnight");
  await Content.setGreetingCountdown(b.greetingId, b.editToken, { title: "Our wedding", date: wedding.date, time: wedding.time, timeZone: "Asia/Tbilisi", style: "atelier", note: "See you there", occasion: "wedding" });
  const cdRows = await admin`select count(*)::int as n from greeting_content where greeting_id = ${b.greetingId} and type = 'countdown'`;
  check("B saving twice keeps exactly one countdown row", cdRows[0]!.n === 1);
  check(
    "B moving the unlock past the countdown refused",
    await rejects(
      Content.setGreetingSchedule(b.greetingId, b.editToken, { date: tzNow(41 * DAY).date, time: tzNow(41 * DAY).time, timeZone: "Asia/Tbilisi" }),
      (e) => e instanceof Content.ScheduleInputError && e.code === "before_unlock",
    ),
  );
  const bOrder = await activate(b);
  check("B scheduled: DB state SCHEDULED", (await state(b.greetingId)) === "SCHEDULED");
  for (let i = 1; i <= 3; i++) check(`B scheduled: scan #${i} resolves to scheduled`, (await resolveQrState(b.token)).kind === "scheduled");
  check("B scheduled: recipient loader refuses with GreetingLockedError (no media URL signed)", await rejects(R.loadActiveGreetingForRecipient(b.greetingId), (e) => e instanceof R.GreetingLockedError));
  check("B scheduled: voice re-signer refuses", await rejects(R.signRecipientVoiceUrl(b.greetingId), (e) => e instanceof R.RecipientAccessError));
  check("B scheduled: RLS as app_runtime returns 0 content rows", (await rlsRows(b.greetingId)) === 0);
  const shell = await R.loadScheduledGreetingShell(b.greetingId);
  const shellJson = JSON.stringify(shell);
  check("B lock shell carries only world + moment + clock", Object.keys(shell).sort().join(",") === "serverNow,themeKey,themeVersion,timeZone,unlockAt", Object.keys(shell));
  check("B lock shell leaks no message, countdown or media", !/secret|wedding|See you|photo|greetings\//i.test(shellJson), shellJson);
  check("B lock shell clock is the database's", Math.abs(shell.serverNow.getTime() - Date.now()) < 5000);
  check(
    "B schedule frozen after activation: the sender's token no longer edits it",
    await rejects(Content.setGreetingSchedule(b.greetingId, b.editToken, null), (e) => e instanceof Content.InvalidEditTokenError),
  );
  check(
    "B schedule frozen after activation: even the superuser is refused by the trigger",
    await rejects(admin`update greetings set unlock_at = now() where id = ${b.greetingId}`, (e) => String((e as Error).message).includes("frozen")),
  );

  // Exactly at the unlock instant (FIXTURE: replica role skips the freeze trigger; one transaction = one now()).
  const exact = await admin.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update greetings set unlock_at = now() + interval '1 millisecond' where id = ${b.greetingId}`;
    const [justBefore] = await tx`select app_greeting_public_state(${b.greetingId}::uuid) as s`;
    await tx`update greetings set unlock_at = now() where id = ${b.greetingId}`;
    const [at] = await tx`select app_greeting_public_state(${b.greetingId}::uuid) as s`;
    return { justBefore: justBefore!.s, at: at!.s };
  });
  check("B 1 ms before the moment → SCHEDULED", exact.justBefore === "SCHEDULED", exact);
  check("B exactly at the moment → OPEN", exact.at === "OPEN", exact);
  check("B after the moment: resolve → active", (await resolveQrState(b.token)).kind === "active");
  const bLoaded = await R.loadActiveGreetingForRecipient(b.greetingId);
  check("B after the moment: message + photo URL + countdown arrive", bLoaded.content.some((c) => c.textValue === "Scheduled secret message") && bLoaded.content.some((c) => c.type === "photo" && !!c.signedUrl) && bLoaded.countdown?.title === "Our wedding");
  check("B after the moment: RLS shows the content", (await rlsRows(b.greetingId)) === 3);
  let shellNowOpen = "none";
  await R.loadScheduledGreetingShell(b.greetingId).catch((e) => (shellNowOpen = e?.constructor?.name ?? "error"));
  check("B the lock loader, asked after the moment, says 'now open' (page redirects, never a blank page)", shellNowOpen === "GreetingNowOpenError", shellNowOpen);

  // ---- C. Refund Model C ----
  const before = await admin`select (select count(*) from greeting_content where greeting_id = ${b.greetingId})::int as content, (select status from greetings where id = ${b.greetingId}) as g, (select status from qr_codes where id = ${b.qrId}) as q`;
  // FIXTURE: put the unlock back in the future, so the refund must win over the schedule.
  await admin.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update greetings set unlock_at = now() + interval '3 days' where id = ${b.greetingId}`;
  });
  await refundPaidOrder(adminUserId, bOrder);
  const [o] = await admin`select status from orders where id = ${bOrder}`;
  check("C the real admin refund (TEST provider) marks the order REFUNDED", o?.status === "REFUNDED", o);
  check("C refunded + scheduled → SUSPENDED (the schedule never re-opens it)", (await state(b.greetingId)) === "SUSPENDED");
  check("C resolve → suspended", (await resolveQrState(b.token)).kind === "suspended");
  check("C recipient loader refuses", await rejects(R.loadActiveGreetingForRecipient(b.greetingId), (e) => e instanceof R.RecipientAccessError && !(e instanceof R.GreetingLockedError)));
  check("C lock loader refuses too (no countdown to a refunded gift)", await rejects(R.loadScheduledGreetingShell(b.greetingId), (e) => e instanceof R.RecipientAccessError));
  check("C RLS as app_runtime returns 0 rows", (await rlsRows(b.greetingId)) === 0);
  await admin.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update greetings set unlock_at = now() - interval '1 day' where id = ${b.greetingId}`;
  });
  check("C refunded + unlock passed → still SUSPENDED", (await state(b.greetingId)) === "SUSPENDED" && (await resolveQrState(b.token)).kind === "suspended");
  const after = await admin`select (select count(*) from greeting_content where greeting_id = ${b.greetingId})::int as content, (select status from greetings where id = ${b.greetingId}) as g, (select status from qr_codes where id = ${b.qrId}) as q`;
  check("C content is retained (nothing deleted, statuses unchanged)", JSON.stringify(before) === JSON.stringify(after), { before, after });
  const aOrder = (await admin`select id from orders where greeting_id = ${a.greetingId} and status = 'PAID'`)[0]!.id as string;
  await refundPaidOrder(adminUserId, aOrder);
  check("C refunded immediate greeting → suspended too", (await resolveQrState(a.token)).kind === "suspended" && (await rlsRows(a.greetingId)) === 0);

  // ---- D. Draft isolation ----
  const d = await draft("Draft only");
  check("D draft: public RLS returns 0 rows (unchanged)", (await rlsRows(d.greetingId)) === 0);
  check("D draft: DB state UNAVAILABLE", (await state(d.greetingId)) === "UNAVAILABLE");
  check("D unknown greeting id → UNAVAILABLE", (await state(crypto.randomUUID())) === "UNAVAILABLE");
  const removed = await Content.removeGreetingCountdown(d.greetingId, d.editToken).then(() => true, () => false);
  check("D removing a countdown that doesn't exist is fine", removed);
  const cleared = await Content.setGreetingSchedule(d.greetingId, d.editToken, null);
  check("D clearing the schedule → opens immediately", cleared.unlockAt === null);
  check(
    "D a skipped DST hour is refused by the server",
    await rejects(Content.setGreetingSchedule(d.greetingId, d.editToken, { date: "2027-03-28", time: "01:30", timeZone: "Europe/London" }), (e) => e instanceof Content.ScheduleInputError && e.code === "nonexistent"),
  );
  check("DB constraint: unlock_at without a zone is refused", await rejects(admin`update greetings set unlock_at = now() + interval '1 day', unlock_time_zone = null where id = ${d.greetingId}`, () => true));

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error(err);
    failed++;
  })
  .finally(async () => {
    for (const key of uploaded) await deleteStorageObject(key).catch(() => undefined);
    await admin.end();
    await runtime.end();
    process.exit(failed === 0 ? 0 : 1);
  });

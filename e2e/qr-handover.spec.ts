import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { completeMfaEnrollment, createThrowawayAdmin, logIn } from "./admin-session";
import { resolveSecretKey } from "../src/lib/supabase/keys";

/**
 * Scan-to-Assign end to end (migrations/0026 + 0027: immediate admin
 * transfers, no partner acceptance) on a production build.
 *
 * Chromium projects feed the scanner a FAKE CAMERA: a generated Y4M video of
 * real QR codes (Chrome's --use-file-for-fake-video-capture), so the actual
 * getUserMedia → decode → resolve path runs. This is emulation, not a phone
 * camera: real-device verification is a separate, manual step.
 * WebKit (iPhone emulation) has no fake camera, so it covers the same flow
 * through manual entry.
 */
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL!, { max: 2 });
const authAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, resolveSecretKey(process.env)!.key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3994";
const TOKEN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const token = () => Array.from({ length: 24 }, () => TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)]).join("");
const cardUrl = (t: string) => `${APP}/g/${t}`;

/** A Y4M (4:2:0) clip: each payload as a QR held for `hold` frames, separated by blank frames. */
async function writeQrVideo(path: string, payloads: string[]) {
  const W = 640, H = 480, hold = 12, gap = 4;
  const frames: Buffer[] = [];
  const blank = () => {
    const y = Buffer.alloc(W * H, 200);
    return Buffer.concat([y, Buffer.alloc((W / 2) * (H / 2) * 2, 128)]);
  };
  for (const payload of payloads) {
    const qr = QRCode.create(payload, { errorCorrectionLevel: "Q" });
    const n = qr.modules.size;
    const scale = Math.floor(360 / (n + 8));
    const size = (n + 8) * scale;
    const ox = Math.floor((W - size) / 2), oy = Math.floor((H - size) / 2);
    const y = Buffer.alloc(W * H, 200);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const r = Math.floor(py / scale) - 4, c = Math.floor(px / scale) - 4;
        const dark = r >= 0 && c >= 0 && r < n && c < n && qr.modules.get(r, c);
        y[(oy + py) * W + ox + px] = dark ? 16 : 235;
      }
    }
    const frame = Buffer.concat([y, Buffer.alloc((W / 2) * (H / 2) * 2, 128)]);
    for (let i = 0; i < hold; i++) frames.push(frame);
    for (let i = 0; i < gap; i++) frames.push(blank());
  }
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`);
  writeFileSync(path, Buffer.concat([header, ...frames.flatMap((f) => [Buffer.from("FRAME\n"), f])]));
}

type Fixture = Awaited<ReturnType<typeof seed>>;

async function seed(run: string) {
  let [central] = await sql<{ id: string }[]>`select id from partners where is_central_stock`;
  if (!central) {
    [central] = await sql<{ id: string }[]>`insert into partners (slug, name, status, is_central_stock) values ('qr-starr-central-stock', 'QR STARR — ცენტრალური საწყობი', 'SUSPENDED', true) returning id`;
  }
  const [batch] = await sql<{ id: string }[]>`insert into qr_batches (partner_id, label, quantity) values (${central!.id}, ${`E2E print ${run}`}, 5) returning id`;
  const cards = Array.from({ length: 5 }, token);
  for (const t of cards) await sql`insert into qr_codes (public_token, batch_id, partner_id) values (${t}, ${batch!.id}, ${central!.id})`;
  const draftCard = cards[4]!;
  await sql.begin(async (t) => {
    await t`set local session_replication_role = replica`;
    await t`update qr_codes set status = 'DRAFT' where public_token = ${draftCard}`;
  });

  const [partner] = await sql<{ id: string }[]>`insert into partners (slug, name) values (${`ho-e2e-${run}`}, ${`Solo FLW ${run}`}) returning id`;
  const [other] = await sql<{ id: string }[]>`insert into partners (slug, name) values (${`ho-e2e-other-${run}`}, ${`Other shop ${run}`}) returning id`;
  const [otherBatch] = await sql<{ id: string }[]>`insert into qr_batches (partner_id, label, quantity) values (${other!.id}, 'other', 1) returning id`;
  const otherCard = token();
  await sql`insert into qr_codes (public_token, batch_id, partner_id) values (${otherCard}, ${otherBatch!.id}, ${other!.id})`;

  const email = `ho-e2e-${run}@verify.test`;
  const password = `Handover-${run}-pass-1`;
  const { data: created, error } = await authAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await sql`insert into partner_members (partner_id, user_id, role) values (${partner!.id}, ${created.user!.id}, 'OWNER')`;
  return { centralId: central!.id, batchId: batch!.id, cards, draftCard, otherCard, partnerId: partner!.id, otherId: other!.id, otherBatchId: otherBatch!.id, email, password, userId: created.user!.id };
}

async function cleanup(f: Fixture) {
  const handovers = await sql<{ id: string; result_batch_id: string | null }[]>`select id, result_batch_id from qr_handovers where to_partner_id = ${f.partnerId}`;
  const ids = handovers.map((h) => h.id);
  await sql.begin(async (t) => {
    await t`set local session_replication_role = replica`;
    if (ids.length) {
      await t`delete from qr_handover_reports where handover_id = any(${ids})`;
      await t`delete from qr_handover_items where handover_id = any(${ids})`;
      await t`delete from qr_handovers where id = any(${ids})`;
    }
    await t`delete from qr_codes where public_token = any(${[...f.cards, f.otherCard]})`;
    await t`delete from qr_batches where id = any(${[f.batchId, f.otherBatchId]}) or partner_id = ${f.partnerId}`;
    await t`delete from partner_members where partner_id = any(${[f.partnerId, f.otherId]})`;
    await t`delete from partners where id = any(${[f.partnerId, f.otherId]})`;
  });
  await authAdmin.auth.admin.deleteUser(f.userId);
}

async function adminSignIn(page: Page) {
  const admin = await createThrowawayAdmin();
  const { data: list } = await authAdmin.auth.admin.listUsers({ perPage: 1000 });
  const adminUser = list.users.find((u) => u.email === admin.email)!;
  await authAdmin.auth.admin.updateUserById(adminUser.id, { app_metadata: { admin_mfa: { enrollment_until: new Date(Date.now() + 15 * 60_000).toISOString(), factor_ids: [] } } });
  await logIn(page, "/admin/login", admin.email, admin.password);
  await page.waitForURL(/\/admin\/mfa\/setup/);
  await completeMfaEnrollment(page);
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  return admin;
}

async function money() {
  const [m] = await sql`select (select count(*)::int from orders) o, (select count(*)::int from payments) p,
    (select count(*)::int from partner_ledger_entries) l, (select count(*)::int from qr_codes where status = 'ACTIVE') act`;
  return m!;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(1);
}

const counter = (page: Page) => page.getByTestId("scan-counter");

test.describe.configure({ mode: "serial" });

test("scan → admin transfer → partner inventory updates at once (no acceptance, no sale, no commission)", async ({ browser, browserName }, testInfo) => {
  test.setTimeout(300_000);
  const run = `${testInfo.project.name.slice(0, 6)}-${randomUUID().slice(0, 6)}`.toLowerCase();
  const f = await seed(run);
  const money0 = await money();
  const useCamera = browserName === "chromium";
  let ownBrowser: Browser | null = null;
  let adminCtx: BrowserContext | null = null;
  let admin: Awaited<ReturnType<typeof adminSignIn>> | null = null;

  try {
    if (useCamera) {
      // Cards 1–3, the DRAFT card, a foreign QR, then card 1 again; Chrome loops the clip.
      const dir = join(tmpdir(), "qr-handover-e2e");
      mkdirSync(dir, { recursive: true });
      const video = join(dir, `${run}.y4m`);
      await writeQrVideo(video, [cardUrl(f.cards[0]!), cardUrl(f.cards[1]!), cardUrl(f.cards[2]!), cardUrl(f.draftCard), `https://example.com/g/${f.cards[3]}`, cardUrl(f.cards[0]!)]);
      ownBrowser = await chromium.launch({
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
      });
      adminCtx = await ownBrowser.newContext({ ...testInfo.project.use, baseURL: APP });
      await adminCtx.grantPermissions(["camera"], { origin: APP });
    } else {
      adminCtx = await browser.newContext({ ...testInfo.project.use });
    }
    await adminCtx.addCookies([{ name: "NEXT_LOCALE", value: "ka", url: APP }]);
    const page = await adminCtx.newPage();
    admin = await adminSignIn(page);

    // Option A still there: the dashboard keeps its existing sections; Option B is added.
    await expect(page.getByTestId("metric-qr-generated")).toBeVisible();
    await expect(page.getByTestId("dashboard-scan-assign")).toContainText("QR ბარათების სკანირება და მინიჭება");

    // Client-side navigation into the scanner (camera policy must allow it from another admin document).
    await page.getByRole("link", { name: "ინვენტარი" }).first().click();
    await expect(page.getByTestId("admin-inventory-page")).toBeVisible();
    await page.getByTestId("scan-assign-cta").click();
    await expect(page.getByTestId("scan-assign")).toBeVisible();
    await noHorizontalScroll(page);

    if (useCamera) {
      await page.getByTestId("camera-start").click();
      await expect(counter(page)).toHaveText("3 / 20", { timeout: 60_000 });
      await expect(page.getByTestId("scan-rejected")).toContainText("მონახაზი", { timeout: 30_000 });
      // A full loop later the duplicates are still not added twice.
      await page.waitForTimeout(12_000);
      await expect(counter(page)).toHaveText("3 / 20");
      await page.getByTestId("camera-stop").click();
    } else {
      const add = async (value: string) => {
        await page.getByTestId("manual-input").fill(value);
        await page.getByTestId("manual-add").click();
      };
      for (const t of f.cards.slice(0, 3)) {
        await add(cardUrl(t));
        await expect(page.getByTestId("scan-feedback")).toHaveAttribute("data-kind", "added");
      }
      await add(cardUrl(f.cards[0]!));
      await expect(page.getByTestId("scan-feedback")).toHaveAttribute("data-kind", "duplicate");
      await add(cardUrl(f.draftCard));
      await expect(page.getByTestId("scan-rejected")).toContainText("მონახაზი");
      await add(`https://example.com/g/${f.cards[3]}`);
      await expect(page.getByTestId("scan-feedback")).toContainText("ეს არ არის QR STARR-ის ბარათი");
      await expect(counter(page)).toHaveText("3 / 20");
    }

    // Another partner's card is refused with the holder named.
    await page.getByTestId("manual-input").fill(f.otherCard);
    await page.getByTestId("manual-add").click();
    await expect(page.getByTestId("scan-rejected")).toContainText(`Other shop ${run}`);

    // Remove one, add it back.
    await page.getByTestId("scan-toggle-list").click();
    await expect(page.getByTestId("scan-selected-item")).toHaveCount(3);
    await page.getByTestId("scan-remove").first().click();
    await expect(counter(page)).toHaveText("2 / 20");
    await page.getByTestId("manual-input").fill(cardUrl(f.cards[0]!));
    await page.getByTestId("manual-add").click();
    await expect(counter(page)).toHaveText("3 / 20");

    // The selection survives navigating away and back.
    await page.goto("/admin/inventory");
    await page.goto("/admin/inventory/scan");
    await expect(counter(page)).toHaveText("3 / 20");

    // Review and submit.
    await page.getByTestId("scan-finish").click();
    await expect(page.getByTestId("handover-review-count")).toHaveText("3");
    await page.getByTestId("handover-partner-select").selectOption(f.partnerId);
    await expect(page.getByTestId("handover-review")).toContainText("პარტნიორის დადასტურება საჭირო არ არის");
    await page.getByTestId("handover-create").click();
    // One confirmation by the admin completes the transfer.
    await expect(page.getByTestId("handover-done")).toContainText("QR ბარათები წარმატებით გადაეცა პარტნიორს.");
    await expect(page.getByTestId("handover-done-body")).toContainText(`Solo FLW ${run} — 3 ბარათი`);
    await expect(page.getByTestId("handover-done-destination")).toHaveText("3");

    const [h] = await sql<{ id: string; status: string; quantity: number; resolved_actor_type: string }[]>`select id, status, quantity, resolved_actor_type from qr_handovers where to_partner_id = ${f.partnerId}`;
    const items = await sql<{ public_token: string }[]>`select q.public_token from qr_handover_items i join qr_codes q on q.id = i.qr_code_id where i.handover_id = ${h!.id}`;
    expect(h).toMatchObject({ status: "ACCEPTED", resolved_actor_type: "ADMIN", quantity: 3 });
    expect(items.map((i) => i.public_token).sort()).toEqual(f.cards.slice(0, 3).sort());
    expect((await sql`select count(*)::int n from qr_codes where public_token in ${sql(f.cards.slice(0, 3))} and partner_id = ${f.partnerId} and status = 'AVAILABLE'`)[0]!.n).toBe(3);

    await page.getByTestId("handover-view-link").click();
    await expect(page.getByTestId("handover-status")).toContainText("გადაცემულია");
    await expect(page.getByTestId("handover-item")).toHaveCount(3);
    // No legacy cancel/reject actions on a completed transfer.
    await expect(page.getByTestId("handover-cancel")).toHaveCount(0);
    // The admin screen never shows a full card token.
    for (const t of f.cards.slice(0, 3)) expect(await page.content()).not.toContain(t);

    // Partner: the cards are already in the inventory — nothing to accept.
    const partnerCtx = await browser.newContext({ ...testInfo.project.use });
    await partnerCtx.addCookies([{ name: "NEXT_LOCALE", value: "ka", url: APP }]);
    const partnerPage = await partnerCtx.newPage();
    await logIn(partnerPage, "/partner/login", f.email, f.password);
    await partnerPage.waitForURL(/\/partner\/dashboard/);
    const incoming = partnerPage.getByTestId("incoming-handovers");
    await expect(partnerPage.getByTestId("handover-notification")).toContainText("QR STARR-ის ადმინისტრაციამ თქვენს მარაგს დაამატა 3 QR ბარათი.");
    await expect(partnerPage.getByTestId("metric-issued").locator("p").nth(1)).toHaveText("3");
    await expect(partnerPage.getByTestId("metric-available").locator("p").nth(1)).toHaveText("3");
    await expect(partnerPage.getByTestId("handover-recent")).toContainText("გადაცემულია");
    for (const id of ["handover-confirm-open", "handover-confirm", "handover-confirm-check", "handover-dispute-open"]) {
      await expect(partnerPage.getByTestId(id)).toHaveCount(0);
    }
    await expect(incoming.getByRole("button", { name: /დადასტურ|Confirm|Accept/ })).toHaveCount(0);
    await noHorizontalScroll(partnerPage);

    // Non-blocking count report: sent to QR STARR, the cards stay.
    await partnerPage.getByTestId("handover-report-open").click();
    await partnerPage.getByTestId("handover-report-count").fill("2");
    await partnerPage.getByTestId("handover-report-note").fill("კონვერტში 2 ბარათი იყო");
    await partnerPage.getByTestId("handover-report-send").click();
    await expect(partnerPage.getByTestId("handover-report-sent")).toBeVisible({ timeout: 30_000 });
    await partnerPage.reload();
    await expect(partnerPage.getByTestId("metric-issued").locator("p").nth(1)).toHaveText("3");
    await expect(partnerPage.getByTestId("handover-report-sent")).toBeVisible();
    await partnerCtx.close();
    expect((await sql`select status from qr_handovers where id = ${h!.id}`)[0]!.status).toBe("ACCEPTED");
    expect((await sql`select count(*)::int n from qr_codes where public_token in ${sql(f.cards.slice(0, 3))} and partner_id = ${f.partnerId}`)[0]!.n).toBe(3);

    // Admin sees the report on the transfer page.
    await page.goto(`/admin/inventory/handovers/${h!.id}`);
    await expect(page.getByTestId("handover-report")).toContainText("კონვერტში 2 ბარათი იყო");

    // Admin sees the same: partner page tiles + inventory history.
    await page.goto(`/admin/partners/${f.partnerId}`);
    await expect(page.getByTestId("admin-metric-issued").locator("p").nth(1)).toHaveText("3");
    await page.goto(`/admin/inventory?q=${encodeURIComponent(`Solo FLW ${run}`)}`);
    await expect(page.getByTestId("handover-row")).toHaveCount(1);
    await expect(page.getByTestId("handover-row")).toHaveAttribute("data-status", "ACCEPTED");

    // No sale, payment, commission or activation from any of this.
    expect(await money()).toEqual(money0);
  } finally {
    await adminCtx?.close().catch(() => undefined);
    await ownBrowser?.close();
    await cleanup(f);
    await admin?.cleanup();
  }
});

test("camera permission denied → clear message, manual entry still works", async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== "chromium" || testInfo.project.name !== "desktop-chromium", "one run is enough for the denial path");
  test.setTimeout(180_000);
  const run = `deny-${randomUUID().slice(0, 6)}`;
  const f = await seed(run);
  const ctx = await browser.newContext({ ...testInfo.project.use });
  let admin: Awaited<ReturnType<typeof adminSignIn>> | null = null;
  try {
    await ctx.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: "ka", url: APP }]);
    const page = await ctx.newPage();
    admin = await adminSignIn(page);
    await page.goto("/admin/inventory/scan");
    await page.getByTestId("camera-start").click();
    await expect(page.getByTestId("camera-problem")).toContainText("კამერაზე წვდომა უარყოფილია");
    await expect(page.getByTestId("camera-retry")).toBeVisible();
    await page.getByTestId("manual-input").fill(cardUrl(f.cards[0]!));
    await page.getByTestId("manual-add").click();
    await expect(counter(page)).toHaveText("1 / 20");
  } finally {
    await ctx.close();
    await cleanup(f);
    await admin?.cleanup();
  }
});

test.afterAll(async () => {
  await sql.end();
});

test("admin-only redistribution: partner → partner via batch pick, immediate", async ({ browser, browserName }, testInfo) => {
  test.skip(testInfo.project.name === "android-pixel7", "covered on desktop Chromium and iPhone WebKit");
  test.setTimeout(240_000);
  const run = `p2p-${browserName.slice(0, 3)}-${randomUUID().slice(0, 6)}`;
  const f = await seed(run);
  // Source partner "G'N"-like: owns a batch of 3 sellable cards + 1 draft.
  const [src] = await sql<{ id: string }[]>`insert into partners (slug, name) values (${`ho-src-${run}`}, ${`Source shop ${run}`}) returning id`;
  const [srcBatch] = await sql<{ id: string }[]>`insert into qr_batches (partner_id, label, quantity) values (${src!.id}, ${`src ${run}`}, 4) returning id`;
  const srcCards = Array.from({ length: 4 }, token);
  for (const t of srcCards) await sql`insert into qr_codes (public_token, batch_id, partner_id) values (${t}, ${srcBatch!.id}, ${src!.id})`;
  await sql.begin(async (t) => {
    await t`set local session_replication_role = replica`;
    await t`update qr_codes set status = 'DRAFT' where public_token = ${srcCards[3]!}`;
  });
  const money0 = await money();
  const ctx = await browser.newContext({ ...testInfo.project.use });
  let admin: Awaited<ReturnType<typeof adminSignIn>> | null = null;
  try {
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: "ka", url: APP }]);
    const page = await ctx.newPage();
    admin = await adminSignIn(page);
    await page.goto("/admin/inventory/scan");
    await page.getByTestId("batch-select").selectOption(srcBatch!.id);
    await page.getByTestId("batch-add").click();
    await expect(counter(page)).toHaveText("3 / 20");
    await expect(page.getByTestId("scan-source")).toContainText(`Source shop ${run}`);
    // A central-stock card can't join a handover whose source is the shop.
    await page.getByTestId("manual-input").fill(cardUrl(f.cards[0]!));
    await page.getByTestId("manual-add").click();
    await expect(page.getByTestId("scan-feedback")).toHaveAttribute("data-kind", "rejected");
    await expect(counter(page)).toHaveText("3 / 20");

    await page.getByTestId("scan-finish").click();
    await expect(page.getByTestId("handover-review-source")).toHaveText(`Source shop ${run}`);
    await expect(page.getByTestId("handover-partner-select").locator(`option[value="${src!.id}"]`)).toHaveCount(0);
    await page.getByTestId("handover-partner-select").selectOption(f.partnerId);
    await page.getByTestId("handover-create").click();
    await expect(page.getByTestId("handover-done-body")).toContainText("3");
    await expect(page.getByTestId("handover-done-source")).toHaveText("0");

    const [h] = await sql<{ id: string; from_partner_id: string; status: string }[]>`select id, from_partner_id, status from qr_handovers where to_partner_id = ${f.partnerId}`;
    expect(h!.from_partner_id).toBe(src!.id);
    expect(h!.status).toBe("ACCEPTED");

    const pctx = await browser.newContext({ ...testInfo.project.use });
    await pctx.addCookies([{ name: "NEXT_LOCALE", value: "ka", url: APP }]);
    const pp = await pctx.newPage();
    await logIn(pp, "/partner/login", f.email, f.password);
    await pp.waitForURL(/\/partner\/dashboard/);
    // The receiver never learns which shop the cards came from.
    await expect(pp.getByTestId("incoming-handovers")).toContainText("QR STARR");
    await expect(pp.locator("body")).not.toContainText(`Source shop ${run}`);
    await expect(pp.getByTestId("handover-notification")).toContainText("3 QR ბარათი");
    await expect(pp.getByTestId("metric-available").locator("p").nth(1)).toHaveText("3");
    await pctx.close();

    const [counts] = await sql`select (select count(*)::int from qr_codes where partner_id = ${src!.id}) src, (select count(*)::int from qr_codes where partner_id = ${f.partnerId}) dst`;
    expect(counts).toEqual({ src: 1, dst: 3 });
    await page.goto(`/admin/partners/${src!.id}`);
    await expect(page.getByTestId("admin-metric-issued").locator("p").nth(1)).toHaveText("1");
    expect(await money()).toEqual(money0);
  } finally {
    await ctx.close();
    const hs = await sql<{ id: string }[]>`select id from qr_handovers where to_partner_id = ${f.partnerId}`;
    await sql.begin(async (t) => {
      await t`set local session_replication_role = replica`;
      await t`delete from qr_handover_items where handover_id = any(${hs.map((x) => x.id)})`;
      await t`delete from qr_handovers where id = any(${hs.map((x) => x.id)})`;
      await t`delete from qr_codes where public_token = any(${srcCards})`;
      await t`delete from qr_batches where id = ${srcBatch!.id}`;
      await t`delete from partners where id = ${src!.id}`;
    });
    await cleanup(f);
    await admin?.cleanup();
  }
});

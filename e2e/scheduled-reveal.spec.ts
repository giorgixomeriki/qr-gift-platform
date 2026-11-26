import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { createAvailableQr } from "./fixtures";

/**
 * Scheduled Reveal + Celebration Countdown, through the real app:
 * the sender sets both on the Create screen, previews the countdown beat,
 * pays (TEST provider); the recipient finds a locked envelope with a live
 * countdown and no greeting in the page; at the moment it opens by itself
 * into the envelope and the countdown beat; the device clock can't move it;
 * a confirmed refund suspends it (Refund Model C). DB rows are moved only by
 * marked FIXTURE writes (superuser).
 */
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });
const MESSAGE = "A secret only for the right moment.";
// Sender-typed, so they can't also appear in the page's translation catalog (which ships occasion suggestions like "Our wedding").
const TITLE = "Nino and Luka, Mtskheta";
const NOTE = "Bring the blue scarf 7Q.";

test.use({ locale: "en-US" });
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
});

function dayPlus(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Tbilisi" }); // YYYY-MM-DD
}
async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
async function greetingIdOf(token: string) {
  const [g] = await sql`select g.id from greetings g join qr_codes q on q.id = g.qr_code_id where q.public_token = ${token}`;
  return g!.id as string;
}
/** FIXTURE: move the frozen schedule (replica role skips the freeze trigger). */
async function moveUnlock(greetingId: string, interval: string) {
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx.unsafe(`update greetings set unlock_at = now() + interval '${interval}' where id = '${greetingId}'`);
  });
}

test.describe.serial("Scheduled Reveal + Celebration Countdown", () => {
  let token = "";
  let cleanup: () => Promise<void> = async () => {};
  test.beforeAll(async () => {
    const qr = await createAvailableQr();
    token = qr.publicToken;
    cleanup = qr.cleanup;
  });
  test.afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  test("sender schedules the opening and adds a countdown, previews it, and pays", async ({ page }) => {
    await page.goto(`/g/${token}`);
    await page.getByTestId("start-greeting-button").click();
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("message-textarea").fill(MESSAGE);

    // 1. When should it open? — at a date I choose.
    await page.getByTestId("open-later").click();
    await page.getByTestId("open-zone").selectOption("Asia/Tbilisi");
    await page.getByTestId("open-date").fill(dayPlus(2));
    await page.getByTestId("open-time").fill("10:00");
    await expect(page.getByTestId("open-status")).toHaveAttribute("data-state", "saved");
    await expect(page.getByTestId("open-status")).toContainText("Opens");

    // 2. A countdown: switched on, Continue refuses until it's complete.
    await page.getByTestId("countdown-toggle").click();
    await expect(page.getByTestId("countdown-toggle")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("countdown-title")).toHaveValue("Our wedding");
    await page.getByTestId("countdown-title").fill(TITLE);
    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("timing-block")).toBeVisible();

    // A day before the opening is refused with the reason.
    await page.getByTestId("countdown-zone").selectOption("Asia/Tbilisi");
    await page.getByTestId("countdown-date").fill(dayPlus(1));
    await expect(page.getByTestId("countdown-status")).toHaveAttribute("data-code", "before_unlock");

    await page.getByTestId("countdown-date").fill(dayPlus(40));
    await page.getByTestId("countdown-style-midnight").click();
    await page.getByTestId("countdown-note").fill(NOTE);
    await expect(page.getByTestId("countdown-status")).toHaveAttribute("data-state", "saved");
    await noHorizontalScroll(page);
    await page.getByTestId("wizard-continue").click();

    await expect(page.getByTestId("preview-contents")).toContainText("countdown");
    await expect(page.getByTestId("preview-opens")).toContainText("10:00");
    await page.getByTestId("preview-watch").click();
    await page.getByTestId("greeting-tap-to-open").click();
    await expect(page.getByTestId("greeting-message-beat")).toBeVisible();
    await page.getByTestId("greeting-continue").click();
    const beat = page.getByTestId("greeting-countdown-beat");
    await expect(beat).toBeVisible();
    await expect(beat.getByRole("timer")).toHaveAttribute("aria-label", /Nino and Luka, Mtskheta: (39|40) days/);
    await expect(beat.locator('.ec[data-style="midnight"]')).toBeVisible();
    await page.getByTestId("greeting-continue").click();
    await page.getByTestId("preview-activate-cta").click();
    await page.getByTestId("checkout-consent").check();
    await page.getByTestId("checkout-pay").click();

    // The sender lands on their own card: locked, with their note about when it opens.
    await expect(page.getByTestId("scheduled-reveal")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("scheduled-sender-banner")).toBeVisible();
    const [o] = await sql`select o.status from orders o join qr_codes q on q.id = o.qr_code_id where q.public_token = ${token}`;
    expect(o!.status).toBe("PAID");
  });

  test("the recipient sees only the lock; the device clock can't open it; refreshes keep counting", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: test.info().project.use.baseURL! }]);
    const page = await ctx.newPage();
    // The phone's clock is set a year ahead: nothing may open.
    await page.clock.install({ time: new Date(Date.now() + 365 * 86_400_000) });
    const res = await page.goto(`/g/${token}`);
    const html = (await res!.text()) + (await page.content());
    expect(html).not.toContain(MESSAGE);
    expect(html).not.toContain(TITLE);
    expect(html).not.toContain(NOTE);
    await expect(page.getByTestId("scheduled-reveal")).toBeVisible();
    await expect(page.getByTestId("scheduled-sender-banner")).toHaveCount(0);
    const timer = page.getByRole("timer");
    await expect(timer).toHaveAttribute("aria-label", /Opens in (1 day|2 days)/);
    await expect(page.getByTestId("scheduled-when")).toContainText("10:00");
    await expect(page.getByTestId("greeting-renderer")).toHaveCount(0);
    await noHorizontalScroll(page);
    for (let i = 0; i < 2; i++) {
      await page.reload();
      await expect(page.getByTestId("scheduled-reveal")).toBeVisible();
    }
    await ctx.close();
  });

  test("at the moment it opens by itself into the envelope, then the countdown beat", async ({ browser }) => {
    const id = await greetingIdOf(token);
    await moveUnlock(id, "12 seconds");
    const ctx = await browser.newContext({ reducedMotion: test.info().project.name === "mobile-emulated" ? "reduce" : "no-preference" });
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: test.info().project.use.baseURL! }]);
    const page = await ctx.newPage();
    await page.goto(`/g/${token}`);
    await expect(page.getByTestId("scheduled-reveal")).toBeVisible();
    // No reload, no tap: the page asks the server at zero and the greeting arrives.
    await expect(page.getByTestId("greeting-tap-to-open")).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toContain("from=lock");
    await page.getByTestId("greeting-tap-to-open").click();
    await expect(page.getByText(MESSAGE).first()).toBeVisible();
    await page.getByTestId("greeting-continue").click();
    const beat = page.getByTestId("greeting-countdown-beat");
    await expect(beat).toBeVisible();
    await expect(beat).toContainText(NOTE);
    await noHorizontalScroll(page);
    await ctx.close();
    // FIXTURE: lock it again — the refund test checks that a schedule never wins over a refund.
    await moveUnlock(id, "2 days");
  });

  test("a confirmed full refund suspends it, even with a schedule (Refund Model C)", async ({ browser }, info) => {
    // FIXTURE: the refund itself is covered through the real admin service in verify:scheduled-reveal.
    await sql`update orders set status = 'REFUNDED' where qr_code_id = (select id from qr_codes where public_token = ${token}) and status = 'PAID'`;
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: info.project.use.baseURL! }]);
    const page = await ctx.newPage();
    const res = await page.goto(`/g/${token}`);
    // Refund Model C's neutral placeholder (0029): never says "refunded".
    await expect(page.getByText("This greeting is currently unavailable")).toBeVisible();
    const html = await res!.text();
    expect(html).not.toContain(MESSAGE);
    await expect(page.locator("main")).not.toContainText(/refund/i);
    await expect(page.getByTestId("scheduled-reveal")).toHaveCount(0);
    await ctx.close();
  });
});

test("the three countdown styles keep four units on one line at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const style of ["editorial", "atelier", "midnight"]) {
    await page.goto(`/lab/countdown/beat?style=${style}&theme=romantic&en=1`);
    const tops = await page.locator(".ec__unit:not([data-unit='d'])").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    await noHorizontalScroll(page);
  }
});

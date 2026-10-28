import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * Signature Experience 2.0 (docs/design/signature-2/README.md): the redesigned
 * post-scan screens over the unchanged flow. One greeting is made through the
 * real UI — with a real voice note uploaded to local Storage — and activated
 * with the TEST provider; the recipient tests then open it as a stranger
 * would (a fresh browser context: no edit cookie).
 */
const MESSAGE = "Dear Nino, every ordinary day is better with you. With all my love.";
/** 2 s of audio: loud for the first second, near-silent for the second (generated with ffmpeg; test data only). */
const VOICE = path.join(__dirname, "fixtures", "loud-then-quiet.m4a");

/** Bar heights (px) of a waveform, left to right. */
async function barHeights(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((bars) => bars.map((b) => b.getBoundingClientRect().height));
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test.describe.configure({ mode: "serial" });

test.describe("Signature Experience 2.0", () => {
  let token: string;
  let cleanup: () => Promise<void>;

  // One greeting serves the whole group, so it runs in one project; phone sizes are covered by explicit contexts below.
  test.beforeAll(async ({}, info) => {
    test.skip(info.project.name !== "desktop-chromium", "the group shares one greeting; phone viewports are set per test");
    const qr = await createAvailableQr();
    token = qr.publicToken;
    cleanup = qr.cleanup;
  });
  test.afterAll(async () => {
    await cleanup?.();
  });

  test("sender: a voice note shows its real waveform, then checkout's order slip activates the greeting", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/g/${token}`);
    await page.getByTestId("start-greeting-button").click();
    await expect(page.getByTestId("theme-step")).toBeVisible();
    await page.getByTestId("theme-option-romantic").click();
    await page.getByTestId("wizard-continue").click();

    await page.getByTestId("message-textarea").fill(MESSAGE);
    await page.getByTestId("add-audio").click();
    // Typed as audio/mp4 explicitly: Playwright would infer audio/x-m4a from the extension, which the upload allowlist doesn't list.
    await page.getByTestId("voice-file-input").setInputFiles({ name: "voice-note.m4a", mimeType: "audio/mp4", buffer: fs.readFileSync(VOICE) });
    await expect(page.getByTestId("media-ready-audio-0")).toBeVisible({ timeout: 30_000 });

    // The row's waveform is decoded from the uploaded audio, not drawn from a formula:
    // the loud first second stands taller than the quiet second.
    const rowWave = page.locator('[data-testid="media-row-audio-0"] .sig-wave[data-real]');
    await expect(rowWave).toBeVisible({ timeout: 10_000 });
    const rowBars = await barHeights(page, '[data-testid="media-row-audio-0"] .sig-wave i');
    expect(mean(rowBars.slice(0, 3))).toBeGreaterThan(mean(rowBars.slice(-3)) * 2);

    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("preview-step")).toBeVisible();
    await page.getByTestId("preview-activate-cta").click();

    // The order slip: the server's amount, the real contents, the test-mode label.
    const checkout = page.getByTestId("checkout-step");
    await expect(checkout).toBeVisible();
    await expect(page.getByTestId("checkout-amount")).toHaveText(/\d/);
    await expect(checkout).toContainText("voice");
    await expect(checkout).toContainText("Test mode");

    // A simulated failure is answered in place, then retried.
    await page.getByTestId("checkout-testing-toggle").click();
    await page.getByTestId("checkout-simulate-failure").click();
    await expect(page.getByTestId("payment-failed-message")).toBeVisible();
    await page.getByTestId("checkout-retry").click();
    await expect(page.getByTestId("checkout-pay")).toBeVisible();

    await page.getByTestId("checkout-pay").click();
    await expect(page.getByTestId("sender-success-banner")).toBeVisible({ timeout: 20_000 });
  });

  test("recipient (phone): the sealed envelope keeps the words private until it is opened", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await page.goto(`/g/${token}`);
    const reveal = page.getByTestId("greeting-renderer");
    await expect(reveal).toHaveAttribute("data-stage", "closed");
    await expect(reveal.locator('.sx-env[data-state="sealed"]')).toBeVisible();
    await expect(reveal).toContainText("Someone made this just for you"); // the Romantic opening line, as real text
    await expect(page.locator("body")).not.toContainText("ordinary day");
    await expect(page.getByTestId("sender-banner")).toHaveCount(0);

    await page.getByTestId("greeting-tap-to-open").tap();
    await expect(reveal).toHaveAttribute("data-stage", "opening");
    await expect(page.getByTestId("greeting-message-beat")).toBeVisible();
  });

  test("recipient: the voice beat plays a real waveform, and the closing keeps the letter and the keepsake", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/g/${token}`);
    await page.getByTestId("greeting-tap-to-open").click();
    await expect(page.getByTestId("greeting-message-beat")).toBeVisible();
    await page.getByTestId("greeting-continue").click();

    await expect(page.getByTestId("greeting-audio-beat")).toBeVisible();
    const wave = page.locator('[data-testid="greeting-audio-beat"] [data-waveform="real"]');
    await expect(wave).toBeVisible({ timeout: 10_000 });
    const bars = await barHeights(page, '[data-testid="greeting-audio-beat"] [data-waveform="real"] > span');
    expect(mean(bars.slice(0, 8))).toBeGreaterThan(mean(bars.slice(-8)) * 2);

    await page.getByTestId("greeting-continue").click();
    await expect(page.getByTestId("greeting-ending-beat")).toBeVisible();
    const closing = page.getByTestId("greeting-closing");
    await expect(closing).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId("greeting-closing-letter")).toContainText(MESSAGE);
    await expect(closing).toContainText("01");
    await expect(closing).toContainText("This letter is yours to keep.");
    // Nothing plays by itself.
    expect(await closing.locator("audio").evaluateAll((els) => els.every((a) => (a as HTMLAudioElement).paused))).toBe(true);

    await page.getByTestId("greeting-to-closing").click();
    await expect(closing).toBeInViewport();
    await page.getByTestId("greeting-replay").click();
    await expect(page.locator('.sx-env[data-state="sealed"]')).toBeVisible();
  });

  test("recipient: keyboard alone opens and reads the greeting", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/g/${token}`);
    await expect(page.getByTestId("greeting-tap-to-open")).toBeVisible();
    // The seal is a pointer target only; Tab reaches the labelled Open button.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      if (await page.getByTestId("greeting-tap-to-open").evaluate((el) => el === document.activeElement)) break;
    }
    await expect(page.getByTestId("greeting-tap-to-open")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("greeting-message-beat")).toBeVisible();
  });

  test("recipient, reduced motion: the envelope opens at once", async ({ browser }) => {
    const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
    await page.goto(`/g/${token}`);
    await page.getByTestId("greeting-tap-to-open").click();
    await expect(page.getByTestId("greeting-message-beat")).toBeVisible({ timeout: 700 });
  });

  test("320 px: no screen of the reveal scrolls sideways", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true })).newPage();
    await page.goto(`/g/${token}`);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId("greeting-tap-to-open").click();
    await expect(page.getByTestId("greeting-message-beat")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId("greeting-continue").click();
    await page.getByTestId("greeting-continue").click();
    await expect(page.getByTestId("greeting-closing")).toBeVisible({ timeout: 12_000 });
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

test("a greeting someone else is still writing shows the sealed envelope, not the draft", async ({ page, browser }) => {
  const qr = await createAvailableQr();
  try {
    await page.goto(`/g/${qr.publicToken}`);
    await page.getByTestId("start-greeting-button").click();
    await expect(page.getByTestId("theme-step")).toBeVisible();

    const stranger = await (await browser.newContext()).newPage();
    await stranger.goto(`/g/${qr.publicToken}`);
    await expect(stranger.getByTestId("status-screen")).toBeVisible();
    await expect(stranger.locator(".sig-status-screen__env .sig-env")).toBeVisible();
    await expect(stranger.getByTestId("theme-step")).toHaveCount(0);
  } finally {
    await qr.cleanup();
  }
});

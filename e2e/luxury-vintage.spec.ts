import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * Luxury Vintage, the seventh world (docs/design/signature-2/LUXURY-VINTAGE.md):
 * chosen, written and activated through the real UI with two real photo
 * uploads and the TEST provider, then opened as a stranger would. Covers the
 * world's own sender skin, its envelope, its composition and finale, the
 * lazily loaded third-party keepsakes (React Bits Stack, Motion Primitives
 * SpinningText, Magic UI Confetti), and that those never load for another world.
 */
const MESSAGE = "Dear Nino, some words are meant to be kept for a lifetime.";
const PRINTS = ["print-a.jpg", "print-b.jpg"].map((f) => path.join(__dirname, "fixtures", f));

/** Script chunks a page loads (by file name), to compare what each world downloads. */
function trackScripts(page: Page) {
  const seen = new Set<string>();
  page.on("response", (r) => {
    if (r.request().resourceType() === "script") seen.add(new URL(r.url()).pathname.split("/").pop()!);
  });
  return seen;
}

test.describe.configure({ mode: "serial" });

test.describe("Luxury Vintage", () => {
  let token: string;
  let cleanup: () => Promise<void>;

  test.beforeAll(async ({}, info) => {
    test.skip(info.project.name !== "desktop-chromium", "the group shares one greeting; phone viewports are set per test");
    const qr = await createAvailableQr();
    token = qr.publicToken;
    cleanup = qr.cleanup;
  });
  test.afterAll(async () => {
    await cleanup?.();
  });

  test("sender: the seventh world is chosen, written on its parchment and activated", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/g/${token}`);
    await page.getByTestId("start-greeting-button").click();
    await expect(page.getByTestId("theme-step")).toBeVisible();
    await page.getByTestId("theme-option-luxury-vintage").click();
    await expect(page.getByTestId("theme-option-luxury-vintage")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-testid="theme-hero"] .tw--keepsake')).toBeVisible();
    await page.getByTestId("wizard-continue").click();

    await expect(page.getByTestId("create-step")).toHaveAttribute("data-composition", "keepsake");
    await page.getByTestId("message-textarea").fill(MESSAGE);
    await page.getByTestId("media-input-photo").setInputFiles(PRINTS);
    await expect(page.getByTestId("media-ready-photo-0")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("media-ready-photo-1")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("wizard-continue").click();

    await expect(page.getByTestId("preview-watch")).toHaveAttribute("data-composition", "keepsake");
    await page.getByTestId("preview-activate-cta").click();
    await expect(page.getByTestId("checkout-step")).toContainText("Luxury Vintage");
    await page.getByTestId("checkout-pay").click();
    await expect(page.getByTestId("sender-success-banner")).toBeVisible({ timeout: 20_000 });
  });

  test("recipient (phone): the vintage envelope, the keepsake letter and its finale", async ({ browser }) => {
    test.setTimeout(60_000);
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await page.goto(`/g/${token}`);
    const reveal = page.getByTestId("greeting-renderer");
    await expect(reveal).toHaveAttribute("data-composition", "keepsake");
    await expect(reveal).toContainText("A letter kept just for you");
    await expect(page.locator("body")).not.toContainText("kept for a lifetime");

    await page.getByTestId("greeting-tap-to-open").tap();
    const beat = page.getByTestId("greeting-message-beat");
    await expect(beat.locator(".tw--keepsake")).toBeVisible();
    await expect(beat.locator(".tw__message")).toHaveText(MESSAGE);
    await expect(beat.locator(".tw")).toHaveAttribute("data-scene", "rest", { timeout: 12_000 });

    for (let i = 0; i < 2; i++) {
      await page.getByTestId("greeting-continue").tap();
      await expect(page.getByTestId("greeting-photo-beat")).toBeVisible();
    }
    await page.getByTestId("greeting-continue").tap();
    const ending = page.getByTestId("greeting-ending-beat");
    await expect(ending).toHaveAttribute("data-finale", "keepsake-seal");
    await expect(ending.locator(".tw")).toHaveAttribute("data-scene", "rest", { timeout: 12_000 });
  });

  test("recipient: the keepsakes are third-party components, keyboard-operable and loaded for this world only", async ({ browser }) => {
    // Two greetings are opened end to end (one made through the UI): generous for a loaded machine.
    test.setTimeout(150_000);
    const page = await (await browser.newContext()).newPage();
    const scripts = trackScripts(page);
    await page.goto(`/g/${token}`);
    await page.getByTestId("greeting-tap-to-open").click();
    for (let i = 0; i < 3; i++) await page.getByTestId("greeting-continue").click();
    const closing = page.getByTestId("greeting-closing");
    await expect(closing).toBeVisible({ timeout: 12_000 });

    // The letter on parchment, with the world's sign-off.
    await expect(closing.locator(".sx-letter--vintage")).toContainText(MESSAGE);
    await expect(closing.locator(".sx-letter--vintage")).toContainText("Yours, always");

    // React Bits Stack: the prints, as a labelled group the keyboard can leaf through.
    const stack = closing.getByRole("group", { name: "Photos. Press Enter for the next one." });
    await expect(stack).toBeVisible();
    await expect(stack.locator("img")).toHaveCount(2);
    const topBefore = await stack.locator(".stack-card[data-top] img").getAttribute("alt");
    await stack.focus();
    await page.keyboard.press("Enter");
    await expect(stack.locator(".stack-card[data-top] img")).not.toHaveAttribute("alt", topBefore!, { timeout: 5_000 });

    // Motion Primitives SpinningText: the postmark around the seal, also as text for screen readers.
    await expect(page.getByTestId("vintage-seal")).toContainText("QR STARR · LUXURY VINTAGE");
    // Magic UI Confetti: its canvas is there (the petals fall once, when the seal is seen).
    await expect(page.getByTestId("vintage-seal").locator("canvas")).toHaveCount(1);
    const vintageScripts = new Set(scripts);

    // Another world's recipient never downloads the vintage keepsake chunks.
    const other = await createAvailableQr();
    try {
      const sender = await (await browser.newContext()).newPage();
      await sender.goto(`/g/${other.publicToken}`);
      await sender.getByTestId("start-greeting-button").click();
      await sender.getByTestId("theme-option-romantic").click();
      await sender.getByTestId("wizard-continue").click();
      await sender.getByTestId("message-textarea").fill("Hello");
      await sender.getByTestId("wizard-continue").click();
      await sender.getByTestId("preview-activate-cta").click();
      await sender.getByTestId("checkout-pay").click();
      await expect(sender.getByTestId("sender-success-banner")).toBeVisible({ timeout: 20_000 });

      const romantic = await (await browser.newContext()).newPage();
      const romanticScripts = trackScripts(romantic);
      await romantic.goto(`/g/${other.publicToken}`);
      await romantic.getByTestId("greeting-tap-to-open").click();
      await romantic.getByTestId("greeting-continue").click();
      await expect(romantic.getByTestId("greeting-closing")).toBeVisible({ timeout: 12_000 });
      await expect(romantic.getByTestId("vintage-seal")).toHaveCount(0);
      const onlyVintage = [...vintageScripts].filter((s) => !romanticScripts.has(s));
      expect(onlyVintage.length, "the vintage world loads chunks of its own").toBeGreaterThan(0);
    } finally {
      await other.cleanup();
    }
  });

  test("recipient, reduced motion: the postmark rests unrotated", async ({ browser }) => {
    const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
    await page.goto(`/g/${token}`);
    await page.getByTestId("greeting-tap-to-open").click();
    for (let i = 0; i < 3; i++) await page.getByTestId("greeting-continue").click();
    const ring = page.locator(".sx-vintage-seal__ring");
    await expect(ring).toBeVisible({ timeout: 12_000 });
    await page.waitForTimeout(1200);
    const transform = await ring.evaluate((e) => getComputedStyle(e).transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
  });

  test("320 px: the picker shows all seven worlds above the action, and the reveal never scrolls sideways", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true })).newPage();
    await page.goto(`/g/${token}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByTestId("greeting-tap-to-open").tap();
    await expect(page.getByTestId("greeting-message-beat")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    const qr = await createAvailableQr();
    try {
      const picker = await (await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true })).newPage();
      await picker.goto(`/g/${qr.publicToken}`);
      await picker.getByTestId("start-greeting-button").tap();
      await expect(picker.getByTestId("theme-step")).toBeVisible();
      const action = (await picker.getByTestId("wizard-continue").boundingBox())!;
      const seventh = (await picker.getByTestId("theme-option-luxury-vintage").boundingBox())!;
      expect(seventh.y + seventh.height).toBeLessThanOrEqual(action.y);
      expect(action.y + action.height).toBeLessThanOrEqual(568);
    } finally {
      await qr.cleanup();
    }
  });
});

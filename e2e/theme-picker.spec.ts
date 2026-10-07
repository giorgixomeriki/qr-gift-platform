import { test, expect, type Page } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * Screen #2 — the theme picker ("How should it feel?"). Behaviour only, no
 * pixels: the six worlds are one radio group (seals on phones, a list on
 * desktop); choosing saves the theme; the choice survives reloads, the next
 * step and back, locale switches, keyboard use, swiping (phones) and
 * reduced motion.
 */
const THEMES = ["minimal", "romantic", "birthday", "wedding", "celebration", "elegant"] as const;

test.use({ locale: "en-US" });
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
});

let cleanup: (() => Promise<void>) | null = null;
test.afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

async function openPicker(page: Page) {
  const qr = await createAvailableQr();
  cleanup = qr.cleanup;
  await page.goto(`/g/${qr.publicToken}`);
  await page.getByTestId("start-greeting-button").click();
  await expect(page.getByTestId("theme-step")).toBeVisible();
  return qr.publicToken;
}

/** The theme is saved shortly after a choice settles — wait for that save to finish. */
async function choose(page: Page, key: (typeof THEMES)[number]) {
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/g/"));
  await page.getByTestId(`theme-option-${key}`).click();
  await saved;
  await expect(page.getByTestId(`theme-option-${key}`)).toHaveAttribute("aria-checked", "true");
}

test.describe("Theme picker", () => {
  test("enters from Screen #1 with six worlds and the default chosen", async ({ page }) => {
    await openPicker(page);
    const group = page.getByRole("radiogroup", { name: "How should it feel?" });
    await expect(group.getByRole("radio")).toHaveCount(6);
    await expect(page.getByTestId("theme-option-minimal")).toHaveAttribute("aria-checked", "true");
    await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
  });

  test("each world can be chosen, and the choice is saved", async ({ page }) => {
    await openPicker(page);
    for (const key of THEMES.slice(1)) {
      await choose(page, key);
      await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);
    }
    await page.reload();
    await expect(page.getByTestId("theme-option-elegant")).toHaveAttribute("aria-checked", "true");
  });

  test("the choice carries into the next step and is still chosen on the way back", async ({ page }) => {
    await openPicker(page);
    await choose(page, "wedding");
    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("message-textarea")).toBeVisible();
    await page.getByTestId("wizard-back").click();
    await expect(page.getByTestId("theme-step")).toBeVisible();
    await expect(page.getByTestId("theme-option-wedding")).toHaveAttribute("aria-checked", "true");
  });

  test("keyboard: arrows move the choice within the group, focus follows", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-emulated", "keyboard model checked on desktop");
    await openPicker(page);
    await page.getByTestId("theme-option-minimal").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("theme-option-romantic")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("theme-option-romantic")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("theme-option-elegant")).toHaveAttribute("aria-checked", "true");
    // Only the chosen radio is in the tab order.
    await expect(page.getByTestId("theme-option-elegant")).toHaveAttribute("tabindex", "0");
    await expect(page.getByTestId("theme-option-minimal")).toHaveAttribute("tabindex", "-1");
  });

  test("switching language keeps the chosen world", async ({ page }) => {
    await openPicker(page);
    await choose(page, "celebration");
    await page.getByTestId("locale-ka").click();
    await expect(page.getByTestId("theme-step")).toContainText("როგორი იყოს ეს საჩუქარი?");
    await expect(page.getByTestId("theme-option-celebration")).toHaveAttribute("aria-checked", "true");
  });

  test("phones: swiping the gallery chooses the world that comes to rest", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-emulated", "the gallery is the phone layout");
    await openPicker(page);
    const gallery = page.getByTestId("theme-gallery");
    await expect(gallery).toBeVisible();
    // A swipe, as the browser sees it: the gallery scrolls and snaps.
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/g/"));
    await gallery.evaluate((el) => {
      const slide = el.querySelector<HTMLElement>('[data-world="birthday"]')!;
      el.scrollTo({ left: slide.offsetLeft - (el.clientWidth - slide.clientWidth) / 2 });
    });
    await expect(page.getByTestId("theme-option-birthday")).toHaveAttribute("aria-checked", "true");
    await saved;
    // Tapping a seal brings its world into view.
    await page.getByTestId("theme-option-wedding").tap();
    await expect(page.getByTestId("theme-option-wedding")).toHaveAttribute("aria-checked", "true");
    await expect(gallery.locator('[data-world="wedding"]')).toHaveAttribute("data-selected", "true");
  });

  test("tapping the chosen world plays it again; tapping its seal does not", async ({ page }, testInfo) => {
    await openPicker(page);
    await choose(page, "wedding");
    const mobile = testInfo.project.name === "mobile-emulated";
    const world = mobile ? page.locator('.tp__slide[data-selected] .tw') : page.locator(".tp__stage-frame .tw:not(.tp__stage-world--leaving)");
    // Let the first signature finish.
    await expect(world).toHaveAttribute("data-scene", "rest", { timeout: 10_000 });
    // The seal of the current choice: nothing replays.
    await page.getByTestId("theme-option-wedding").click();
    await expect(world).toHaveAttribute("data-scene", "rest");
    // The world itself: its signature plays again, and the choice is unchanged.
    await (mobile ? page.locator(".tp__slide[data-selected]") : page.locator(".tp__stage-frame")).click();
    await expect(world).toHaveAttribute("data-scene", /pending|playing/);
    await expect(world).toHaveAttribute("data-scene", "rest", { timeout: 10_000 });
    await expect(page.getByTestId("theme-option-wedding")).toHaveAttribute("aria-checked", "true");
  });

  test("every room is generated from its template, with chrome ink for dark rooms", async ({ page }) => {
    await openPicker(page);
    await expect(page.getByTestId("theme-step")).toHaveAttribute("data-room", "light");
    await choose(page, "celebration");
    await expect(page.getByTestId("theme-step")).toHaveAttribute("data-room", "dark");
    const room = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--room").trim());
    expect(room).toBe("#0b0e27");
  });

  test("reduced motion: worlds are shown at rest and choosing still works", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPicker(page);
    await choose(page, "romantic");
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    expect(running).toBe(0);
  });
});

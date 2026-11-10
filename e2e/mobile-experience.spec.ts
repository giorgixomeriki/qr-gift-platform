import { test, expect, type Page } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * Mobile regressions found in the Mobile Experience pass — each one a thing a
 * real phone did wrong, asserted on behaviour rather than pixels (no frame
 * of an animation is compared). Browser emulation is not a substitute for
 * the real-device checklist (docs/MOBILE_QA_CHECKLIST.md).
 */

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function freshCard() {
  const qr = await createAvailableQr();
  cleanups.push(qr.cleanup);
  return qr.publicToken;
}

async function toMessage(page: Page, token: string) {
  await page.goto(`/g/${token}`);
  await page.getByTestId("start-greeting-button").click();
  await expect(page.getByTestId("theme-step")).toBeVisible();
  await page.getByTestId("wizard-continue").click();
  await expect(page.getByTestId("message-textarea")).toBeVisible();
}

/** To the Preview screen (Signature): message and media are one Create step. */
async function toPreviewScreen(page: Page, token: string) {
  await toMessage(page, token);
  await page.getByTestId("message-textarea").fill("Happy birthday, dear friend!");
  await page.getByTestId("wizard-continue").click();
  await expect(page.getByTestId("preview-step")).toBeVisible();
}

/** Into the recipient's view of the preview (the real renderer). */
async function toPreview(page: Page, token: string) {
  await toPreviewScreen(page, token);
  await page.getByTestId("preview-watch").click();
  await expect(page.getByTestId("greeting-tap-to-open")).toBeVisible();
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const UPLOAD = "**/storage/v1/object/upload/sign/**";
const pickPhoto = (page: Page, name = "p.png") => page.getByTestId("media-input-photo").setInputFiles({ name, mimeType: "image/png", buffer: PNG });

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("Mobile experience", () => {
  test("no horizontal scroll on any sender screen at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const token = await freshCard();
    await page.goto(`/g/${token}`);
    await expect(page.getByTestId("sender-entry")).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    await page.getByTestId("start-greeting-button").click();
    await expect(page.getByTestId("theme-step")).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("message-textarea").fill("ძვირფასო ანა, გილოცავ დაბადების დღეს! ".repeat(10));
    await expect(page.getByTestId("media-step")).toBeVisible();
    await page.getByTestId("add-audio").click(); // the voice panel open, too
    expect(await horizontalOverflow(page)).toBe(0);
    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("preview-step")).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    await page.getByTestId("preview-watch").click();
    await expect(page.getByTestId("greeting-tap-to-open")).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("wizard steps are history entries: Back returns to the previous step", async ({ page }) => {
    const token = await freshCard();
    await toMessage(page, token);
    await expect(page).toHaveURL(/step=create/);
    await page.goBack();
    await expect(page.getByTestId("theme-step")).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId("message-textarea")).toBeVisible();
  });

  test("a typed message survives the tab being reloaded before it was saved", async ({ page }) => {
    const token = await freshCard();
    await toMessage(page, token);
    await page.getByTestId("message-textarea").fill("Typed while switching apps");
    await page.reload();
    await expect(page.getByTestId("message-textarea")).toHaveValue("Typed while switching apps");
  });

  test("words typed before the page has loaded are kept", async ({ page }) => {
    const token = await freshCard();
    await toMessage(page, token);
    // A slow phone: the letter is on screen seconds before the scripts arrive.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/_next/static/chunks/**", async (route) => {
      await held;
      await route.continue().catch(() => {});
    });
    await page.goto(`/g/${token}?step=create`, { waitUntil: "commit" });
    await page.getByTestId("message-textarea").fill("Typed before it loaded");
    release();
    await expect(page.getByTestId("media-step")).toBeVisible();
    await page.waitForTimeout(1500); // hydration, and any re-render after it
    await page.getByTestId("add-audio").click(); // a state change re-renders the field
    await expect(page.getByTestId("message-textarea")).toHaveValue("Typed before it loaded");
  });

  test("a second tap on Open does not skip the message", async ({ page }) => {
    const token = await freshCard();
    await toPreview(page, token);
    const open = page.getByTestId("greeting-tap-to-open");
    const box = (await open.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6);
    await page.waitForTimeout(250);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("greeting-renderer")).toHaveAttribute("data-beat", "message");
  });

  test("the ending's controls arrive once the finale is at rest", async ({ page }) => {
    const token = await freshCard();
    await toPreview(page, token);
    await page.getByTestId("greeting-tap-to-open").click();
    await page.getByTestId("greeting-continue").click();
    await expect(page.getByTestId("greeting-ending-beat")).toBeVisible();
    await expect(page.getByTestId("greeting-replay")).toBeVisible({ timeout: 15_000 });
    const scene = await page.locator('[data-testid="greeting-ending-beat"] .tw').getAttribute("data-scene");
    expect(scene === null || scene === "rest").toBe(true);
  });

  test("landscape phone: the reveal's actions stay on screen", async ({ page }) => {
    await page.setViewportSize({ width: 740, height: 340 });
    const token = await freshCard();
    await toPreview(page, token);
    const open = (await page.getByTestId("greeting-tap-to-open").boundingBox())!;
    expect(open.y + open.height).toBeLessThanOrEqual(340);
    await page.getByTestId("greeting-tap-to-open").click();
    const next = page.getByTestId("greeting-continue");
    await expect(next).toBeVisible();
    const box = (await next.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(340);
  });

  test("a failed upload keeps the photo and retries in one tap", async ({ page }) => {
    const token = await freshCard();
    await toMessage(page, token);
    let fail = true;
    await page.route(UPLOAD, (route) => (fail ? route.abort("connectionreset") : route.continue()));
    await pickPhoto(page);
    await expect(page.getByTestId("media-retry-photo-0")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("media-error-photo-0")).toBeVisible();
    // Continue is refused with the reason while a file has failed.
    await page.getByTestId("message-textarea").fill("Upload check");
    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("failed-block")).toBeVisible();
    fail = false;
    await page.getByTestId("media-retry-photo-0").click();
    await expect(page.getByTestId("media-ready-photo-0")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("failed-block")).toBeHidden();
  });

  test.describe("attachments (Signature list)", () => {
    test("cancelling an upload, or reloading during one, saves nothing", async ({ page }) => {
      const token = await freshCard();
      await toMessage(page, token);
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      await page.route(UPLOAD, async (route) => {
        if (route.request().method() === "PUT") await held;
        await route.continue().catch(() => {});
      });
      await pickPhoto(page, "a.png");
      await expect(page.getByTestId("media-cancel-photo-0")).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("media-cancel-photo-0").click();
      await expect(page.getByTestId("media-row-photo-0")).toHaveCount(0);
      await pickPhoto(page, "b.png");
      await expect(page.getByTestId("media-cancel-photo-0")).toBeVisible({ timeout: 20_000 });
      await page.reload();
      await expect(page.getByTestId("media-step")).toBeVisible();
      await expect(page.getByTestId("media-row-photo-0")).toHaveCount(0);
      release();
    });

    test("Continue waits for an upload still running, then goes on by itself", async ({ page }) => {
      const token = await freshCard();
      await toMessage(page, token);
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      await page.route(UPLOAD, async (route) => {
        if (route.request().method() === "PUT") await held;
        await route.continue().catch(() => {});
      });
      await page.getByTestId("message-textarea").fill("Waiting for a photo");
      await pickPhoto(page);
      await expect(page.getByTestId("media-cancel-photo-0")).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("wizard-continue").click();
      await expect(page.getByTestId("wizard-continue")).toHaveAttribute("aria-busy", "true");
      await expect(page.getByTestId("create-step")).toBeVisible();
      release();
      await expect(page.getByTestId("preview-step")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("preview-contents")).toContainText(/1 photo/);
    });

    test("Remove can be undone; a removal is committed before Preview", async ({ page }) => {
      const token = await freshCard();
      await toMessage(page, token);
      await pickPhoto(page);
      await expect(page.getByTestId("media-ready-photo-0")).toBeVisible({ timeout: 20_000 });
      // Remove → Undo restores it, and it's still saved after a reload.
      await page.getByTestId("media-remove-photo-0").click();
      await page.getByTestId("media-undo-photo-0").click();
      await expect(page.getByTestId("media-ready-photo-0")).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("media-ready-photo-0")).toBeVisible();
      // Remove, then go straight on: Preview doesn't hold it, and neither does the draft.
      await page.getByTestId("message-textarea").fill("Without the photo");
      await page.getByTestId("media-remove-photo-0").click();
      await page.getByTestId("wizard-continue").click();
      await expect(page.getByTestId("preview-step")).toBeVisible();
      await expect(page.getByTestId("preview-contents")).not.toContainText(/photo/);
      await page.goto(`/g/${token}?step=create`);
      await expect(page.getByTestId("media-step")).toBeVisible();
      await expect(page.getByTestId("media-row-photo-0")).toHaveCount(0);
    });

    test("old step links (?step=message, ?step=media) open the Create screen with the saved draft", async ({ page }) => {
      const token = await freshCard();
      await toMessage(page, token);
      await page.getByTestId("message-textarea").fill("Saved before the link");
      await page.getByTestId("wizard-continue").click();
      await expect(page.getByTestId("preview-step")).toBeVisible();
      for (const step of ["message", "media"]) {
        await page.goto(`/g/${token}?step=${step}`);
        await expect(page.getByTestId("create-step")).toBeVisible();
        await expect(page.getByTestId("message-textarea")).toHaveValue("Saved before the link");
      }
    });
  });

  // Safari paints the lines a line-clamp hides; a colour emoji on hidden line 3
  // rose into view under line 2 (and line 1's emoji was cropped at the top).
  // WebKit-only, so this launches WebKit itself; skipped where it isn't installed.
  test("checkout message snippet: hidden lines never show (WebKit)", async ({ playwright, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "launches its own WebKit once");
    const browser = await playwright.webkit.launch().catch(() => null);
    test.skip(!browser, "WebKit is not installed");
    const context = await browser!.newContext({ baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: "en-US" });
    const page = await context.newPage();
    try {
      const token = await freshCard();
      await toPreviewScreen(page, token);
      await page.getByTestId("preview-activate-cta").click();
      await expect(page.getByTestId("checkout-pay")).toBeVisible();
      const snippet = page.locator('section[aria-labelledby="checkout-summary"] .sig-order__msg');
      const messages = [
        "Happy birthday 🎉 to the kindest 🎂 friend 🎁 — wishing you light 🌟 and laughter 😂 and a year 💐 full of 🥂 good surprises 🎈🎈 and love ❤️",
        "გილოცავ 🎉 დაბადების დღეს 🎂 ჩემო ძვირფასო 🎁 — გისურვებ სინათლეს 🌟 და სიცილს 😂 და წელს 💐 სავსე 🥂 სიურპრიზებით 🎈🎈",
      ];
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        for (const message of messages) {
          await snippet.evaluate((el, m) => (el.textContent = m), message);
          await page.evaluate(() => document.fonts.ready);
          const shown = await snippet.screenshot();
          // Same text and layout, with the hidden lines simply not painted.
          const split = await snippet.evaluate((el) => {
            const node = el.firstChild!;
            const text = node.textContent!;
            const top = el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop);
            const lh = parseFloat(getComputedStyle(el).lineHeight);
            const range = document.createRange();
            for (let i = 0; i < text.length; i++) {
              range.setStart(node, i);
              range.setEnd(node, i + 1);
              const rect = range.getClientRects()[0];
              if (rect && rect.top - top >= 2 * lh - 2) {
                el.textContent = text.slice(0, i);
                const hidden = document.createElement("span");
                hidden.style.visibility = "hidden";
                hidden.textContent = text.slice(i);
                el.append(hidden);
                return true;
              }
            }
            return false;
          });
          expect(split, `message overflows two lines at ${width}px`).toBe(true);
          expect((await snippet.screenshot()).equals(shown), `hidden line painted at ${width}px`).toBe(true);
        }
      }
    } finally {
      await browser!.close();
    }
  });

  test("touch targets on the checkout are at least 44px tall", async ({ page }) => {
    const token = await freshCard();
    await toPreviewScreen(page, token);
    await page.getByTestId("preview-activate-cta").click();
    await expect(page.getByTestId("checkout-pay")).toBeVisible();
    const short = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-testid=checkout-step] button, [data-testid=checkout-step] summary")]
        // Rendered, interactive controls only (a closed <details> keeps its contents laid out but hidden).
        .filter((el) => el.checkVisibility() && el.getBoundingClientRect().height > 0)
        .map((el) => {
          const before = getComputedStyle(el, "::before");
          const h = Math.max(el.getBoundingClientRect().height, before.position === "absolute" ? parseFloat(before.height) || 0 : 0);
          return { id: el.dataset.testid ?? el.textContent?.trim(), h };
        })
        .filter((t) => t.h < 43.5),
    );
    expect(short).toEqual([]);
  });
});

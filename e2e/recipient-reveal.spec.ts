import { test, expect, type Page } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * The reveal is told inside the chosen world (GreetingRenderer): sealed →
 * the world's scene with the sender's message on its card → (a long message)
 * the whole letter in the world's paper. Driven through Preview, which runs
 * the same renderer the recipient gets (greeting-flow.spec.ts covers the
 * activated recipient page itself). Behaviour only, no pixels.
 */
test.use({ locale: "en-US" });
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
});

let cleanup: (() => Promise<void>) | null = null;
test.afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

const SHORT = "Happy birthday, Nino. I'm so proud of you.";
const LONG =
  "Nino,\n\nI wanted to write this down instead of just saying it. This year you changed jobs, moved across the city and still found time for everyone around you. I don't think you noticed how much you carried — I did.\n\nThank you for the late calls, the soup when I was sick, and for laughing at my terrible jokes.\n\nWith all my love, Giorgi";

async function openPreview(page: Page, theme: string, message: string) {
  const qr = await createAvailableQr();
  cleanup = qr.cleanup;
  await page.goto(`/g/${qr.publicToken}`);
  await page.getByTestId("start-greeting-button").click();
  await expect(page.getByTestId("theme-step")).toBeVisible();
  if (theme !== "minimal") {
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/g/"));
    await page.getByTestId(`theme-option-${theme}`).click();
    await saved;
  }
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("message-textarea").fill(message);
  await page.getByTestId("wizard-continue").click();
  await expect(page.getByTestId("media-step")).toBeVisible();
  await page.getByTestId("wizard-continue").click();
  await expect(page.getByTestId("greeting-renderer")).toBeVisible();
}

/** Continue from the message to the ending, where the world closes with its finale. */
async function toEnding(page: Page) {
  await page.getByTestId("greeting-tap-to-open").click();
  await expect(page.getByTestId("greeting-message-beat")).toBeVisible();
  await page.getByTestId("greeting-continue").click();
  const ending = page.getByTestId("greeting-ending-beat");
  await expect(ending).toBeVisible();
  return ending;
}

/**
 * Each world closes its own way (lib/templates/vocabulary.ts FINALES). Every
 * check reads the world's finished state — something only that finale does.
 */
const FINALE_CASES: { theme: string; finale: string; closed: (page: Page) => Promise<void> }[] = [
  {
    theme: "romantic",
    finale: "evening-falls",
    closed: async (page) => {
      const dusk = await page.locator('[data-testid="greeting-ending-beat"] .tw__dusk').evaluate((e) => Number(getComputedStyle(e).opacity));
      expect(dusk).toBeGreaterThan(0.5); // the room has fallen to dusk
    },
  },
  {
    theme: "birthday",
    finale: "paper-encore",
    closed: async (page) => {
      await expect(page.locator('[data-testid="greeting-ending-beat"] .tw-finale--rosette')).toBeVisible();
    },
  },
  {
    theme: "wedding",
    finale: "vellum-close",
    closed: async (page) => {
      await expect(page.locator('[data-testid="greeting-ending-beat"] .tw__veil')).toBeVisible(); // drawn back over the card
    },
  },
  {
    theme: "celebration",
    finale: "afterglow",
    closed: async (page) => {
      const glow = await page.locator('[data-testid="greeting-ending-beat"] .tw__flash').evaluate((e) => Number(getComputedStyle(e).opacity));
      expect(glow).toBeGreaterThan(0.3);
      // The closing word is fitted, never broken: one line.
      const lines = await page.locator('[data-testid="greeting-ending-beat"] .tw__opening').evaluate((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));
      expect(lines).toBe(1);
    },
  },
  {
    theme: "elegant",
    finale: "gallery-doors",
    closed: async (page) => {
      const beat = page.getByTestId("greeting-ending-beat");
      const [door, card, other] = await Promise.all([
        beat.locator(".tw__shutter--l").boundingBox(),
        beat.locator(".tw__card").boundingBox(),
        beat.locator(".tw__shutter--r").boundingBox(),
      ]);
      // The doors stand at the card's edges, the card open between them.
      expect(door!.x + door!.width).toBeLessThanOrEqual(card!.x + 1);
      expect(other!.x).toBeGreaterThanOrEqual(card!.x + card!.width - 1);
    },
  },
  {
    theme: "minimal",
    finale: "full-stop",
    closed: async (page) => {
      const beat = page.getByTestId("greeting-ending-beat");
      expect(await beat.locator(".tw__hairline").evaluate((e) => Number(getComputedStyle(e).opacity))).toBe(0);
      // The point has travelled to the end of the message.
      const [point, message] = await Promise.all([beat.locator(".tw__point").boundingBox(), beat.locator(".tw__message").boundingBox()]);
      expect(point!.x).toBeGreaterThan(message!.x + message!.width * 0.3);
    },
  },
];

test.describe("Recipient reveal", () => {
  for (const c of FINALE_CASES) {
    test(`${c.theme} closes with its own finale (${c.finale})`, async ({ page }) => {
      await openPreview(page, c.theme, SHORT);
      const ending = await toEnding(page);
      await expect(ending).toHaveAttribute("data-finale", c.finale);
      const world = ending.locator(".tw");
      await expect(world).toHaveAttribute("data-finale", c.finale);
      await expect(world).toHaveAttribute("data-scene", "rest", { timeout: 12_000 });
      await c.closed(page);
      // The sender's own words are still on the card, inside the same world.
      await expect(world.locator(".tw__message")).toHaveText(SHORT);
      await expect(page.getByTestId("greeting-replay")).toBeVisible();
    });
  }

  test("reduced motion: a finale shows its ending at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPreview(page, "wedding", LONG);
    const ending = await toEnding(page);
    await expect(ending.locator(".tw__veil")).toBeVisible({ timeout: 2_000 });
    await expect(ending.locator(".tw")).not.toHaveAttribute("data-scene", /pending|playing/);
  });

  test("opens in the chosen world: sealed, then its scene with the sender's own words", async ({ page }) => {
    await openPreview(page, "wedding", SHORT);
    const reveal = page.getByTestId("greeting-renderer");
    await expect(reveal).toHaveAttribute("data-composition", "vellum");
    await expect(reveal).toHaveAttribute("data-stage", "closed");
    await expect(reveal.locator(".tw[data-sealed]")).toHaveCount(1);
    await expect(reveal).toContainText("A few words for your big day"); // the template's opening line, as real text

    await page.getByTestId("greeting-tap-to-open").click();
    const beat = page.getByTestId("greeting-message-beat");
    await expect(beat).toBeVisible();
    await expect(beat.locator(".tw__message")).toHaveText(SHORT);
    await expect(beat.locator(".tw")).toHaveAttribute("data-scene", "rest", { timeout: 12_000 });
    // It fits the card: no letter, and the words are there for screen readers.
    await expect(page.getByTestId("greeting-letter")).toHaveCount(0);
    await expect(beat.locator(".sr-only")).toHaveText(SHORT);
  });

  test("a message longer than the card arrives as a letter once the scene is at rest", async ({ page }) => {
    await openPreview(page, "birthday", LONG);
    await page.getByTestId("greeting-tap-to-open").click();
    const beat = page.getByTestId("greeting-message-beat");
    await expect(beat.locator(".tw")).toHaveAttribute("data-overflow", "");
    const letter = page.getByTestId("greeting-letter");
    await expect(letter).toBeVisible({ timeout: 12_000 });
    await expect(letter).toContainText("With all my love, Giorgi");
    await page.getByTestId("greeting-continue").click();
    await expect(page.getByTestId("greeting-ending-beat")).toBeVisible();
  });

  test("reduced motion: no scene, the letter still arrives and the story continues", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPreview(page, "elegant", LONG);
    await page.getByTestId("greeting-tap-to-open").click();
    await expect(page.getByTestId("greeting-letter")).toBeVisible({ timeout: 3_000 });
    await page.getByTestId("greeting-continue").click();
    await expect(page.getByTestId("greeting-ending-beat")).toBeVisible();
    await expect(page.getByTestId("greeting-replay")).toBeVisible();
  });
});

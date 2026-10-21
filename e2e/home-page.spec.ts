import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { formatMinorAmount } from "../src/lib/format/money";
import { DEFAULT_PRODUCT_KEY } from "../src/lib/greetings/constants";

/**
 * The public home page (src/app/page.tsx, components/site/home): its copy in
 * both languages, the price from the pricing data, the partner routes, the
 * "after the scan" demo's tab behaviour, and layout at the narrowest phone.
 * Footer links on the home page: site-pages.spec.ts.
 */
type Locale = "ka" | "en";
const landing = (locale: Locale) => JSON.parse(readFileSync(join(__dirname, `../src/messages/site/${locale}.json`), "utf8")).landing;

async function useLocale(context: BrowserContext, locale: Locale) {
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://localhost:3000" }]);
}

for (const locale of ["ka", "en"] as const) {
  test(`the home page tells the story in ${locale}, with one h1 and no raw placeholders`, async ({ page, context }) => {
    await useLocale(context, locale);
    const copy = landing(locale);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page).toHaveTitle(copy.metaTitle);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", copy.metaDescription);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText(copy.hero.titleB);
    // Someone holding a card who typed the address is told to scan it instead.
    await expect(page.getByTestId("home-recipient-hint")).toHaveText(copy.hero.recipientHint);
    for (const title of [copy.demo.title, copy.steps.title, copy.experiences.title, copy.occasions.title, copy.partners.title, copy.pricing.title, copy.trust.title, copy.finale.title]) {
      await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    }
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\{\{|\}\}|undefined|NaN/);
    expect(text).not.toMatch(/commission|partner share|payout|საკომისიო/i);
  });
}

test.describe("home page price", () => {
  const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });
  test.afterAll(async () => sql.end());

  test("shows the standard price from the pricing data, as the pricing page does", async ({ page, context }) => {
    await useLocale(context, "en");
    const [row] = await sql<{ amount_minor: number; currency: string }[]>`
      select pr.amount_minor, pr.currency from prices pr join products p on p.id = pr.product_id
      where p.key = ${DEFAULT_PRODUCT_KEY} and p.active and pr.active and pr.partner_id is null`;
    await page.goto("/");
    await expect(page.getByTestId("home-price").locator("[data-price]")).toHaveText(formatMinorAmount(row!.amount_minor, row!.currency, "en"));
  });
});

test("partners can reach contact and sign in from the home page", async ({ page, context }) => {
  await useLocale(context, "en");
  await page.goto("/");
  await expect(page.getByTestId("home-partner-contact")).toHaveAttribute("href", "/contact");
  await expect(page.getByTestId("home-partner-login")).toHaveAttribute("href", "/partner/login");
  await page.getByTestId("home-partner-login").click();
  await expect(page).toHaveURL(/\/partner\/login$/);
});

test("the after-the-scan demo is a keyboard-operable tab list", async ({ page, context }) => {
  await useLocale(context, "en");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const first = page.getByTestId("demo-beat-0");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("demo-beat-1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("demo-beat-1")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByTestId("demo-beat-3")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("demo-beat-0")).toHaveAttribute("aria-selected", "true");
  // Reduced motion: it never advances on its own.
  await page.waitForTimeout(6000);
  await expect(page.getByTestId("demo-beat-0")).toHaveAttribute("aria-selected", "true");
});

for (const width of [320, 375]) {
  test(`no horizontal overflow at ${width}px in Georgian`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 740 } });
    await useLocale(context, "ka");
    const page = await context.newPage();
    await page.goto("/");
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
    await context.close();
  });
}

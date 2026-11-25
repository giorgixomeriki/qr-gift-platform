import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { createAvailableQr } from "./fixtures";
import { formatMinorAmount } from "../src/lib/format/money";
import { SITE_PAGES } from "../src/lib/site/routes";
import { DEFAULT_PRODUCT_KEY } from "../src/lib/greetings/constants";

/**
 * The public information pages: both languages, the footer, the mobile menu,
 * the pricing page against the pricing data, and the "not yet published"
 * state when no merchant details are configured (the default e2e server has
 * none). Run with MERCHANT_PROFILE=demo to test the fictional demo profile.
 * Static checks of the copy itself: scripts/verify-site-content.ts.
 */
type Locale = "ka" | "en";
const messages: Record<Locale, Record<string, Record<string, unknown>>> = {
  ka: JSON.parse(readFileSync(join(__dirname, "../src/messages/site/ka.json"), "utf8")),
  en: JSON.parse(readFileSync(join(__dirname, "../src/messages/site/en.json"), "utf8")),
};
const NAMESPACE: Record<string, string> = { about: "about", howItWorks: "service", pricing: "pricing", contact: "contact", terms: "terms", privacy: "privacy", refunds: "refunds" };
const msg = (locale: Locale, ns: string, key: string) => messages[locale][ns]![key] as string;
const nav = (locale: Locale, key: string) => (messages[locale].site!.nav as Record<string, string>)[key]!;
const siteText = (locale: Locale, group: "status" | "footer", key: string) => (messages[locale].site![group] as Record<string, string>)[key]!;

async function useLocale(context: BrowserContext, locale: Locale) {
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://localhost:3000" }]);
}

async function expectNoRawPlaceholders(page: Page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\{\{|\}\}|\[\[|\]\]|undefined|NaN/);
}

/** The server under test inherits this process's environment (playwright.config.ts webServer). */
const demoMode = process.env.MERCHANT_PROFILE === "demo";
const merchantConfigured = !!process.env.MERCHANT_SUPPORT_EMAIL || demoMode;

for (const locale of ["ka", "en"] as const) {
  test.describe(`information pages (${locale})`, () => {
    test.beforeEach(async ({ context }) => useLocale(context, locale));

    for (const p of SITE_PAGES) {
      test(`${p.href} renders its ${locale} copy with header, footer and metadata`, async ({ page }) => {
        const ns = NAMESPACE[p.key]!;
        const response = await page.goto(p.href);
        expect(response?.status()).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg(locale, ns, "title"));
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page).toHaveTitle(new RegExp(`^${msg(locale, ns, "metaTitle").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · QR Starr$`));
        await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", msg(locale, ns, "metaDescription"));
        await expect(page.getByRole("main")).toBeVisible();
        await expect(page.getByTestId("site-footer")).toBeVisible();
        // Every section of the copy is on the page.
        const sections = messages[locale][ns]!.sections as { id: string; title: string }[];
        for (const s of sections) await expect(page.locator(`section#${s.id} h2`)).toContainText(s.title);
        await expectNoRawPlaceholders(page);
      });
    }

    test("the home page carries the site footer with every information page", async ({ page }) => {
      await page.goto("/");
      const footer = page.getByTestId("site-footer");
      for (const p of SITE_PAGES) {
        const link = footer.getByTestId(`footer-link-${p.key}`);
        await expect(link).toHaveText(nav(locale, p.key));
        await expect(link).toHaveAttribute("href", p.href);
      }
    });
  });
}

test.describe("footer navigation", () => {
  test.beforeEach(async ({ context }) => useLocale(context, "en"));

  test("every footer link opens its page, from the home page and from an information page", async ({ page }) => {
    for (const start of ["/", "/terms"]) {
      for (const p of SITE_PAGES) {
        await page.goto(start);
        await page.getByTestId(`footer-link-${p.key}`).click();
        await expect(page).toHaveURL(new RegExp(`${p.href}$`));
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg("en", NAMESPACE[p.key]!, "title"));
      }
    }
  });

  test("the header language switcher changes an information page's language", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg("en", "privacy", "title"));
    await page.getByTestId("locale-ka").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg("ka", "privacy", "title"));
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg("ka", "privacy", "title"));
  });
});

test.describe("navigation by viewport", () => {
  test.beforeEach(async ({ context }) => useLocale(context, "en"));

  test("mobile: the menu opens, lists every page, closes on Escape, and navigates", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile viewport only");
    await page.goto("/about");
    const button = page.getByTestId("mobile-menu-button");
    const menu = page.getByTestId("mobile-menu");
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
    await expect(page.getByRole("navigation", { name: nav("en", "primaryLabel") })).toBeHidden();

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();
    for (const p of SITE_PAGES) await expect(menu.getByRole("link", { name: nav("en", p.key), exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: nav("en", "about"), exact: true })).toHaveAttribute("aria-current", "page");

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await menu.getByRole("link", { name: nav("en", "pricing"), exact: true }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(menu).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg("en", "pricing", "title"));
  });

  test("desktop: header links are visible and the menu button is not", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop viewport only");
    await page.goto("/about");
    await expect(page.getByTestId("mobile-menu-button")).toBeHidden();
    const header = page.getByRole("navigation", { name: nav("en", "primaryLabel") });
    for (const p of SITE_PAGES.filter((x) => x.primary)) await expect(header.getByRole("link", { name: nav("en", p.key), exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: nav("en", "about"), exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("keyboard: the skip link is the first stop and moves focus to the content", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard flow checked on desktop");
    await page.goto("/terms");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: nav("en", "skipToContent") });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });
});

test.describe("pricing", () => {
  const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });
  let qr: Awaited<ReturnType<typeof createAvailableQr>>;
  let standard: { amount_minor: number; currency: string };

  test.beforeAll(async () => {
    const rows = await sql<{ amount_minor: number; currency: string }[]>`
      select pr.amount_minor, pr.currency from prices pr join products p on p.id = pr.product_id
      where p.key = ${DEFAULT_PRODUCT_KEY} and p.active and pr.active and pr.partner_id is null`;
    expect(rows, "exactly one active platform-default price (seeded)").toHaveLength(1);
    standard = rows[0]!;
    qr = await createAvailableQr();
  });
  test.afterAll(async () => {
    await qr?.cleanup();
    await sql.end();
  });

  for (const locale of ["ka", "en"] as const) {
    test(`the pricing page shows the configured price, the same as a card's start screen (${locale})`, async ({ page, context }) => {
      await useLocale(context, locale);
      const expected = formatMinorAmount(standard.amount_minor, standard.currency, locale);
      await page.goto("/pricing");
      await expect(page.getByTestId("price-card").locator("[data-price]")).toHaveText(expected);
      await page.goto(`/g/${qr.publicToken}`);
      await expect(page.getByTestId("sender-entry")).toContainText(expected);
    });
  }

  test("the pricing page exposes no commission or partner share", async ({ page, context }) => {
    await useLocale(context, "en");
    await page.goto("/pricing");
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/commission|%|partner share|payout/i);
  });

  test("a price change in the pricing data shows on the pricing page", async ({ page, context }) => {
    await useLocale(context, "en");
    const [row] = await sql<{ id: string }[]>`
      select pr.id from prices pr join products p on p.id = pr.product_id
      where p.key = ${DEFAULT_PRODUCT_KEY} and pr.active and pr.partner_id is null`;
    await sql`update prices set amount_minor = ${standard.amount_minor + 250} where id = ${row!.id}`;
    try {
      await page.goto("/pricing");
      await expect(page.getByTestId("price-card").locator("[data-price]")).toHaveText(formatMinorAmount(standard.amount_minor + 250, standard.currency, "en"));
    } finally {
      await sql`update prices set amount_minor = ${standard.amount_minor} where id = ${row!.id}`;
    }
  });
});

test.describe("missing merchant information", () => {
  test.skip(merchantConfigured, "the server under test has merchant details configured");
  test.beforeEach(async ({ context }) => useLocale(context, "en"));

  test("the contact page marks every required detail as not yet published, and shows no invented values", async ({ page }) => {
    await page.goto("/contact");
    const details = page.getByTestId("merchant-details");
    for (const field of ["legalNameEn", "entityType", "idCode", "legalAddressEn", "supportEmail", "phone"]) {
      await expect(details.locator(`[data-pending="${field}"]`)).toHaveText(siteText("en", "status", "pending"));
    }
    await expect(page.locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
    await expect(page.getByTestId("draft-banner")).toBeVisible();
  });

  test("the footer says the details are being finalised, instead of showing markers", async ({ page }) => {
    await page.goto("/about");
    const footer = page.getByTestId("site-footer");
    await expect(footer.locator('[data-pending="merchant-details"]')).toContainText(siteText("en", "footer", "merchantPending"));
    await expect(footer.getByTestId("merchant-details")).toHaveCount(0);
  });

  test("policies are shown as drafts, not in effect, with their review markers visible", async ({ page }) => {
    for (const path of ["/terms", "/privacy", "/delivery-and-refunds"]) {
      await page.goto(path);
      await expect(page.getByTestId("draft-banner")).toBeVisible();
      await expect(page.getByText(siteText("en", "status", "notYetEffective"), { exact: true })).toBeVisible();
      expect(await page.locator('[data-marker="review"], [data-marker="decision"]').count()).toBeGreaterThan(0);
    }
  });
});

test.describe("demo merchant profile (MERCHANT_PROFILE=demo)", () => {
  test.skip(!demoMode, "run the suite with MERCHANT_PROFILE=demo to cover the demo profile");
  const DEMO = {
    name: { ka: "შპს ქიუარ სტარ დემო", en: "QR Starr Demo LLC" },
    address: { ka: "საქართველო, თბილისი, დემო ქუჩა №1", en: "1 Demo Street, Tbilisi, Georgia" },
    hours: { ka: "ორშაბათი–პარასკევი, 10:00–18:00", en: "Monday–Friday, 10:00–18:00" },
    email: "demo@example.com",
    privacyEmail: "privacy@example.com",
    phone: "+995 555 00 00 00",
    idCode: "000000000",
  };
  const NOTICE = "DEMO / სატესტო მონაცემები";

  for (const locale of ["ka", "en"] as const) {
    test.describe(locale, () => {
      test.beforeEach(async ({ context }) => useLocale(context, locale));

      test("every information page carries the demo notice, and every fictional value is tagged", async ({ page }) => {
        for (const p of SITE_PAGES) {
          await page.goto(p.href);
          await expect(page.getByTestId("demo-ribbon")).toContainText(NOTICE);
          await expect(page.getByTestId("site-footer").getByTestId("demo-notice")).toContainText(NOTICE);
          const values = page.locator("[data-merchant]");
          const tagged = page.locator("[data-merchant]:has([data-demo])");
          expect(await values.count(), `${p.href}: fictional values shown`).toBeGreaterThan(0);
          expect(await tagged.count(), `${p.href}: every fictional value carries a DEMO tag`).toBe(await values.count());
          await expect(page.locator('[data-pending]:not([data-pending="price"])')).toHaveCount(0);
          await expectNoRawPlaceholders(page);
        }
      });

      test("the footer shows the demo company details with working email and phone links", async ({ page }) => {
        await page.goto("/");
        const footer = page.getByTestId("site-footer");
        await expect(footer.getByTestId("demo-notice")).toContainText(NOTICE);
        const details = footer.getByTestId("merchant-details");
        await expect(details).toContainText(DEMO.name[locale]);
        await expect(details).toContainText(DEMO.idCode);
        await expect(details).toContainText(DEMO.address[locale]);
        await expect(details).toContainText(DEMO.hours[locale]);
        await expect(details.locator(`a[href="mailto:${DEMO.email}"]`)).toHaveText(DEMO.email);
        await expect(details.locator('a[href="tel:+995555000000"]')).toHaveText(DEMO.phone);
      });

      test("the contact page lists every demo detail, tagged, with clickable contacts", async ({ page }) => {
        await page.goto("/contact");
        const card = page.locator("main").getByTestId("merchant-details");
        await expect(page.locator("main").getByTestId("demo-notice")).toContainText(NOTICE);
        for (const text of [DEMO.name[locale], DEMO.idCode, DEMO.address[locale], DEMO.hours[locale], DEMO.email, DEMO.phone]) await expect(card).toContainText(text);
        await expect(card).toContainText(locale === "ka" ? "შეზღუდული პასუხისმგებლობის საზოგადოება (შპს)" : "Limited Liability Company (LLC)");
        expect(await card.locator("[data-demo]").count()).toBeGreaterThanOrEqual(7);
        await expect(page.locator(`section#support a[href="mailto:${DEMO.email}"]`)).toBeVisible();
        await expect(page.locator('section#support a[href="tel:+995555000000"]')).toBeVisible();
        await expect(page.locator(`section#privacy-requests a[href="mailto:${DEMO.privacyEmail}"]`)).toHaveText(DEMO.privacyEmail);
      });

      test("demo data never puts the policies into effect: drafts and review markers remain", async ({ page }) => {
        for (const path of ["/terms", "/privacy", "/delivery-and-refunds"]) {
          await page.goto(path);
          await expect(page.getByTestId("draft-banner")).toBeVisible();
          await expect(page.getByText(siteText(locale, "status", "notYetEffective"), { exact: true })).toBeVisible();
          expect(await page.locator('[data-marker="review"]').count()).toBeGreaterThan(0);
          expect(await page.locator('[data-marker="decision"]').count()).toBeGreaterThan(0);
        }
        await page.goto("/terms");
        await expect(page.locator("section#who-we-are")).toContainText(DEMO.name[locale]);
        await expect(page.locator("section#who-we-are [data-demo]").first()).toBeVisible();
      });
    });
  }
});

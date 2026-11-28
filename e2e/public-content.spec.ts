import { test, expect } from "@playwright/test";

/**
 * The public site states only what is confirmed (design-95 OD-17, audit UX-01 /
 * HOME-02): no internal decision or review codes such as "(M1)" or "(D2)", no
 * "not yet published" placeholders, no hand-written count of the designs, and
 * every policy says plainly whether it is in effect. Rendered text, both
 * languages, every public page.
 *
 * Runs against the default merchant profile (no SITE_REVIEW_MARKERS): review
 * mode is an internal tool and is covered by site-pages.spec.ts.
 */
const PAGES = ["/", "/about", "/how-it-works", "/pricing", "/contact", "/terms", "/privacy", "/delivery-and-refunds"];
const POLICIES = ["/terms", "/privacy", "/delivery-and-refunds"];

const INTERNAL = [
  /\((?:M|D|C)\d+\)/, // decision / question references
  /Not yet published/i,
  /Requires legal review/i,
  /Awaiting merchant decision/i,
  /\[\[|\{\{/, // unresolved template syntax
];
const KA_INTERNAL = [/ჯერ არ გამოქვეყნებულა/, /საჭიროებს იურიდიულ შემოწმებას/, /ელოდება კომპანიის გადაწყვეტილებას/];

for (const locale of ["ka", "en"] as const) {
  test.describe(`public content (${locale})`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL! }]);
    });

    for (const path of PAGES) {
      test(`${path} carries no internal notes or placeholders`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const text = await page.locator("body").innerText();
        for (const re of [...INTERNAL, ...(locale === "ka" ? KA_INTERNAL : [])]) expect(text, `${path} shows ${re}`).not.toMatch(re);
        // (The footer's honest "details are being finalised" line is not a placeholder and stays.)
        await expect(page.locator('main :is([data-marker="review"], [data-marker="decision"], [data-pending], [data-testid="draft-banner"])')).toHaveCount(0);
      });
    }

    for (const path of POLICIES) {
      test(`${path} says whether it is in effect`, async ({ page }) => {
        await page.goto(path);
        const text = await page.locator("main").innerText();
        expect(text).toMatch(locale === "en" ? /Not yet in effect|In effect from/ : /ჯერ არ შესულა ძალაში|ძალაში შესვლის თარიღი/);
      });
    }

    test("the home page counts the designs from the catalogue and shows every one", async ({ page }) => {
      await page.goto("/");
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(locale === "en" ? /\bsix\b/i : /ექვს/);
      const tabs = page.locator('[data-testid^="design-tab-"]');
      await expect(tabs).toHaveCount(7);
      await expect(page.getByTestId("design-tab-luxury-vintage")).toBeVisible();
      expect(text).toMatch(/\b7\b/);
    });
  });
}

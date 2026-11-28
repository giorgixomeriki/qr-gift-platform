import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { DEV_PARTNER_EMAIL, DEV_PASSWORD } from "./fixtures";
import { createClient } from "@supabase/supabase-js";
import { createThrowawayAdmin, logIn, signInAdminWithMfa } from "./admin-session";
import { resolveSecretKey } from "../src/lib/supabase/keys";

/**
 * "Where to find QR STARR" (home page) and its admin management.
 *
 * The public tests expect the mock fixtures from
 * `npm run dev:seed-partner-locations` and a server started with
 * PARTNER_MAP_MOCKS=1 (every mock carries a "Test" badge). They skip
 * themselves when the section has no mocks, so the rest of the suite still
 * runs on a stack without them. Visibility rules, RLS and the mock guard are
 * covered exhaustively by `npm run verify:partner-locations`; this proves the
 * screens.
 */
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });

test.afterAll(async () => {
  await sql.end();
});

async function openSection(page: Page, locale: "en" | "ka" = "en") {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: test.info().project.use.baseURL! }]);
  await page.goto("/");
  const section = page.getByTestId("home-locations");
  if ((await section.count()) === 0 || (await page.getByTestId("locations-test-badge").count()) === 0) {
    test.skip(true, "No mock partner locations on this stack (seed + PARTNER_MAP_MOCKS=1)");
  }
  await section.scrollIntoViewIfNeeded();
  return section;
}

test.describe("Partner locations — public", () => {
  test("list, search, filters and directions work without touching the map", async ({ page }) => {
    await openSection(page);
    const items = page.getByTestId("locations-item");
    const total = await items.count();
    expect(total).toBeGreaterThanOrEqual(7);
    // Every mock is labelled as a test location.
    await expect(page.getByTestId("locations-test-badge")).toHaveCount(total);

    await page.getByTestId("locations-search").fill("vake");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Rose Atelier");

    await page.getByTestId("locations-search").fill("Batumi");
    await expect(items).toHaveCount(1);
    await expect(items.first().getByTestId("locations-availability")).toHaveText("Temporarily out of cards");

    await page.getByTestId("locations-search").fill("no such shop anywhere");
    await expect(page.getByTestId("locations-empty")).toBeVisible();
    await page.getByTestId("locations-empty").getByRole("button").click();
    await expect(items).toHaveCount(total);

    await page.getByTestId("locations-filter-GIFTS").click();
    await expect(page.getByTestId("locations-filter-GIFTS")).toHaveAttribute("aria-pressed", "true");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Paper & Gifts");
    await page.getByTestId("locations-filter-ALL").click();

    // Availability is derived from real inventory: only Rose Atelier holds distributed, unsold cards.
    const vake = items.filter({ hasText: "Vake" });
    await expect(vake.getByTestId("locations-availability")).toHaveText("Cards in stock");
    await expect(items.filter({ hasText: "Paper & Gifts" }).first().getByTestId("locations-availability")).toHaveCount(0);

    const directions = vake.getByTestId("locations-directions");
    await expect(directions).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&destination=41.709600,44.763100");
    await expect(directions).toHaveAttribute("target", "_blank");
    await expect(directions).toHaveAttribute("rel", /noopener/);
  });

  test("the map loads lazily and stays in sync with the list", async ({ page }) => {
    await openSection(page);
    await expect(page.locator('.hm-loc__mapbox[data-status="ready"]')).toBeVisible({ timeout: 30_000 });
    const pins = page.getByTestId("locations-pin");
    await expect(pins).toHaveCount(await page.getByTestId("locations-item").count());

    const card = page.getByTestId("locations-item").filter({ hasText: "Kutaisi" });
    await card.getByTestId("locations-show-on-map").click();
    await expect(card).toHaveAttribute("data-selected", "true");
    await expect(page.locator('[data-testid="locations-pin"][aria-pressed="true"]')).toHaveCount(1);

    // Filtering hides pins that are not listed.
    await page.getByTestId("locations-search").fill("Batumi");
    await expect(page.locator('[data-testid="locations-pin"]:not([hidden])')).toHaveCount(1);
    await page.locator('[data-testid="locations-pin"]:not([hidden])').click();
    await expect(page.getByTestId("locations-item").first()).toHaveAttribute("data-selected", "true");

    await expect(page.getByTestId("locations-zoom-in")).toBeVisible();
    await expect(page.getByRole("link", { name: "© OpenStreetMap" })).toBeVisible();
  });

  test("Georgian copy, and no horizontal page overflow", async ({ page }) => {
    await openSection(page, "ka");
    await expect(page.getByRole("heading", { name: "სად ვიპოვო QR STARR?" })).toBeVisible();
    await expect(page.getByTestId("locations-directions").first()).toContainText("მარშრუტი");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Touch targets on the list are at least 44px tall.
    const box = await page.getByTestId("locations-directions").first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("a hidden or unverified real location never appears", async ({ page }) => {
    const slug = `e2e-loc-${crypto.randomUUID().slice(0, 8)}`;
    const [p] = await sql`insert into partners (slug, name) values (${slug}, 'E2E Hidden Partner') returning id`;
    await sql`insert into partner_locations (partner_id, category, address_ka, city_ka, latitude, longitude, is_public, coordinates_verified_at)
              values (${p!.id}, 'GIFTS', 'E2E დამალული მისამართი', 'თბილისი', 41.7, 44.8, false, now()),
                     (${p!.id}, 'GIFTS', 'E2E დაუდასტურებელი', 'თბილისი', 41.7, 44.8, false, null)`;
    try {
      await page.goto("/");
      await expect(page.locator("body")).not.toContainText("E2E Hidden Partner");
    } finally {
      await sql`delete from partner_locations where partner_id = ${p!.id}`;
      await sql`delete from partners where id = ${p!.id}`;
    }
  });
});

test.describe("Partner locations — admin", () => {
  test.use({ locale: "en-US" });

  test("a partner (non-admin) cannot reach location management", async ({ page, baseURL }) => {
    const [p] = await sql`select id from partners limit 1`;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
    await logIn(page, "/partner/login", DEV_PARTNER_EMAIL, DEV_PASSWORD);
    await page.waitForURL(/\/partner/);
    await page.goto(`/admin/partners/${p!.id}`);
    await expect(page.getByTestId("partner-locations-manager")).toHaveCount(0);
  });

  test("an admin adds, verifies, publishes and hides a location", async ({ page, baseURL }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "one admin run is enough");
    test.setTimeout(120_000);
    const slug = `e2e-loc-${crypto.randomUUID().slice(0, 8)}`;
    const name = `E2E Florist ${slug.slice(-4)}`;
    const [p] = await sql`insert into partners (slug, name) values (${slug}, ${name}) returning id`;
    // A throwaway admin: never touches the shared dev admin's MFA factors.
    const admin = await createThrowawayAdmin();
    // The operator's enrollment grant (what scripts/ops/admin-access.ts grant-enrollment
    // writes), applied directly: that tool looks users up in auth.users, which an
    // isolated app database (one DB per worktree on a shared Supabase stack) lacks.
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, resolveSecretKey(process.env)!.key, { auth: { persistSession: false } });
    const { data: users } = await auth.auth.admin.listUsers({ perPage: 1000 });
    const adminUser = users.users.find((u) => u.email === admin.email)!;
    await auth.auth.admin.updateUserById(adminUser.id, { app_metadata: { admin_mfa: { enrollment_until: new Date(Date.now() + 15 * 60_000).toISOString(), factor_ids: [] } } });
    try {
      await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
      await signInAdminWithMfa(page, admin.email, admin.password);
      await page.goto(`/admin/partners/${p!.id}`);
      const manager = page.getByTestId("partner-locations-manager");
      await expect(manager).toBeVisible();
      await expect(page.getByTestId("location-stock-summary")).toContainText("0 distributed");

      await page.getByTestId("location-add").click();
      await page.getByTestId("location-field-branchName").fill("Vake branch");
      await page.getByTestId("location-field-addressKa").fill("ჭავჭავაძის გამზირი 1");
      await page.getByTestId("location-field-addressEn").fill("1 Chavchavadze Ave");
      await page.getByTestId("location-field-coordinates").fill("44.7631, 41.7096"); // swapped on purpose
      await expect(page.getByTestId("location-outside-georgia")).toBeVisible();
      await page.getByTestId("location-field-coordinates").fill("41.7096, 44.7631");
      await expect(page.getByTestId("location-outside-georgia")).toHaveCount(0);
      await page.getByTestId("location-save").click();

      const row = page.getByTestId("location-row");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Hidden");
      await expect(row).toContainText("Pin not verified");
      await expect(row.getByTestId("location-visibility")).toBeDisabled();

      await row.getByTestId("location-verify").click();
      await expect(row).toContainText("Pin verified");
      await row.getByTestId("location-visibility").click();
      await expect(row).toContainText("Public");

      await page.goto("/");
      await expect(page.getByTestId("home-locations")).toContainText(name);

      await page.goto(`/admin/partners/${p!.id}`);
      await page.getByTestId("location-row").getByTestId("location-visibility").click();
      await expect(page.getByTestId("location-row")).toContainText("Hidden");
      await page.goto("/");
      await expect(page.locator("body")).not.toContainText(name);

      const audit = await sql`select action from audit_logs where target_type = 'partner_location' and metadata->>'partnerId' = ${p!.id} order by created_at`;
      expect(audit.map((a) => a.action)).toEqual(["PARTNER_LOCATION_CREATED", "PARTNER_LOCATION_VERIFIED", "PARTNER_LOCATION_PUBLISHED", "PARTNER_LOCATION_HIDDEN"]);
    } finally {
      await sql`delete from audit_logs where target_type = 'partner_location' and metadata->>'partnerId' = ${p!.id}`;
      await sql`delete from partner_locations where partner_id = ${p!.id}`;
      await sql`delete from partners where id = ${p!.id}`;
      await admin.cleanup();
    }
  });
});

import { test, expect, type Page } from "@playwright/test";
import { completeMfaEnrollment, createThrowawayAdmin, enrollDirectlyAgainstSupabase, logIn, operatorGrant, totpCode } from "./admin-session";
import { DEV_PARTNER_EMAIL, DEV_PASSWORD } from "./fixtures";

/** Admin MFA in the browser. The security matrix is scripts/verify-admin-mfa.ts. */
const ADMIN_PAGES = ["/admin/dashboard", "/admin/partners", "/admin/moderation", "/admin/security"];
const anyId = "00000000-0000-4000-8000-000000000000";

async function expectApisRefused(page: Page) {
  expect((await page.request.get(`/api/qr/${anyId}`)).status()).toBe(403);
  expect((await page.request.get(`/api/qr/batches/${anyId}/export`)).status()).toBe(403);
}

test.describe("Admin MFA", () => {
  let account: Awaited<ReturnType<typeof createThrowawayAdmin>>;
  test.beforeEach(async () => {
    account = await createThrowawayAdmin();
  });
  test.afterEach(async () => {
    await account.cleanup();
  });

  test("a password alone is locked out, with no way to add a device", async ({ page }) => {
    await logIn(page, "/admin/login", account.email, account.password);
    await expect(page).toHaveURL(/\/admin\/mfa\/locked/);
    await expect(page.getByTestId("mfa-locked")).toBeVisible();
    await expect(page.getByTestId("mfa-qr")).toHaveCount(0);
    for (const path of [...ADMIN_PAGES, "/admin/mfa", "/admin/mfa/setup"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/admin\/mfa\/locked/);
    }
    await expectApisRefused(page);
  });

  test("a device enrolled directly against Supabase gets nothing", async ({ page }) => {
    await enrollDirectlyAgainstSupabase(account.email, account.password);
    await logIn(page, "/admin/login", account.email, account.password);
    await expect(page).toHaveURL(/\/admin\/mfa\/locked/);
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/admin\/mfa\/locked/);
    }
    await expectApisRefused(page);
  });

  test("granted: enroll, sign out, then a password alone is challenged and a code gets in", async ({ page }) => {
    test.setTimeout(90_000); // two sign-ins and several pages, on a dev server that compiles on first hit
    operatorGrant(account.email);
    await logIn(page, "/admin/login", account.email, account.password);
    await expect(page.getByTestId("mfa-qr")).toBeVisible();
    await expect(page.getByRole("link", { name: "Partners" })).toHaveCount(0); // no navigation yet
    await expectApisRefused(page);
    const secret = await completeMfaEnrollment(page);
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByTestId("admin-dashboard-page")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    await logIn(page, "/admin/login", account.email, account.password);
    await expect(page).toHaveURL(/\/admin\/mfa$/);
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/admin\/mfa$/);
    }
    await expectApisRefused(page);

    await page.getByTestId("mfa-code").fill(totpCode(secret) === "000000" ? "111111" : "000000");
    await page.getByTestId("mfa-submit").click();
    await expect(page.getByTestId("mfa-error")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/mfa$/);

    await page.getByTestId("mfa-code").fill(totpCode(secret));
    await page.getByTestId("mfa-submit").click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    await page.goto("/admin/security");
    await expect(page.getByTestId("mfa-factor")).toHaveCount(1);
    await expect(page.getByTestId("mfa-add-backup")).toBeVisible();
  });
});

test.describe("Admin MFA, other visitors", () => {
  test("a partner never sees the MFA flow or the admin area", async ({ page }) => {
    await logIn(page, "/partner/login", DEV_PARTNER_EMAIL, DEV_PASSWORD);
    await expect(page).toHaveURL(/\/partner\/dashboard/);
    for (const path of ["/admin/mfa/setup", "/admin/mfa/locked", "/admin/mfa"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/admin\/dashboard/);
      await expect(page.getByTestId("admin-dashboard-page")).toHaveCount(0);
      await expect(page.getByTestId("mfa-qr")).toHaveCount(0);
    }
  });

  test("signed out, the MFA pages go to login", async ({ page }) => {
    for (const path of ["/admin/mfa", "/admin/mfa/setup", "/admin/mfa/locked", "/admin/security"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/admin\/login/);
    }
  });
});

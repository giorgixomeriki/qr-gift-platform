import { test, expect } from "@playwright/test";
import { completeMfaEnrollment, resetAdminFactors, totpCode } from "./admin-session";
import { DEV_ADMIN_EMAIL, DEV_PARTNER_EMAIL, DEV_PASSWORD } from "./fixtures";

/** Admin MFA in the browser. The security matrix is scripts/verify-admin-mfa.ts. */
async function logIn(page: import("@playwright/test").Page, path: string, email: string) {
  await page.goto(path);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(DEV_PASSWORD);
  await page.getByTestId("login-submit").click();
}

test.describe("Admin MFA", () => {
  test("enroll, sign out, then a password alone is challenged and a code gets in", async ({ page }) => {
    await resetAdminFactors(DEV_ADMIN_EMAIL);
    await logIn(page, "/admin/login", DEV_ADMIN_EMAIL);
    await expect(page.getByTestId("mfa-qr")).toBeVisible();
    await expect(page.getByRole("link", { name: "Partners" })).toHaveCount(0); // no navigation yet
    const secret = await completeMfaEnrollment(page);
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByTestId("admin-dashboard-page")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    await logIn(page, "/admin/login", DEV_ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/admin\/mfa$/);

    // Going straight to protected pages doesn't help.
    for (const path of ["/admin/dashboard", "/admin/partners", "/admin/moderation", "/admin/security"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/mfa$/);
    }

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

  test("a partner never sees the MFA flow or the admin area", async ({ page }) => {
    await logIn(page, "/partner/login", DEV_PARTNER_EMAIL);
    await expect(page).toHaveURL(/\/partner\/dashboard/);
    await page.goto("/admin/mfa/setup");
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByTestId("admin-dashboard-page")).toHaveCount(0);
    await expect(page.getByTestId("mfa-qr")).toHaveCount(0);
  });

  test("signed out, the MFA pages go to login", async ({ page }) => {
    for (const path of ["/admin/mfa", "/admin/mfa/setup", "/admin/security"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login/);
    }
  });
});

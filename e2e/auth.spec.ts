import { test, expect } from "@playwright/test";
import { DEV_PARTNER_EMAIL, DEV_PASSWORD } from "./fixtures";

/**
 * Requires `npm run db:dev-bootstrap` to have been run once against the
 * local Supabase instance (creates admin@dev.local / partner@dev.local —
 * see README). This suite never creates or deletes Auth users itself.
 */
test.describe("Partner login", () => {
  test("valid credentials sign in and reach the dashboard", async ({ page }) => {
    await page.goto("/partner/login");
    await page.getByTestId("login-email").fill(DEV_PARTNER_EMAIL);
    await page.getByTestId("login-password").fill(DEV_PASSWORD);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/partner\/dashboard/);
  });

  test("invalid credentials show an error and stay on the login page", async ({ page }) => {
    await page.goto("/partner/login");
    await page.getByTestId("login-email").fill(DEV_PARTNER_EMAIL);
    await page.getByTestId("login-password").fill("definitely-wrong-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/partner\/login/);
  });

  test("empty fields are blocked by native validation before submit", async ({ page }) => {
    await page.goto("/partner/login");
    await page.getByTestId("login-submit").click();
    // required + type=email native validation keeps the browser on the same
    // page rather than submitting — no server round-trip, no error banner.
    await expect(page).toHaveURL(/\/partner\/login/);
    await expect(page.getByTestId("login-error")).toHaveCount(0);
  });

  test("email and password inputs have accessible, associated labels", async ({ page }) => {
    await page.goto("/partner/login");
    // getByLabel resolves via the <label htmlFor> association added for F-04 —
    // this fails if the label/input pairing is ever broken.
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  });

  test("the whole form is operable by keyboard alone", async ({ page }) => {
    await page.goto("/partner/login");
    await page.getByTestId("login-email").focus();
    await page.keyboard.type(DEV_PARTNER_EMAIL);
    await page.keyboard.press("Tab");
    await page.keyboard.type(DEV_PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/partner\/dashboard/);
  });

  test("forgot-password link reaches the request form, and submitting shows the generic confirmation", async ({ page }) => {
    await page.goto("/partner/login");
    await page.getByTestId("forgot-password-link").click();
    await expect(page).toHaveURL(/\/partner\/forgot-password/);

    await page.getByTestId("forgot-password-email").fill(DEV_PARTNER_EMAIL);
    await page.getByTestId("forgot-password-submit").click();
    await expect(page.getByTestId("reset-email-sent")).toBeVisible();

    // Same message for a nonexistent email too — no enumeration signal in the UI.
    await page.goto("/partner/forgot-password");
    await page.getByTestId("forgot-password-email").fill("no-such-account@example.test");
    await page.getByTestId("forgot-password-submit").click();
    await expect(page.getByTestId("reset-email-sent")).toBeVisible();
  });

  test("an invalid reset link shows a clear error with a way to request a new one", async ({ page }) => {
    await page.goto("/reset-password?role=partner&error=invalid");
    await expect(page.getByTestId("reset-link-invalid")).toBeVisible();
    await page.getByRole("link", { name: /send reset link/i }).click();
    await expect(page).toHaveURL(/\/partner\/forgot-password/);
  });
});

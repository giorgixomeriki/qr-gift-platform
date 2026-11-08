import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { DEV_ADMIN_EMAIL, DEV_PARTNER_EMAIL, DEV_PASSWORD } from "./fixtures";
import { signInAdminWithMfa } from "./admin-session";

/**
 * Cross-role isolation through the real UI and HTTP surface (added with the
 * Supabase API key migration, which swaps the keys every session and Storage
 * request is built on): signed-out visitors, a partner, and an admin, against
 * a SECOND partner's data that only the admin may see.
 *
 * Needs `npm run db:dev-bootstrap` (admin@dev.local, partner@dev.local).
 */
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });

const ADMIN_PAGES = ["/admin/dashboard", "/admin/partners", "/admin/moderation"];

let other: { partnerId: string; name: string; slug: string; batchId: string; qrId: string; token: string };

test.beforeAll(async () => {
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const qrId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 8);
  other = { partnerId, name: `Isolation Other Partner ${suffix}`, slug: `iso-${suffix}`, batchId, qrId, token: `E2EISO${suffix.toUpperCase()}` };
  await sql`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${other.slug}, ${other.name}, 3000, 'ACTIVE')`;
  await sql`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, ${"iso-batch-" + suffix}, 1)`;
  await sql`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${other.token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
});

test.afterAll(async () => {
  await sql`delete from audit_logs where target_id in (${other.batchId}, ${other.qrId}, ${other.partnerId})`;
  await sql`delete from qr_codes where id = ${other.qrId}`;
  await sql`delete from qr_batches where id = ${other.batchId}`;
  await sql`delete from partners where id = ${other.partnerId}`;
  await sql.end();
});

async function signIn(page: Page, area: "admin" | "partner", email: string) {
  await page.goto(`/${area}/login`);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(DEV_PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(new RegExp(`/${area}/dashboard`));
}

test.describe("Signed out", () => {
  test("dashboards redirect to their login pages and reveal nothing", async ({ page }) => {
    for (const path of [...ADMIN_PAGES, "/partner/dashboard"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(path.startsWith("/admin") ? /\/admin\/login/ : /\/partner\/login/);
      await expect(page.locator("body")).not.toContainText(other.name);
    }
  });

  test("QR image and batch export APIs refuse anonymous callers", async ({ request }) => {
    expect((await request.get(`/api/qr/${other.qrId}`)).status()).toBe(401);
    expect((await request.get(`/api/qr/batches/${other.batchId}/export`)).status()).toBe(401);
  });
});

test.describe("Partner", () => {
  test("every admin page shows the not-admin state, never admin data", async ({ page }) => {
    await signIn(page, "partner", DEV_PARTNER_EMAIL);
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page.getByText(`Signed in as ${DEV_PARTNER_EMAIL}, but not an admin.`), path).toBeVisible();
      await expect(page.locator("body"), path).not.toContainText(other.name);
    }
  });

  test("cannot see or fetch another partner's QR codes or batches", async ({ page }) => {
    await signIn(page, "partner", DEV_PARTNER_EMAIL);
    await expect(page.locator("body")).not.toContainText(other.name);
    await expect(page.locator("body")).not.toContainText(other.token);
    // The browser context carries the partner's session cookies.
    const qr = await page.request.get(`/api/qr/${other.qrId}`);
    expect([403, 404]).toContain(qr.status());
    const csv = await page.request.get(`/api/qr/batches/${other.batchId}/export`);
    expect([403, 404]).toContain(csv.status());
    expect(await csv.text()).not.toContain(other.token);
  });
});

test.describe("Admin", () => {
  test("reaches every admin page and sees all partners, including the other one", async ({ page }) => {
    await signInAdminWithMfa(page, DEV_ADMIN_EMAIL, DEV_PASSWORD);
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page.getByText(/but not an admin/), path).toHaveCount(0);
    }
    await page.goto("/admin/partners");
    await expect(page.locator("body")).toContainText(other.name);
    const csv = await page.request.get(`/api/qr/batches/${other.batchId}/export`);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain(other.token);
  });

  test("signing out ends access to the admin dashboard", async ({ page, context }) => {
    await signInAdminWithMfa(page, DEV_ADMIN_EMAIL, DEV_PASSWORD);
    await context.clearCookies();
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

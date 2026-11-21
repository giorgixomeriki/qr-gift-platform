import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { resolveSecretKey } from "../src/lib/supabase/keys";

/**
 * P0 2026-11-21 regression: Activation → Dashboard → Sign out → Sign in →
 * Dashboard, in the same browser and in a brand-new one, with the email typed
 * as people type it (capitals, spaces). The invitation is seeded directly (its
 * token's SHA-256, as the app stores it), so this spec needs no admin session.
 */
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
const authAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, resolveSecretKey(process.env)!.key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/partner/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /Sign out|გასვლა/ }).click();
  await expect(page).toHaveURL(/\/partner\/login/);
}

test("activation, sign out, sign in again (same and fresh browser), email typed loosely", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const run = `${testInfo.project.name.slice(0, 6)}-${randomUUID().slice(0, 6)}`.toLowerCase();
  const email = `pa-relogin-${run}@verify.test`;
  const name = `Relogin ${run}`;
  const token = randomBytes(32).toString("base64url");
  const [partner] = await sql<{ id: string }[]>`insert into partners (slug, name, contact_email) values (${`relogin-${run}`}, ${name}, ${email}) returning id`;
  await sql`insert into partner_invitations (partner_id, channel, contact, token_hash, expires_at, created_by)
            values (${partner!.id}, 'EMAIL', ${email}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '72 hours', ${randomUUID()})`;
  const password = `Relogin-${run}-pass-7`;

  // 1. Activate → dashboard.
  await page.goto(`/partner/activate?token=${token}`);
  await expect(page.getByTestId("activate-state-valid")).toBeVisible();
  await page.getByTestId("activate-password").fill(password);
  await page.getByTestId("activate-confirm").fill(password);
  await page.getByTestId("activate-submit").click();
  await expect(page).toHaveURL(/\/partner\/dashboard/);
  await expect(page.getByTestId("partner-dashboard-page")).toContainText(name);

  // 2. Sign out → sign in again in the same browser → dashboard.
  await signOut(page);
  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/partner\/dashboard/);
  await expect(page.getByTestId("partner-dashboard-page")).toContainText(name);

  // 3. Again, with the email typed with capitals and surrounding spaces.
  await signOut(page);
  await signIn(page, `  ${email.toUpperCase()} `, password);
  await expect(page).toHaveURL(/\/partner\/dashboard/);

  // 4. A brand-new browser session signs in too; a wrong password is refused.
  const fresh = await browser.newContext({ ...testInfo.project.use });
  const other = await fresh.newPage();
  await signIn(other, email, `${password}x`);
  await expect(other.getByTestId("login-error")).toBeVisible();
  await signIn(other, email, password);
  await expect(other).toHaveURL(/\/partner\/dashboard/);
  await expect(other.getByTestId("partner-dashboard-page")).toContainText(name);

  // 5. The used link says so and leads to normal sign-in.
  await other.goto(`/partner/activate?token=${token}`);
  await expect(other.getByTestId("activate-state-used")).toBeVisible();
  await other.getByRole("link", { name: /Go to sign in|შესვლის გვერდზე/ }).click();
  await expect(other).toHaveURL(/\/partner\/(login|dashboard)/);
  await fresh.close();

  // 6. Exactly one login, linked once, invitation consumed.
  const users = (await authAdmin.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((u) => u.email === email);
  expect(users).toHaveLength(1);
  const members = await sql`select user_id from partner_members where partner_id = ${partner!.id}`;
  expect(members.map((m) => m.user_id)).toEqual([users[0]!.id]);
  const [inv] = await sql`select status, accepted_user_id from partner_invitations where partner_id = ${partner!.id}`;
  expect(inv).toMatchObject({ status: "ACCEPTED", accepted_user_id: users[0]!.id });
});

test.afterAll(async () => {
  await sql.end();
});

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { completeMfaEnrollment, createThrowawayAdmin, logIn } from "./admin-session";
import { resolveSecretKey } from "../src/lib/supabase/keys";

/**
 * Email-only partner journey, the parts partner-login-access.spec.ts doesn't
 * drive in a browser: an expired link, sign-in with the chosen password at
 * /partner/login (wrong password refused), the admin-issued reset link (old
 * session ends, old password stops working), self-service "Forgot password"
 * through Supabase Auth mail, and SMS/phone sign-in absent everywhere.
 *
 * Needs: app with PARTNER_EMAIL_TRANSPORT=log + PARTNER_EMAIL_LOG_FILE, and a
 * local Supabase stack whose mail catcher (Mailpit) is at E2E_MAILPIT_URL and
 * whose auth redirect allow-list includes the app origin.
 */
const LOG_FILE = process.env.PARTNER_EMAIL_LOG_FILE;
const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:59424";
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
const authAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, resolveSecretKey(process.env)!.key, { auth: { persistSession: false, autoRefreshToken: false } });

function linksFor(email: string): string[] {
  if (!LOG_FILE || !existsSync(LOG_FILE)) return [];
  return readFileSync(LOG_FILE, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { to: string; text: string })
    .filter((m) => m.to === email)
    .map((m) => m.text.match(/https?:\/\/\S+\/partner\/activate\?token=[A-Za-z0-9_-]{43}/)?.[0])
    .filter((x): x is string => Boolean(x))
    .map((u) => new URL(u).pathname + new URL(u).search);
}

async function waitForNewLink(email: string, seen: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const all = linksFor(email);
    if (all.length > seen) return all.at(-1)!;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no new link for ${email}`);
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/partner/login");
  await expect(page.getByTestId("login-email")).toBeVisible();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

async function setPassword(page: Page, link: string, password: string) {
  await page.goto(link);
  await expect(page.getByTestId("activate-state-valid")).toBeVisible();
  await page.getByTestId("activate-password").fill(password);
  await page.getByTestId("activate-confirm").fill(password);
  await page.getByTestId("activate-submit").click();
  await expect(page).toHaveURL(/\/partner\/dashboard/);
}

/** Latest Supabase recovery mail for `email` in Mailpit → its verify URL. */
async function recoveryLink(email: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const body = (await res.json()) as { messages?: { ID: string; Created: string }[] };
    const fresh = (body.messages ?? []).filter((m) => Date.parse(m.Created) >= after);
    if (fresh.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh[0]!.ID}`)).json()) as { Text: string; HTML: string };
      const url = (msg.Text + " " + msg.HTML).match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)?.[0];
      if (url) return url.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no recovery mail for ${email}`);
}

test.describe.configure({ mode: "serial" });

test("expired link refused; password sign-in; admin reset ends old session; self-service recovery; no SMS", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const run = `${testInfo.project.name.slice(0, 6)}-${crypto.randomUUID().slice(0, 6)}`;
  const name = `Journey ${run}`;
  const slug = `journey-${run}`.toLowerCase();
  const email = `pa-journey-${run}@verify.test`.toLowerCase();
  const admin = await createThrowawayAdmin();
  const { data: list } = await authAdmin.auth.admin.listUsers({ perPage: 200 });
  const adminUser = list.users.find((u) => u.email === admin.email)!;
  await authAdmin.auth.admin.updateUserById(adminUser.id, { app_metadata: { admin_mfa: { enrollment_until: new Date(Date.now() + 15 * 60_000).toISOString(), factor_ids: [] } } });

  try {
    // Admin MFA stays mandatory: the new admin is sent to enrolment first.
    await logIn(page, "/admin/login", admin.email, admin.password);
    await page.waitForURL(/\/admin\/mfa\/setup/);
    await page.goto("/admin/partners");
    await expect(page).toHaveURL(/\/admin\/mfa\/setup/);
    await completeMfaEnrollment(page);
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    await page.goto("/admin/partners");
    await page.getByTestId("partner-name-input").fill(name);
    await page.getByTestId("partner-slug-input").fill(slug);
    await expect(page.getByTestId("partner-contact-phone-input")).toHaveCount(0);
    await page.getByTestId("partner-contact-email-input").fill(email);
    await page.getByTestId("create-partner-submit").click();
    await page.getByRole("link", { name }).click();
    const panel = page.getByTestId("partner-login-panel");
    await expect(panel.getByTestId("partner-open-phone-signin")).toHaveCount(0);

    // 1. Expired invitation: refused in the browser, no account created.
    await panel.getByTestId("partner-send-email-activation").click();
    await expect(page.getByTestId("partner-login-pending")).toBeVisible();
    const expiredLink = await waitForNewLink(email, 0);
    await sql`update partner_invitations set created_at = now() - interval '73 hours', expires_at = now() - interval '1 hour'
              where partner_id = (select id from partners where slug = ${slug}) and status = 'PENDING'`;
    const p = await browser.newContext({ ...testInfo.project.use });
    const partnerPage = await p.newPage();
    await partnerPage.goto(expiredLink);
    await expect(partnerPage.getByTestId("activate-state-expired")).toBeVisible();
    expect((await authAdmin.auth.admin.listUsers({ perPage: 200 })).data.users.some((u) => u.email === email)).toBe(false);

    // 2. Admin re-sends; partner activates with a password.
    await page.reload();
    await panel.getByTestId("partner-send-email-activation").click();
    await expect(page.getByTestId("partner-login-message")).toBeVisible();
    const activation = await waitForNewLink(email, 1);
    const pw1 = `Journey-${run}-first-pass`;
    await setPassword(partnerPage, activation, pw1);
    await partnerPage.goto(expiredLink);
    await expect(partnerPage.getByTestId("activate-state-valid")).toHaveCount(0);

    // 3. Fresh browser: wrong password refused, right one signs in. No phone tab.
    const c2 = await browser.newContext({ ...testInfo.project.use });
    const second = await c2.newPage();
    await signIn(second, email, "wrong-password-123");
    await expect(second.getByTestId("login-error")).toBeVisible();
    await expect(second.getByTestId("login-tab-phone")).toHaveCount(0);
    await expect(second.getByTestId("login-phone")).toHaveCount(0);
    await signIn(second, email, pw1);
    await expect(second).toHaveURL(/\/partner\/dashboard/);
    await expect(second.getByTestId("partner-dashboard-page")).toContainText(name);

    // 4. Admin-issued reset link (sent by the app's own email transport).
    await page.reload();
    await page.getByTestId("partner-send-reset").click();
    await expect(page.getByTestId("partner-login-message")).toBeVisible();
    const reset = await waitForNewLink(email, 2);
    const pw2 = `Journey-${run}-second-pass`;
    const c3 = await browser.newContext({ ...testInfo.project.use });
    const third = await c3.newPage();
    await setPassword(third, reset, pw2);
    // The other session (second) ended; the old password no longer works.
    await second.goto("/partner/dashboard");
    await expect(second.getByTestId("partner-dashboard-page")).toHaveCount(0);
    await signIn(second, email, pw1);
    await expect(second.getByTestId("login-error")).toBeVisible();
    await third.goto(reset);
    await expect(third.getByTestId("activate-state-used")).toBeVisible();

    // 5. The partner area never offers phone sign-in or other partners' data.
    await third.goto("/partner/dashboard");
    await expect(third.getByTestId("partner-dashboard-page")).toContainText(name);
    await expect(third.getByText("Demo Flower Shop")).toHaveCount(0);
    // 6. Self-service "Forgot password" (Supabase Auth recovery mail), one device
    //    is enough: the hosted mail limit is per project, not per browser.
    if (testInfo.project.name === "desktop-chromium") {
      const c4 = await browser.newContext({ ...testInfo.project.use });
      const fourth = await c4.newPage();
      const since = Date.now() - 2000;
      await fourth.goto("/partner/login");
      await fourth.getByTestId("forgot-password-link").click();
      await fourth.getByTestId("forgot-password-email").fill(email);
      await fourth.getByTestId("forgot-password-submit").click();
      await expect(fourth.getByTestId("reset-email-sent")).toBeVisible();
      await fourth.goto(await recoveryLink(email, since));
      await expect(fourth).toHaveURL(/\/reset-password/);
      const pw3 = `Journey-${run}-third-pass`;
      await fourth.getByTestId("new-password").fill(pw3);
      await fourth.getByTestId("confirm-password").fill(pw3);
      await fourth.getByTestId("reset-password-submit").click();
      await expect(fourth.getByTestId("reset-success")).toBeVisible();
      const c5 = await browser.newContext({ ...testInfo.project.use });
      const fifth = await c5.newPage();
      await signIn(fifth, email, pw3);
      await expect(fifth).toHaveURL(/\/partner\/dashboard/);
      await expect(fifth.getByTestId("partner-dashboard-page")).toContainText(name);
      // Supabase Auth ends the person's other sessions on a password change.
      await third.goto("/partner/dashboard");
      await expect(third.getByTestId("partner-dashboard-page")).toHaveCount(0);
      await c4.close();
      await c5.close();
    }

    await p.close();
    await c2.close();
    await c3.close();
  } finally {
    const partners = await sql`select id from partners where slug = ${slug}`;
    for (const row of partners) {
      await sql`delete from audit_logs where target_id = ${row.id as string}`;
      await sql`delete from partner_invitations where partner_id = ${row.id as string}`;
      await sql`delete from partner_members where partner_id = ${row.id as string}`;
      await sql`delete from partners where id = ${row.id as string}`;
    }
    const { data } = await authAdmin.auth.admin.listUsers({ perPage: 200 });
    const u = data.users.find((x) => x.email === email);
    if (u) await authAdmin.auth.admin.deleteUser(u.id);
    await admin.cleanup();
  }
});

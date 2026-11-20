import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { expect, test } from "@playwright/test";
import { completeMfaEnrollment, createThrowawayAdmin, logIn } from "./admin-session";
import { resolveSecretKey } from "../src/lib/supabase/keys";

/**
 * Partner login access end to end (docs/partner-auth/PARTNER-LOGIN-ACCESS.md):
 * an MFA admin creates a partner with a phone + email, emails the activation
 * link, the partner activates and lands on their dashboard, the link can't be
 * reused, and revoking the login ends access. Needs the app running with
 * PARTNER_EMAIL_TRANSPORT=log and PARTNER_EMAIL_LOG_FILE (the link is read
 * from that file, as a mailbox stand-in).
 */
const LOG_FILE = process.env.PARTNER_EMAIL_LOG_FILE;
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
const authAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, resolveSecretKey(process.env)!.key, { auth: { persistSession: false, autoRefreshToken: false } });

function linkFor(email: string): string {
  if (!LOG_FILE || !existsSync(LOG_FILE)) throw new Error("PARTNER_EMAIL_LOG_FILE has no messages");
  const lines = readFileSync(LOG_FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; text: string });
  const mail = lines.reverse().find((m) => m.to === email);
  const match = mail?.text.match(/https?:\/\/\S+\/partner\/activate\?token=[A-Za-z0-9_-]{43}/);
  if (!match) throw new Error(`No activation link for ${email}`);
  return new URL(match[0]).pathname + new URL(match[0]).search;
}

test.describe.configure({ mode: "serial" });

test("admin invites by email; partner activates; reuse refused; revoke ends access", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const run = `${testInfo.project.name.slice(0, 6)}-${crypto.randomUUID().slice(0, 6)}`;
  const partnerEmail = `pa-e2e-${run}@verify.test`;
  const phoneDigits = String(500000000 + Math.floor(Math.random() * 99999999)).slice(0, 9);
  const admin = await createThrowawayAdmin();
  const { data: list } = await authAdmin.auth.admin.listUsers({ perPage: 200 });
  const adminUser = list.users.find((u) => u.email === admin.email)!;
  await authAdmin.auth.admin.updateUserById(adminUser.id, { app_metadata: { admin_mfa: { enrollment_until: new Date(Date.now() + 15 * 60_000).toISOString(), factor_ids: [] } } });

  try {
    await logIn(page, "/admin/login", admin.email, admin.password);
    await page.waitForURL(/\/admin\/mfa\/setup/);
    await completeMfaEnrollment(page);
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    await page.goto("/admin/partners");
    await page.getByTestId("partner-name-input").fill(`Login Access ${run}`);
    await page.getByTestId("partner-slug-input").fill(`login-access-${run}`.toLowerCase());
    await page.getByTestId("create-partner-submit").click();
    await expect(page.getByTestId("create-partner-error")).toBeVisible();

    await page.getByTestId("partner-contact-phone-input").fill(`+995 ${phoneDigits.replace(/^./, "5")}`);
    await page.getByTestId("partner-contact-email-input").fill(partnerEmail.toUpperCase());
    await page.getByTestId("create-partner-submit").click();
    await page.getByRole("link", { name: `Login Access ${run}` }).click();

    const panel = page.getByTestId("partner-login-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("partner-contact-email")).toHaveValue(partnerEmail);
    // Phone sign-in is offered only when the server has it on.
    const phoneOn = process.env.E2E_PHONE_OTP === "1";
    if (phoneOn) await expect(panel.getByTestId("partner-open-phone-signin")).toBeEnabled();
    else await expect(panel.getByTestId("partner-open-phone-signin")).toBeDisabled();
    await panel.getByTestId("partner-send-email-activation").click();
    await expect(page.getByTestId("partner-login-message")).toBeVisible();
    await expect(page.getByTestId("partner-login-pending")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("admin-login-panel.png"), fullPage: true });

    const link = linkFor(partnerEmail);
    const partnerCtx = await browser.newContext({ ...testInfo.project.use });
    const partnerPage = await partnerCtx.newPage();
    await partnerPage.goto("/partner/activate?token=" + "A".repeat(43));
    await expect(partnerPage.getByTestId("activate-state-invalid")).toBeVisible();

    await partnerPage.goto(link);
    await expect(partnerPage.getByTestId("activate-state-valid")).toContainText(`Login Access ${run}`);
    await partnerPage.screenshot({ path: testInfo.outputPath("activate.png"), fullPage: true });
    // Too short is stopped by the field itself (minLength); a mismatch by the form.
    await expect(partnerPage.getByTestId("activate-password")).toHaveAttribute("minlength", "10");
    await partnerPage.getByTestId("activate-password").fill("long-enough-one");
    await partnerPage.getByTestId("activate-confirm").fill("long-enough-two");
    await partnerPage.getByTestId("activate-submit").click();
    await expect(partnerPage.getByTestId("activate-error")).toBeVisible();
    const pw = `E2e-${run}-strong-pass`;
    await partnerPage.getByTestId("activate-password").fill(pw);
    await partnerPage.getByTestId("activate-confirm").fill(pw);
    await partnerPage.getByTestId("activate-submit").click();
    await expect(partnerPage).toHaveURL(/\/partner\/dashboard/);
    await expect(partnerPage.getByTestId("partner-dashboard-page")).toContainText(`Login Access ${run}`);
    await expect(partnerPage.getByTestId("partner-qr-results")).toBeVisible();
    await expect(partnerPage.getByText(/Team|გუნდი/).first()).toHaveCount(0);
    await partnerPage.screenshot({ path: testInfo.outputPath("partner-dashboard.png"), fullPage: true });

    const reuseCtx = await browser.newContext({ ...testInfo.project.use });
    const reusePage = await reuseCtx.newPage();
    await reusePage.goto(link);
    await expect(reusePage.getByTestId("activate-state-used")).toBeVisible();
    await reusePage.goto("/partner/login");
    await expect(reusePage.getByTestId("login-email")).toBeVisible();
    await expect(reusePage.getByTestId("login-tab-phone")).toHaveCount(phoneOn ? 1 : 0);
    await reuseCtx.close();

    await page.reload();
    await expect(page.getByTestId("partner-login-row")).toHaveCount(1);
    await page.getByTestId("partner-revoke-login").click();
    await page.getByTestId("partner-revoke-login-confirm").click();
    await expect(page.getByTestId("partner-login-status")).toContainText(/No login yet|ანგარიში ჯერ არ არის/);

    await partnerPage.reload();
    await expect(partnerPage.getByTestId("partner-dashboard-page")).toHaveCount(0);
    await partnerCtx.close();
  } finally {
    const partners = await sql`select id from partners where slug = ${`login-access-${run}`.toLowerCase()}`;
    for (const p of partners) {
      await sql`delete from audit_logs where target_id = ${p.id as string}`;
      await sql`delete from partner_invitations where partner_id = ${p.id as string}`;
      await sql`delete from partner_members where partner_id = ${p.id as string}`;
      await sql`delete from partners where id = ${p.id as string}`;
    }
    const { data } = await authAdmin.auth.admin.listUsers({ perPage: 200 });
    const partnerUser = data.users.find((u) => u.email === partnerEmail);
    if (partnerUser) await authAdmin.auth.admin.deleteUser(partnerUser.id);
    await admin.cleanup();
  }
});

/**
 * Phone sign-in through the real Supabase Auth OTP path. Runs only against a
 * local stack whose supabase/config.toml maps test numbers 995599000001-3 to
 * code 246810 ([auth.sms.test_otp]; never configured in production) and an
 * app started with PARTNER_PHONE_AUTH_ENABLED=true.
 */
test("phone: unknown number gets the same reply; invited number signs in with the SMS code", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_PHONE_OTP !== "1", "needs the local test-OTP stack (E2E_PHONE_OTP=1)");
  test.setTimeout(120_000);
  const index = { "desktop-chromium": 1, "mobile-emulated": 2, "iphone-webkit": 3 }[testInfo.project.name] ?? 1;
  const phone = `+99559900000${index}`;
  const partnerId = crypto.randomUUID();
  const slug = `phone-e2e-${crypto.randomUUID().slice(0, 8)}`;
  await sql`insert into partners (id, slug, name, contact_phone) values (${partnerId}, ${slug}, ${`Phone Shop ${index}`}, ${phone})`;
  await sql`insert into partner_invitations (partner_id, channel, contact, expires_at, created_by) values (${partnerId}, 'PHONE', ${phone}, now() + interval '1 hour', ${crypto.randomUUID()})`;

  try {
    await page.goto("/partner/login");
    await page.getByTestId("login-tab-phone").click();
    await page.getByTestId("login-phone").fill("599 00 00 99");
    await page.getByTestId("phone-send-code").click();
    const unknownReply = await page.getByTestId("phone-code-sent").innerText();
    await page.getByTestId("login-code").fill("246810");
    await page.getByTestId("phone-verify").click();
    await expect(page.getByTestId("phone-login-error")).toBeVisible();

    await page.getByRole("button", { name: /different number|სხვა ნომრის/ }).click();
    await page.getByTestId("login-phone").fill(`5990000 0${index}`);
    await page.getByTestId("phone-send-code").click();
    const invitedReply = await page.getByTestId("phone-code-sent").innerText();
    expect(invitedReply.replace(/\d/g, "#")).toBe(unknownReply.replace(/\d/g, "#"));
    await page.screenshot({ path: testInfo.outputPath("phone-code.png"), fullPage: true });

    await page.getByTestId("login-code").fill("111111");
    await page.getByTestId("phone-verify").click();
    await expect(page.getByTestId("phone-login-error")).toBeVisible();
    await page.getByTestId("login-code").fill("246810");
    await page.getByTestId("phone-verify").click();
    await expect(page).toHaveURL(/\/partner\/dashboard/);
    await expect(page.getByTestId("partner-dashboard-page")).toContainText(`Phone Shop ${index}`);
    const [member] = await sql`select role from partner_members where partner_id = ${partnerId}`;
    expect(member?.role).toBe("OWNER");
    const [inv] = await sql`select status from partner_invitations where partner_id = ${partnerId}`;
    expect(inv?.status).toBe("ACCEPTED");
  } finally {
    await sql`delete from audit_logs where target_id = ${partnerId}`;
    await sql`delete from partner_invitations where partner_id = ${partnerId}`;
    await sql`delete from partner_members where partner_id = ${partnerId}`;
    await sql`delete from partners where id = ${partnerId}`;
    const { data } = await authAdmin.auth.admin.listUsers({ perPage: 200 });
    for (const u of data.users.filter((x) => x.phone === phone.slice(1))) await authAdmin.auth.admin.deleteUser(u.id);
  }
});

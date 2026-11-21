import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { completeMfaEnrollment, createThrowawayAdmin, logIn } from "./admin-session";
import { resolveSecretKey } from "../src/lib/supabase/keys";

/**
 * P1 2026-11-21: the admin's page for a partner and that partner's own
 * dashboard show the same QR inventory figures, equal to the database.
 * Seeds one partner (5 available, 2 draft, 1 blocked; 3 handed over; one card
 * scanned 4 times + one scanned once) on the local stack.
 */
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
const authAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, resolveSecretKey(process.env)!.key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TILES = ["issued", "available", "draft", "active", "distributed", "scanned", "batch-count"] as const;

async function tiles(page: Page, prefix: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of TILES) out[k] = ((await page.getByTestId(`${prefix}${k}`).locator("p").nth(1).textContent()) ?? "").trim();
  return out;
}

test("admin partner page and partner dashboard show the same inventory as the database", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const run = `${testInfo.project.name.slice(0, 6)}-${randomUUID().slice(0, 6)}`.toLowerCase();
  const [partner] = await sql<{ id: string }[]>`insert into partners (slug, name) values (${`inv-e2e-${run}`}, ${`Inventory ${run}`}) returning id`;
  const [batch] = await sql<{ id: string }[]>`insert into qr_batches (partner_id, label, quantity) values (${partner!.id}, ${`E2E ${run}`}, 8) returning id`;
  const ids: string[] = [];
  const tokens: string[] = [];
  for (let i = 0; i < 8; i++) {
    const id = randomUUID();
    const token = randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase();
    ids.push(id);
    tokens.push(token);
    await sql`insert into qr_codes (id, public_token, batch_id, partner_id, distribution_status)
              values (${id}, ${token}, ${batch!.id}, ${partner!.id}, ${i < 3 ? "DISTRIBUTED" : "NOT_DISTRIBUTED"})`;
  }
  // Fixture statuses set with triggers off (local stack only): this tests counting, not the claim/payment paths.
  await sql.begin(async (t) => {
    await t`set local session_replication_role = replica`;
    await t`update qr_codes set status = 'DRAFT' where id in (${ids[5]!}, ${ids[6]!})`;
    await t`update qr_codes set status = 'BLOCKED' where id = ${ids[7]!}`;
    await t`update qr_codes set status = 'ACTIVE' where id = ${ids[4]!}`;
  });
  for (let i = 0; i < 4; i++) await sql`insert into analytics_events (event_type, qr_code_id, partner_id) values ('QR_SCANNED', ${ids[0]!}, ${partner!.id})`;
  await sql`insert into analytics_events (event_type, qr_code_id, partner_id) values ('QR_SCANNED', ${ids[1]!}, ${partner!.id})`;

  const [db] = await sql`select count(*)::int issued, count(*) filter (where status='AVAILABLE')::int available,
      count(*) filter (where status='DRAFT')::int draft, count(*) filter (where status='ACTIVE')::int active,
      count(*) filter (where distribution_status='DISTRIBUTED')::int distributed,
      (select count(distinct qr_code_id)::int from analytics_events where qr_code_id = any(${ids}) and event_type='QR_SCANNED') scanned
      from qr_codes where partner_id = ${partner!.id}`;
  const expected = { issued: `${db!.issued}`, available: `${db!.available}`, draft: `${db!.draft}`, active: `${db!.active}`, distributed: `${db!.distributed}`, scanned: `${db!.scanned}`, "batch-count": "1" };
  expect(expected).toEqual({ issued: "8", available: "4", draft: "2", active: "1", distributed: "3", scanned: "2", "batch-count": "1" });

  // Partner login (one OWNER membership).
  const email = `inv-e2e-${run}@verify.test`;
  const password = `Inventory-${run}-pass-1`;
  const { data: created } = await authAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  await sql`insert into partner_members (partner_id, user_id, role) values (${partner!.id}, ${created.user!.id}, 'OWNER')`;

  try {
    // Admin (MFA enrolment is mandatory for a new admin).
    const admin = await createThrowawayAdmin();
    const { data: list } = await authAdmin.auth.admin.listUsers({ perPage: 1000 });
    const adminUser = list.users.find((u) => u.email === admin.email)!;
    await authAdmin.auth.admin.updateUserById(adminUser.id, { app_metadata: { admin_mfa: { enrollment_until: new Date(Date.now() + 15 * 60_000).toISOString(), factor_ids: [] } } });
    await logIn(page, "/admin/login", admin.email, admin.password);
    await page.waitForURL(/\/admin\/mfa\/setup/);
    await completeMfaEnrollment(page);
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await page.goto(`/admin/partners/${partner!.id}`);
    await expect(page.getByTestId("admin-metric-issued")).toBeVisible();
    const adminTiles = await tiles(page, "admin-metric-");
    await expect(page.getByTestId("admin-metric-blocked").locator("p").nth(1)).toHaveText("1");

    const ctx = await browser.newContext({ ...testInfo.project.use });
    const partnerPage = await ctx.newPage();
    for (const c of [page.context(), ctx]) await c.addCookies([{ name: "NEXT_LOCALE", value: "ka", url: testInfo.project.use.baseURL! }]);
    await logIn(partnerPage, "/partner/login", email, password);
    await partnerPage.waitForURL(/\/partner\/dashboard/);
    const partnerTiles = await tiles(partnerPage, "metric-");

    expect(adminTiles).toEqual(expected);
    expect(partnerTiles).toEqual(expected);

    // The same cards carry the same status label on both screens (Georgian):
    // DRAFT is "მონახაზი" — never "გამოყენებული" or a sale; ACTIVE is
    // "გააქტიურებული". A moderated card stays "გამოყენებული" for the partner.
    await page.reload();
    await partnerPage.reload();
    const label: Record<string, [string, string]> = {
      AVAILABLE: ["ხელმისაწვდომი", "ხელმისაწვდომი"],
      DRAFT: ["მონახაზი", "მონახაზი"],
      ACTIVE: ["გააქტიურებული", "გააქტიურებული"],
      BLOCKED: ["დაბლოკილი", "გამოყენებული"],
    };
    const rows = await sql<{ id: string; public_token: string; status: string }[]>`select id, public_token, status from qr_codes where partner_id = ${partner!.id}`;
    for (const r of rows) {
      const suffix = r.public_token.slice(-4);
      const adminRow = page.getByTestId("inventory-row").filter({ hasText: r.public_token });
      const partnerRow = partnerPage.getByTestId("inventory-row").filter({ hasText: r.status === "AVAILABLE" ? r.public_token : `••••${suffix}` });
      await expect(adminRow, `admin ${r.status} ${suffix}`).toContainText(label[r.status]![0]);
      await expect(partnerRow, `partner ${r.status} ${suffix}`).toContainText(label[r.status]![1]);
      if (r.status === "DRAFT") await expect(partnerRow).not.toContainText("გამოყენებული");
      // Masking unchanged: a claimed card's token never reaches the partner page.
      if (r.status !== "AVAILABLE") expect(await partnerPage.content()).not.toContain(r.public_token);
    }

    // A status change shows on both screens at the next load.
    await sql.begin(async (t) => {
      await t`set local session_replication_role = replica`;
      await t`update qr_codes set status = 'DRAFT' where id = ${ids[3]!}`;
    });
    await page.reload();
    await partnerPage.reload();
    await expect(page.getByTestId("admin-metric-draft").locator("p").nth(1)).toHaveText("3");
    await expect(partnerPage.getByTestId("metric-draft").locator("p").nth(1)).toHaveText("3");
    await expect(page.getByTestId("admin-metric-available").locator("p").nth(1)).toHaveText("3");
    await expect(partnerPage.getByTestId("metric-available").locator("p").nth(1)).toHaveText("3");
    await ctx.close();
  } finally {
    await sql`delete from analytics_events where qr_code_id = any(${ids})`;
    await sql`delete from qr_codes where partner_id = ${partner!.id}`;
    await sql`delete from qr_batches where partner_id = ${partner!.id}`;
    await sql`delete from partner_members where partner_id = ${partner!.id}`;
    await sql`delete from partners where id = ${partner!.id}`;
    await authAdmin.auth.admin.deleteUser(created.user!.id);
  }
});

test.afterAll(async () => {
  await sql.end();
});

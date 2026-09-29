import { test, expect, type Page } from "@playwright/test";
import { createPartnerBatchWithLiveCard, DEV_ADMIN_EMAIL, DEV_PARTNER_EMAIL, DEV_PASSWORD } from "./fixtures";

/**
 * QA-01 V1 privacy hardening: partner surfaces release a card's credential
 * (token / URL / QR image) only while the card is unclaimed, never show a
 * claimed card's lifecycle beyond "Used", never serve greeting content, and
 * audit every credential release. Admins keep full access.
 * See docs/PRIVACY_MODEL.md.
 */
test.use({ locale: "en-US" });

/** Cards on a print sheet (each is one `print-card` element; the QR itself is SVG path data, not token text). */
function countPrintCards(html: string): number {
  return html.match(/class="print-card /g)?.length ?? 0;
}

async function signIn(page: Page, path: "/partner/login" | "/admin/login", email: string, landing: RegExp) {
  await page.goto(path);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(DEV_PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(landing);
}

test.describe("Partner credential exposure", () => {
  let fixture: Awaited<ReturnType<typeof createPartnerBatchWithLiveCard>>;

  test.beforeEach(async ({ context, baseURL }) => {
    fixture = await createPartnerBatchWithLiveCard(DEV_PARTNER_EMAIL);
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "en", url: baseURL! },
      { name: "active_partner_id", value: fixture.partnerId, url: baseURL! },
    ]);
  });

  test.afterEach(async () => {
    await fixture.cleanup();
  });

  test("partner dashboard, CSV, print sheet and QR image release only unclaimed cards", async ({ page }) => {
    await signIn(page, "/partner/login", DEV_PARTNER_EMAIL, /\/partner\/dashboard/);

    // Dashboard — neither the rendered page nor its server payload carries the live card's token.
    const dashboardHtml = await (await page.request.get("/partner/dashboard")).text();
    expect(dashboardHtml).toContain(fixture.availableToken);
    expect(dashboardHtml).not.toContain(fixture.liveToken);
    expect(dashboardHtml).not.toContain(fixture.message);
    await page.goto("/partner/dashboard");
    const liveRow = page.getByTestId("inventory-row").filter({ hasText: `••••${fixture.liveToken.slice(-4)}` });
    await expect(liveRow).toContainText("Used");
    await expect(liveRow.getByRole("link")).toHaveCount(0);
    await expect(page.getByTestId("inventory-row").filter({ hasText: fixture.availableToken })).toContainText("Available");

    // CSV — the live card is masked, has no URL and no finer status than USED.
    const csv = await (await page.request.get(`/api/qr/batches/${fixture.batchId}/export`)).text();
    expect(csv).toContain(fixture.availableToken);
    expect(csv).not.toContain(fixture.liveToken);
    expect(csv).not.toContain("ACTIVE");
    const liveLine = csv.split("\r\n").find((line) => line.startsWith(`••••${fixture.liveToken.slice(-4)}`));
    expect(liveLine?.split(",")[1]).toBe("");
    expect(liveLine).toContain(",USED,");

    // Print sheet — only the unclaimed card is printable (the batch holds two).
    const print = await page.request.get(`/print/batch/${fixture.batchId}`);
    expect(countPrintCards(await print.text())).toBe(1);
    expect(print.headers()["cache-control"]).toContain("no-store");

    // QR image — unclaimed card only, and never cacheable.
    const availableSvg = await page.request.get(`/api/qr/${fixture.availableQrId}?format=svg`);
    expect(availableSvg.status()).toBe(200);
    expect(availableSvg.headers()["cache-control"]).toBe("no-store");
    const liveSvg = await page.request.get(`/api/qr/${fixture.liveQrId}?format=png`);
    expect(liveSvg.status()).toBe(404);

    // Every credential release was audit logged against this user.
    const actions = await fixture.auditActions(DEV_PARTNER_EMAIL);
    expect(actions).toEqual(expect.arrayContaining(["QR_BATCH_EXPORTED", "QR_BATCH_PRINT_VIEWED", "QR_ASSET_DOWNLOADED"]));
  });

  test("admin keeps full credential access for support and reprints", async ({ page }) => {
    await signIn(page, "/admin/login", DEV_ADMIN_EMAIL, /\/admin\/dashboard/);
    const csv = await (await page.request.get(`/api/qr/batches/${fixture.batchId}/export`)).text();
    expect(csv).toContain(fixture.liveToken);
    expect(csv).toContain("ACTIVE");
    expect((await page.request.get(`/api/qr/${fixture.liveQrId}?format=svg`)).status()).toBe(200);
    expect(countPrintCards(await (await page.request.get(`/print/batch/${fixture.batchId}`)).text())).toBe(2);
  });
});

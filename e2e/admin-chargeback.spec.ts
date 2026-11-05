import { test, expect } from "@playwright/test";
import { createAvailableQr, moneyTrailFor, DEV_ADMIN_EMAIL, DEV_PASSWORD } from "./fixtures";

/**
 * Chargeback administration through the real admin UI: a card is sold
 * through the TEST checkout, then an admin records the bank's chargeback on
 * the partner's sales trace. The order is refunded in the books and the
 * commission reversed once — no provider call (verify:chargebacks covers the
 * service exhaustively; this proves the screen).
 */
test.use({ locale: "en-US" });

test.describe("Admin chargeback", () => {
  let qr: Awaited<ReturnType<typeof createAvailableQr>>;

  test.beforeEach(async ({ context, baseURL }) => {
    qr = await createAvailableQr();
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
  });

  test.afterEach(async () => {
    await qr.cleanup();
  });

  test("an admin records a chargeback and the commission is reversed once", async ({ page }) => {
    // A paid sale through the real sender flow.
    await page.goto(`/g/${qr.publicToken}`);
    await page.getByTestId("start-greeting-button").click();
    await page.getByTestId("theme-option-minimal").click();
    await page.getByTestId("wizard-continue").click();
    // Message and media are one Create screen, then the Preview screen.
    await expect(page.getByTestId("media-step")).toBeVisible();
    await page.getByTestId("message-textarea").fill("Chargeback end-to-end test greeting.");
    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("preview-step")).toBeVisible();
    await page.getByTestId("preview-watch").click();
    await page.getByTestId("greeting-tap-to-open").click();
    await page.getByTestId("greeting-continue").click();
    await page.getByTestId("preview-activate-cta").click();
    await page.getByTestId("checkout-pay").click();
    await expect(page.getByTestId("greeting-renderer")).toBeVisible({ timeout: 15_000 });

    // The admin records the bank's chargeback.
    await page.context().clearCookies();
    await page.goto("/admin/login");
    await page.getByTestId("login-email").fill(DEV_ADMIN_EMAIL);
    await page.getByTestId("login-password").fill(DEV_PASSWORD);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await page.goto(`/admin/partners/${qr.partnerId}`);

    const row = page.getByTestId("sales-trace-row");
    await expect(row).toHaveCount(1);
    await row.getByTestId("sales-trace-chargeback").click();
    await row.getByTestId("sales-trace-chargeback-reference").fill("BOG-CASE-E2E-1");
    await row.getByTestId("sales-trace-chargeback-date").fill(new Date().toISOString().slice(0, 10));
    await row.getByTestId("sales-trace-chargeback-next").click();
    await row.getByTestId("sales-trace-chargeback-confirm").click();

    await expect(page.getByTestId("sales-trace-notice")).toBeVisible();
    await expect(page.getByTestId("sales-trace-row")).toContainText("Charged back");
    await expect(page.getByTestId("sales-trace-chargeback")).toHaveCount(0); // no longer PAID

    const trail = await moneyTrailFor(qr.publicToken);
    expect(trail.orders.map((o) => o.status)).toEqual(["REFUNDED"]);
    const types = trail.ledger.map((l) => `${l.type}:${l.amount_minor}`).sort();
    const commission = trail.orders[0]!.partner_commission_minor as number;
    expect(types).toEqual([`COMMISSION_EARNED:${commission}`, `COMMISSION_REVERSAL:${-commission}`].sort());
  });
});

import { test, expect, type Page } from "@playwright/test";
import { createAvailableQr, setPartnerStatus, commercialStateOf } from "./fixtures";

/**
 * Browser-level coverage for the pilot QA fixes (QA-02 / QA-03 / QA-04 /
 * QA-08): each test re-runs the original reproduction through the real UI or
 * the real HTTP endpoint. The service-level edge cases (moderation race,
 * refunds, RLS backstops) are in scripts/verify-pilot-protections.ts.
 */
test.use({ locale: "en-US" });
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
});

async function startAndWrite(page: Page, publicToken: string, message: string | null) {
  await page.goto(`/g/${publicToken}`);
  await page.getByTestId("start-greeting-button").click();
  await expect(page.getByTestId("theme-step")).toBeVisible();
  if (message === null) return;
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("message-textarea").fill(message);
  await page.getByTestId("wizard-continue").click();
  await expect(page.getByTestId("media-step")).toBeVisible();
}

test.describe("Pilot protections", () => {
  test("QA-02: a direct link to checkout without a message returns to the message step and creates no order", async ({ page }) => {
    const qr = await createAvailableQr();
    try {
      await startAndWrite(page, qr.publicToken, null);
      await page.goto(`/g/${qr.publicToken}?step=checkout`);
      await expect(page).toHaveURL(/step=message/);
      await expect(page.getByTestId("message-textarea")).toBeVisible();
      await expect(page.getByTestId("checkout-pay")).toHaveCount(0);

      await page.goto(`/g/${qr.publicToken}?step=preview`);
      await expect(page).toHaveURL(/step=message/);

      const state = await commercialStateOf(qr.publicToken);
      expect(state.orders).toEqual([]);
      expect(state.greeting).toBe("DRAFT");
    } finally {
      await qr.cleanup();
    }
  });

  test("QA-04: a suspended partner's card can't be started, but an already-paid greeting still opens", async ({ page, browser }) => {
    const unused = await createAvailableQr();
    const paid = await createAvailableQr();
    try {
      // Paid and active before the suspension.
      await startAndWrite(page, paid.publicToken, "Paid before the shop was suspended.");
      await page.goto(`/g/${paid.publicToken}?step=checkout`);
      await page.getByTestId("checkout-pay").click();
      await expect(page.getByTestId("greeting-renderer")).toBeVisible({ timeout: 15_000 });

      await setPartnerStatus(unused.partnerId, "SUSPENDED");
      await setPartnerStatus(paid.partnerId, "SUSPENDED");

      await page.goto(`/g/${unused.publicToken}`);
      await expect(page.getByRole("heading", { name: "This card isn't available" })).toBeVisible();
      await expect(page.getByTestId("start-greeting-button")).toHaveCount(0);
      expect((await commercialStateOf(unused.publicToken)).qr).toBe("AVAILABLE");

      const recipient = await browser.newContext({ locale: "en-US" });
      const recipientPage = await recipient.newPage();
      await recipientPage.goto(`/g/${paid.publicToken}`);
      await recipientPage.getByTestId("greeting-tap-to-open").click();
      await expect(recipientPage.getByTestId("greeting-message-beat")).toContainText("Paid before the shop was suspended.");
      await recipient.close();
    } finally {
      await unused.cleanup();
      await paid.cleanup();
    }
  });

  test("QA-04: a suspended partner's open checkout can't be paid", async ({ page }) => {
    const qr = await createAvailableQr();
    try {
      await startAndWrite(page, qr.publicToken, "Checkout left open.");
      await page.goto(`/g/${qr.publicToken}?step=checkout`);
      await expect(page.getByTestId("checkout-amount")).toBeVisible();

      await setPartnerStatus(qr.partnerId, "SUSPENDED");
      await page.getByTestId("checkout-pay").click();
      await expect(page.getByText("You haven't been charged")).toBeVisible();

      const state = await commercialStateOf(qr.publicToken);
      expect(state.orders).toEqual(["PENDING_PAYMENT"]);
      expect(state.greeting).toBe("DRAFT");
    } finally {
      await qr.cleanup();
    }
  });

  test("QA-08: an anonymous, unsigned TEST webhook cannot activate a pending order", async ({ page, playwright, baseURL }) => {
    const qr = await createAvailableQr();
    try {
      await startAndWrite(page, qr.publicToken, "Webhook forgery target.");
      await page.goto(`/g/${qr.publicToken}?step=checkout`);
      await expect(page.getByTestId("checkout-amount")).toBeVisible();
      const before = await commercialStateOf(qr.publicToken);

      const anonymous = await playwright.request.newContext({ baseURL });
      const forged = { orderId: before.latestOrderId, providerPaymentId: before.latestPaymentId };
      const unsigned = await anonymous.post("/api/webhooks/payments/TEST", { data: forged });
      const badlySigned = await anonymous.post("/api/webhooks/payments/TEST", {
        data: forged,
        headers: { "x-test-webhook-signature": "0".repeat(64) },
      });
      await anonymous.dispose();

      // 400 where the TEST webhook is enabled (bad signature), 404 where it isn't — never 200.
      expect([400, 404]).toContain(unsigned.status());
      expect([400, 404]).toContain(badlySigned.status());
      const after = await commercialStateOf(qr.publicToken);
      expect(after.orders).toEqual(["PENDING_PAYMENT"]);
      expect(after.greeting).toBe("DRAFT");
      expect(after.qr).toBe("DRAFT");
    } finally {
      await qr.cleanup();
    }
  });
});

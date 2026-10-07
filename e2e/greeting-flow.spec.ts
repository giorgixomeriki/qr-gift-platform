import { test, expect } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * The core money-path scenario: scan -> wizard -> TEST checkout -> recipient
 * reveal. Deliberately skips the media step's actual uploads (all slots are
 * optional; real file-upload coverage against local Storage is a larger,
 * separate investment better suited to its own spec) and focuses on proving
 * the whole state machine — QR AVAILABLE -> DRAFT -> ACTIVE — actually works
 * end to end through the real UI, not just at the service-layer (which the
 * verify:*.ts scripts already cover exhaustively).
 */
test.describe("Sender greeting creation -> TEST checkout -> recipient reveal", () => {
  let publicToken: string;
  let cleanup: () => Promise<void>;

  test.beforeAll(async () => {
    const qr = await createAvailableQr();
    publicToken = qr.publicToken;
    cleanup = qr.cleanup;
  });

  test.afterAll(async () => {
    await cleanup();
  });

  test("full sender journey activates the greeting and the sender sees their own success banner", async ({ page }) => {
    await page.goto(`/g/${publicToken}`);
    await expect(page.getByTestId("sender-entry")).toBeVisible();

    await page.getByTestId("start-greeting-button").click();
    await expect(page.getByTestId("theme-step")).toBeVisible();

    await page.getByTestId("theme-option-minimal").click();
    await page.getByTestId("wizard-continue").click();

    await expect(page.getByTestId("message-textarea")).toBeVisible();
    await page.getByTestId("message-textarea").fill("This is an automated end-to-end test greeting.");
    await page.getByTestId("wizard-continue").click();

    await expect(page.getByTestId("media-step")).toBeVisible();
    await page.getByTestId("wizard-continue").click(); // every media slot is optional

    // Preview renders the SAME reveal sequence a recipient would see —
    // "preview-sender-controls" (the activate button) only appears at the
    // final "ending" beat, by design, not as soon as the step mounts. With no
    // photos/video/audio added, the sequence here is opening -> message -> ending.
    await page.getByTestId("greeting-tap-to-open").click();
    await expect(page.getByTestId("greeting-message-beat")).toBeVisible();
    await page.getByTestId("greeting-continue").click();

    await expect(page.getByTestId("preview-sender-controls")).toBeVisible();
    await page.getByTestId("preview-activate-cta").click();

    await expect(page.getByTestId("checkout-step")).toBeVisible();
    await expect(page.getByTestId("checkout-amount")).toBeVisible();
    await page.getByTestId("checkout-pay").click();

    // simulateTestPaymentAction succeeds -> full reload of /g/{token}, which
    // now resolves as ACTIVE and renders the recipient experience.
    await expect(page.getByTestId("greeting-renderer")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sender-banner")).toBeVisible();
  });

  test("a genuine recipient (no edit-token cookie) sees the reveal but not the sender's own banner", async ({ browser }) => {
    // A separate, cookie-less browser context — the real "someone else opens
    // the same link" case, distinct from the sender revisiting their own tab.
    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto(`/g/${publicToken}`);

    await expect(recipientPage.getByTestId("greeting-renderer")).toBeVisible();
    await expect(recipientPage.getByTestId("sender-banner")).toHaveCount(0);

    await recipientPage.getByTestId("greeting-tap-to-open").click();
    await expect(recipientPage.getByTestId("greeting-message-beat")).toBeVisible();
    await recipientPage.getByTestId("greeting-continue").click();
    await expect(recipientPage.getByTestId("greeting-ending-beat")).toBeVisible();
    // The genuine recipient's ending is the chosen world closing with its finale (Minimal: full stop).
    await expect(recipientPage.getByTestId("greeting-ending-beat")).toHaveAttribute("data-finale", "full-stop");

    await recipientContext.close();
  });
});

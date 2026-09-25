import { test, expect } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

test.describe("KA/EN locale switching", () => {
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

  test("switching language re-renders the page and the choice survives a reload", async ({ page }) => {
    await page.goto(`/g/${publicToken}`);
    // No explicit locale cookie yet, so the very first render can legitimately
    // follow the browser's Accept-Language (Chromium defaults to en-US) rather
    // than src/lib/i18n/config.ts's "ka" default — that's the app's real,
    // intentional fallback order (cookie > Accept-Language > default), not
    // something this test should assume away. Establish a known baseline by
    // switching to Georgian explicitly first.
    await page.getByTestId("locale-ka").click();
    await expect(page.getByTestId("sender-entry")).toContainText("აალაპარაკეთ");
    // A brief settle: each locale switch is a Server Action (cookie write +
    // revalidatePath) followed by an RSC re-render — under `next dev`'s
    // on-demand compilation, firing the next action immediately can race an
    // in-flight recompile (observed directly: a transient Next.js dev-only
    // "clientReferenceManifest" invariant). Not a concern under a production
    // build, which has no on-demand compilation to race.
    await page.waitForTimeout(500);

    await page.getByTestId("locale-en").click();
    await expect(page.getByTestId("sender-entry")).toContainText("Make this gift speak");

    // A fresh navigation (not client-side back/forward) proves the choice was
    // persisted server-side (the NEXT_LOCALE cookie), not just client state.
    await page.goto(`/g/${publicToken}`);
    await expect(page.getByTestId("sender-entry")).toContainText("Make this gift speak");

    await page.getByTestId("locale-ka").click();
    await expect(page.getByTestId("sender-entry")).toContainText("აალაპარაკეთ");
  });
});

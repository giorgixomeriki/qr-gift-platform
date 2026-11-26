import fs from "node:fs";
import postgres from "postgres";
import { test, expect } from "@playwright/test";
import { createAvailableQr, moneyTrailFor } from "./fixtures";
import ka from "../src/messages/ka.json";

/**
 * The sender's downloadable payment + contract confirmation: after a (TEST)
 * payment the sender's note offers the file; it carries the order reference,
 * amount, both consent sentences exactly as accepted and the opening time.
 * A browser without the edit token gets 404. Shots → $SHOTS_DIR.
 */
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });
const SHOTS = process.env.SHOTS_DIR ?? "";

test("sender downloads the confirmation; strangers get 404; scheduled greetings carry the opening time", async ({ page, context, browser }, info) => {
  test.setTimeout(150_000);
  const qr = await createAvailableQr();
  try {
    const base = info.project.use.baseURL!;
    await context.addCookies([{ name: "NEXT_LOCALE", value: "ka", url: base }]);
    await page.goto(`/g/${qr.publicToken}`);
    await page.getByTestId("start-greeting-button").click();
    await page.getByTestId("theme-option-minimal").click();
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("message-textarea").fill("გილოცავ!");
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("preview-watch").click();
    await page.getByTestId("greeting-tap-to-open").click();
    await page.getByTestId("greeting-continue").click();
    await page.getByTestId("preview-activate-cta").click();
    await page.getByTestId("checkout-consent").check();
    await page.getByTestId("checkout-consent-activation").check();
    await page.getByTestId("checkout-pay").click();

    const link = page.getByTestId("download-confirmation");
    await expect(link).toBeVisible({ timeout: 30_000 });
    if (SHOTS) await page.getByTestId("sender-success-banner").screenshot({ path: `${SHOTS}/${info.project.name}-banner-active.png` });

    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toMatch(/^qr-starr-confirmation-[0-9A-F]{8}\.html$/);
    const html = fs.readFileSync((await download.path())!, "utf8");
    if (SHOTS) fs.writeFileSync(`${SHOTS}/${info.project.name}-confirmation.html`, html);

    const [order] = (await moneyTrailFor(qr.publicToken)).orders;
    const ref = order!.id.replace(/-/g, "").slice(0, 8).toUpperCase();
    expect(html).toContain(ref);
    expect(html).toContain(`${(order!.gross_amount_minor / 100).toFixed(2)} GEL`);
    expect(html).toContain(ka.wizard.checkout.legal.consent);
    expect(html).toContain(ka.wizard.checkout.legal.activationConsent);
    const opensRow = "<th>ადრესატისთვის გახსნის დრო</th><td>";
    expect(html).toContain(`${opensRow}გააქტიურებისთანავე`); // opens on activation (no schedule)
    expect(html).not.toContain("<script");
    expect(html).toContain("ხელშეკრულებაზე უარის თქმის უფლებას");
    expect(html).not.toContain("გასვლის უფლება");
    // Art. 12(6): the full Terms and Delivery and Refunds text travel with the confirmation.
    expect(html).toContain("პირობების სრული ტექსტი, რომლებსაც დაეთანხმეთ");
    expect(html).toContain("ხელშეკრულებაზე უარის თქმის უფლება"); // Terms withdrawal section title
    expect(html).toContain("თანხის დაბრუნების"); // refunds policy
    expect(html).not.toMatch(/\{\{|\*\*/); // no raw tokens or markdown

    // Anyone else: 404, nothing revealed.
    const stranger = await browser.newContext({ baseURL: base });
    const res = await stranger.request.get((await link.getAttribute("href"))!);
    expect(res.status()).toBe(404);
    expect(await res.text()).not.toContain(ref);
    await stranger.close();

    // Scheduled Reveal: the sender's waiting-screen note offers the same file, now with the opening time.
    const [g] = await sql<{ id: string }[]>`select g.id from greetings g join qr_codes q on q.id = g.qr_code_id where q.public_token = ${qr.publicToken}`;
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`; // FIXTURE: unlock_at is frozen after DRAFT
      await tx`update greetings set unlock_at = now() + interval '3 days', unlock_time_zone = 'Asia/Tbilisi' where id = ${g!.id}`;
    });
    await page.goto(`/g/${qr.publicToken}`);
    await expect(page.getByTestId("scheduled-sender-banner")).toBeVisible();
    const scheduledLink = page.getByTestId("download-confirmation");
    await expect(scheduledLink).toBeVisible();
    await page.waitForTimeout(5000);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-scheduled.png` });
    const res2 = await page.request.get((await scheduledLink.getAttribute("href"))!);
    expect(res2.status()).toBe(200);
    expect(res2.headers()["content-disposition"]).toContain("attachment");
    const html2 = await res2.text();
    expect(html2).toContain("Asia/Tbilisi");
    expect(html2).not.toContain(`${opensRow}გააქტიურებისთანავე`);
    expect(html2).toMatch(new RegExp(`${opensRow}[^<]*\\(Asia/Tbilisi\\)`));
  } finally {
    await qr.cleanup();
    await sql.end();
  }
});

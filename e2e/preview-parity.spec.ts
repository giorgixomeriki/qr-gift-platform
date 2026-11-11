import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * What the sender previews is what the recipient receives — compared as
 * content, sequence, visual states and behaviour, not pixels (the sender's
 * Preview is embedded in the wizard, the recipient's reveal fills the screen;
 * a pixel diff across the two would measure the frame, not the greeting).
 *
 * For each case one greeting is written, walked through in Preview, paid with
 * the TEST provider and then opened by a stranger. Both walks record, beat by
 * beat: the beat, the world, whether the message is read on the card or as the
 * letter, the exact words shown, the number of photos, how the ending card
 * closes and the closing's letter. The two records must be identical.
 *
 * Needs TEST payments, so it runs against `next dev` (provider-factory.ts
 * refuses TEST in a production build).
 */
test.use({ locale: "en-US" });
test.describe.configure({ mode: "serial" });

const PRINTS = [path.join(__dirname, "fixtures", "print-a.jpg"), path.join(__dirname, "fixtures", "print-b.jpg")];
const LONG_KA =
  "ჩემო ძვირფასო ანა, ყოველი ჩვეულებრივი დღე შენთან ერთად უკეთესია. მინდოდა, ეს წერილი ყვავილებთან ერთად მოსულიყო, რომ დღეს ცოტა უფრო მეტად გაგეღიმა. მახსოვს ჩვენი პირველი ზაფხული ბათუმში, როცა წვიმაში ვიცინოდით და სახლამდე ფეხით მივედით.\n\nმას შემდეგ ბევრი რამ შეიცვალა, მაგრამ შენი სითბო ისევ ისეთივეა 💐 მადლობა, რომ ყოველთვის ჩემ გვერდით ხარ — რთულ დღეებშიც და ბედნიერ წუთებშიც.\n\n— შენი ნინო ❤️";
const SHORT_EN = "Happy anniversary, Lika — ten good years. 🥂";

type Step = { beat: string; composition: string; mode: "card" | "letter" | "none"; words: string; photos: number; ending?: "card" | "signoff"; closing?: string };

async function walk(page: Page): Promise<Step[]> {
  const steps: Step[] = [];
  const renderer = page.getByTestId("greeting-renderer");
  await page.getByTestId("greeting-tap-to-open").click();
  for (let i = 0; i < 12; i++) {
    await expect(renderer).not.toHaveAttribute("data-beat", "opening");
    const beat = (await renderer.getAttribute("data-beat"))!;
    const composition = (await renderer.getAttribute("data-composition"))!;
    if (beat === "ending") {
      await expect(page.getByTestId("greeting-to-closing")).toBeVisible({ timeout: 8_000 });
      const world = page.locator('[data-testid="greeting-ending-beat"] .tw');
      const signoff = (await world.getAttribute("data-signoff")) !== null;
      steps.push({
        beat,
        composition,
        mode: "none",
        words: signoff ? "" : ((await world.locator(".tw__message").textContent()) ?? ""),
        photos: 0,
        ending: signoff ? "signoff" : "card",
        closing: (await page.locator(".sx-letter__text").textContent()) ?? "",
      });
      break;
    }
    const letter = page.getByTestId("greeting-letter");
    const isLetter = beat === "message" && (await letter.count()) > 0;
    steps.push({
      beat,
      composition,
      mode: beat !== "message" ? "none" : isLetter ? "letter" : "card",
      words: beat !== "message" ? "" : isLetter ? ((await letter.locator("p").textContent()) ?? "") : ((await page.locator('[data-testid="greeting-message-beat"] .tw__message').textContent()) ?? ""),
      photos: await page.locator('[data-testid="greeting-photo-beat"] img').count(),
    });
    const next = page.getByTestId("greeting-continue");
    await expect(next).toBeEnabled();
    await next.click();
  }
  return steps;
}

const CASES = [
  { name: "a long Georgian letter with two photos (Romantic)", theme: "romantic", message: LONG_KA, photos: PRINTS, locale: "ka" },
  { name: "a short English note (Wedding)", theme: "wedding", message: SHORT_EN, photos: [] as string[], locale: "en" },
];

for (const c of CASES) {
  test(`preview and recipient tell the same greeting: ${c.name}`, async ({ browser, baseURL }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "one walk per case; the viewport is set explicitly");
    test.setTimeout(180_000);
    const qr = await createAvailableQr();
    try {
      const viewport = { width: 390, height: 844 };
      const senderCtx = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      await senderCtx.addCookies([{ name: "NEXT_LOCALE", value: c.locale, url: baseURL! }]);
      const sender = await senderCtx.newPage();
      await sender.goto(`/g/${qr.publicToken}`);
      await sender.getByTestId("start-greeting-button").click();
      await expect(sender.getByTestId("theme-step")).toBeVisible();
      const saved = sender.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/g/"));
      await sender.getByTestId(`theme-option-${c.theme}`).click();
      await saved;
      await sender.getByTestId("wizard-continue").click();
      await sender.getByTestId("message-textarea").fill(c.message);
      if (c.photos.length) {
        await sender.getByTestId("media-input-photo").setInputFiles(c.photos);
        for (let i = 0; i < c.photos.length; i++) await expect(sender.getByTestId(`media-ready-photo-${i}`)).toBeVisible({ timeout: 30_000 });
      }
      await sender.getByTestId("wizard-continue").click();
      await sender.getByTestId("preview-watch").click();
      const previewed = await walk(sender);
      await sender.getByTestId("preview-activate-cta").click();
      await sender.getByTestId("checkout-pay").click();
      await expect(sender.getByTestId("sender-success-banner")).toBeVisible({ timeout: 20_000 });

      const recipientCtx = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      await recipientCtx.addCookies([{ name: "NEXT_LOCALE", value: c.locale, url: baseURL! }]);
      const recipient = await recipientCtx.newPage();
      await recipient.goto(`/g/${qr.publicToken}`);
      await expect(recipient.getByTestId("greeting-tap-to-open")).toBeEnabled();
      const received = await walk(recipient);

      expect(received).toEqual(previewed);
      // And both hold the sender's exact words.
      const message = previewed.find((s) => s.beat === "message")!;
      expect(message.words).toBe(c.message);
      expect(previewed.at(-1)!.closing).toBe(c.message);
      expect(previewed.filter((s) => s.beat === "photo")).toHaveLength(c.photos.length);
      await senderCtx.close();
      await recipientCtx.close();
    } finally {
      await qr.cleanup();
    }
  });
}

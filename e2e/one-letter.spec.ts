import { test, expect, type Page } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * One complete, readable letter (design-95 Batch 1). Whatever its length,
 * script or shape, the recipient's message is never clipped, never replaced by
 * a shortened copy and never left as a faded copy behind the letter:
 *
 * - a message that fits the card is read on the card (the one visible copy);
 * - a longer one is the whole letter from the first frame of its beat, readable
 *   within 2.5 s of the recipient's tap, scrollable to its last word by touch,
 *   wheel or keyboard, with a labelled "continue reading" control while more
 *   lies below;
 * - the ending never shows a clipped body: the card carries the words only when
 *   they fit, otherwise the world's mark; the closing holds the whole letter.
 *
 * Driven through Preview, which runs the same renderer the recipient gets.
 * Behaviour and text only — no pixel comparisons.
 */

const WORLDS = ["romantic", "birthday", "wedding", "celebration", "elegant", "minimal", "luxury-vintage"] as const;
type World = (typeof WORLDS)[number];

const MAX = 600;
/** Cut to at most `max` UTF-16 units at a word boundary (the server counts `.length`). */
const upTo = (text: string, max = MAX) => (text.length <= max ? text : text.slice(0, text.lastIndexOf(" ", max)).trimEnd());

const KA_PARAGRAPH =
  "ჩემო ძვირფასო ანა, ყოველი ჩვეულებრივი დღე შენთან ერთად უკეთესია. მინდოდა, ეს წერილი ყვავილებთან ერთად მოსულიყო, რომ დღეს ცოტა უფრო მეტად გაგეღიმა. მახსოვს ჩვენი პირველი ზაფხული ბათუმში, როცა წვიმაში ვიცინოდით და სახლამდე ფეხით მივედით. ";
const FIXTURES = {
  /** At the limit: Georgian paragraphs, line breaks and emoji, signed. */
  kaLong: upTo(`${KA_PARAGRAPH}მას შემდეგ ბევრი რამ შეიცვალა, მაგრამ შენი სითბო ისევ ისეთივეა 💐\n\n${KA_PARAGRAPH}${KA_PARAGRAPH}`, MAX - 14) + "\n\n— შენი ნინო ❤️",
  short: "ნინო, გილოცავ! 🎉",
  medium:
    "Dear Mariam,\nThank you for every early morning and every late evening this year. You made the hardest weeks feel lighter, and I don't say it enough. Happy birthday!",
  multiline: "Line one\nLine two\nLine three\nLine four\nLine five\nLine six\nLine seven\nLine eight\nLine nine\nLine ten\nLine eleven\nLine twelve — the end.",
  emoji: "🎂🥂💐✨❤️ ბედნიერ დაბადების დღეს! 🎈🎈🎈 Have the happiest day 🌸🌸 — love from all of us 🤍💛💚💙💜🧡",
  mixed: upTo(
    "გიორგი, Happy anniversary! ათი წელი ერთად — ten years of laughing at the same jokes. გახსოვს Tbilisi-ის ის საღამო, როცა წვიმდა და ჩვენ მაინც ვცეკვავდით? I still have the photo. მადლობა ყველაფრისთვის, thank you for everything. სიყვარულით, Nino.",
    320,
  ),
  unbroken: "ა".repeat(MAX),
  enLong: upTo(
    "My dearest Ana,\n\nI wanted to write this down instead of just saying it. This year you changed jobs, moved across the city and still found time for everyone around you. I don't think you noticed how much you carried — I did. Thank you for the late calls, the soup when I was sick, and for laughing at my terrible jokes. Thank you for the walk along the river in October, for the postcards from Kutaisi and for the way you always remember the small things. I hope this year is kinder to you than the last.\n\nWith all my love, Giorgi",
  ),
} as const;

test.use({ locale: "en-US" });

let cleanup: (() => Promise<void>) | null = null;
test.afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

async function openPreview(page: Page, theme: World, message: string, locale: "ka" | "en" = "ka") {
  expect(message.length).toBeLessThanOrEqual(MAX);
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: test.info().project.use.baseURL! }]);
  const qr = await createAvailableQr();
  cleanup = qr.cleanup;
  await page.goto(`/g/${qr.publicToken}`);
  await page.getByTestId("start-greeting-button").click();
  await expect(page.getByTestId("theme-step")).toBeVisible();
  if (theme !== "minimal") {
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/g/"));
    await page.getByTestId(`theme-option-${theme}`).click();
    await saved;
  }
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("message-textarea").fill(message);
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("preview-watch").click();
  await expect(page.getByTestId("greeting-renderer")).toBeVisible();
  await expect(page.getByTestId("greeting-tap-to-open")).toBeEnabled();
}

/** Every element showing (part of) the message, with its effective opacity — screen-reader-only copies excluded. */
async function visibleCopies(page: Page, message: string) {
  const head = message.slice(0, 12);
  return page.evaluate((head) => {
    const opacity = (e: Element) => {
      let o = 1;
      for (let n: Element | null = e; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === "hidden" || cs.display === "none") return 0;
        o *= Number(cs.opacity);
      }
      return o;
    };
    return [...document.querySelectorAll('[data-testid="greeting-renderer"] p')]
      .filter((p) => !p.closest(".sr-only") && !p.classList.contains("sr-only") && (p.textContent ?? "").startsWith(head))
      .map((p) => ({ cls: p.className, opacity: Math.round(opacity(p) * 100) / 100, text: p.textContent ?? "", rect: p.getBoundingClientRect().height }))
      .filter((c) => c.opacity > 0.05 && c.rect > 0);
  }, head);
}

/** Tap "Open" and return how long until the whole message is readable (fully opaque, every character present). */
async function openAndTime(page: Page, message: string) {
  const t0 = Date.now();
  await page.getByTestId("greeting-tap-to-open").click();
  await page.waitForFunction(
    (message) => {
      const opacity = (e: Element) => {
        let o = 1;
        for (let n: Element | null = e; n && n !== document.body; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.visibility === "hidden" || cs.display === "none") return 0;
          o *= Number(cs.opacity);
        }
        return o;
      };
      const letter = document.querySelector('[data-testid="greeting-letter"] p');
      const card = document.querySelector('[data-testid="greeting-message-beat"] .tw:not([data-letter]):not([data-overflow]) .tw__message');
      const shown = letter ?? card;
      return !!shown && shown.textContent === message && opacity(shown) > 0.9;
    },
    message,
    { timeout: 10_000, polling: 50 },
  );
  return Date.now() - t0;
}

/** The letter (or card) holds every character, nothing runs off the side, and its last words can be reached. */
async function expectWholeAndReachable(page: Page, message: string) {
  const letter = page.getByTestId("greeting-letter");
  if ((await letter.count()) === 0) {
    const card = page.locator('[data-testid="greeting-message-beat"] .tw__message');
    await expect(card).toHaveText(message, { useInnerText: false });
    await expect(page.locator('[data-testid="greeting-message-beat"] .tw')).not.toHaveAttribute("data-overflow", /.*/);
    await expect(page.locator('[data-testid="greeting-message-beat"] .sr-only')).toHaveText(message);
    return { scrolled: false };
  }
  await expect(letter.locator("p")).toHaveText(message, { useInnerText: false });
  const box = await letter.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
  expect(box.sw, "no sideways overflow").toBeLessThanOrEqual(box.cw + 1);
  const scrolls = box.sh > box.ch + 8;
  if (scrolls) await expect(page.getByTestId("greeting-letter-more")).toBeVisible();
  // Scroll to the end: the last character sits inside the sheet's visible box.
  await letter.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const lastInside = await letter.evaluate((el) => {
    const p = el.querySelector("p")!;
    const text = p.firstChild!;
    const range = document.createRange();
    range.setStart(text, Math.max(0, text.textContent!.length - 1));
    range.setEnd(text, text.textContent!.length);
    const r = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return r.bottom <= box.bottom + 1 && r.top >= box.top - 1;
  });
  expect(lastInside, "the last word can be reached").toBe(true);
  if (scrolls) await expect(page.getByTestId("greeting-letter-more")).toHaveCount(0); // gone at the end
  return { scrolled: scrolls };
}

/** Continue to the ending: the card never carries a clipped body; the closing holds the whole letter. */
async function expectEndingAndClosing(page: Page, message: string, long: boolean) {
  for (let i = 0; i < 10; i++) {
    if ((await page.getByTestId("greeting-renderer").getAttribute("data-beat")) === "ending") break;
    const next = page.getByTestId("greeting-continue");
    await expect(next).toBeEnabled();
    await next.click();
  }
  const ending = page.getByTestId("greeting-ending-beat");
  await expect(ending).toBeVisible();
  const world = ending.locator(".tw");
  if (long) {
    await expect(world).toHaveAttribute("data-signoff", "");
    await expect(world.locator(".tw__message")).toBeHidden();
  } else {
    await expect(world).not.toHaveAttribute("data-signoff", /.*/);
  }
  await expect(world).not.toHaveAttribute("data-overflow", /.*/);
  await expect(page.getByTestId("greeting-to-closing")).toBeVisible({ timeout: 8_000 });
  // No faded copy of the words anywhere once the finale rests (Wedding's vellum included).
  const ghosts = (await visibleCopies(page, message)).filter((c) => c.opacity < 0.9 && !c.cls.includes("sx-letter__text"));
  expect(ghosts, "no faded copy of the message").toEqual([]);
  await expect(page.locator(".sx-letter__text")).toHaveText(message, { useInnerText: false });
}

test.describe("One complete, readable letter — every world, at the limit (Georgian, line breaks, emoji)", () => {
  for (const world of WORLDS) {
    test(`${world}: the whole letter within 2.5 s, one copy, reachable to the last word, never clipped at the end`, async ({ page }) => {
      test.setTimeout(90_000);
      const message = FIXTURES.kaLong;
      await openPreview(page, world, message);
      const ms = await openAndTime(page, message);
      expect(ms, `readable ${ms} ms after the tap`).toBeLessThanOrEqual(2_500);
      const beat = page.getByTestId("greeting-message-beat");
      await expect(beat.locator(".tw")).toHaveAttribute("data-letter", "");
      const copies = await visibleCopies(page, message);
      expect(copies.map((c) => c.cls), "exactly one visible copy").toHaveLength(1);
      await expectWholeAndReachable(page, message);
      await expectEndingAndClosing(page, message, true);
    });
  }
});

test.describe("One complete, readable letter — message shapes", () => {
  const CASES: { name: string; world: World; message: string; locale: "ka" | "en"; long: boolean | "either" }[] = [
    { name: "short, with an emoji", world: "minimal", message: FIXTURES.short, locale: "ka", long: false },
    { name: "medium, English", world: "romantic", message: FIXTURES.medium, locale: "en", long: "either" },
    { name: "multiline (12 lines)", world: "wedding", message: FIXTURES.multiline, locale: "en", long: "either" },
    { name: "emoji-rich", world: "birthday", message: FIXTURES.emoji, locale: "ka", long: "either" },
    { name: "mixed Georgian and English", world: "celebration", message: FIXTURES.mixed, locale: "ka", long: "either" },
    { name: "one unbroken 600-character string", world: "elegant", message: FIXTURES.unbroken, locale: "ka", long: true },
    { name: "long, English, at the limit", world: "luxury-vintage", message: FIXTURES.enLong, locale: "en", long: true },
  ];
  for (const c of CASES) {
    test(`${c.name} (${c.world}, ${c.locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      await openPreview(page, c.world, c.message, c.locale);
      const ms = await openAndTime(page, c.message);
      expect(ms, `readable ${ms} ms after the tap`).toBeLessThanOrEqual(2_500);
      const isLetter = (await page.getByTestId("greeting-letter").count()) > 0;
      if (c.long !== "either") expect(isLetter).toBe(c.long);
      expect(await visibleCopies(page, c.message), "exactly one visible copy").toHaveLength(1);
      await expectWholeAndReachable(page, c.message);
      await expectEndingAndClosing(page, c.message, isLetter);
    });
  }
});

test.describe("One complete, readable letter — reduced motion and keyboard", () => {
  test("reduced motion: the letter is there at once, no ghost in the Wedding ending (long and short)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const message of [FIXTURES.kaLong, FIXTURES.short]) {
      await openPreview(page, "wedding", message);
      const ms = await openAndTime(page, message);
      expect(ms, `readable ${ms} ms after the tap`).toBeLessThanOrEqual(1_200);
      expect(await visibleCopies(page, message)).toHaveLength(1);
      await expectEndingAndClosing(page, message, message === FIXTURES.kaLong);
      await cleanup?.();
      cleanup = null;
    }
  });

  test("keyboard: the letter takes focus, scrolls by keys, and 'continue reading' is a labelled button", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 700 });
    await openPreview(page, "romantic", FIXTURES.kaLong);
    await page.getByTestId("greeting-tap-to-open").focus();
    await page.keyboard.press("Enter");
    const letter = page.getByTestId("greeting-letter");
    await expect(letter).toBeVisible({ timeout: 2_500 });
    await expect(letter).toHaveAttribute("aria-label", /.+/);
    const more = page.getByTestId("greeting-letter-more");
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute("aria-controls", (await letter.getAttribute("id"))!);
    // The button moves the reading on.
    await more.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => letter.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // The sheet itself scrolls by keyboard to its end, where the control leaves.
    await letter.focus();
    await page.keyboard.press("End");
    await expect.poll(() => letter.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(8);
    await expect(more).toHaveCount(0);
  });
});

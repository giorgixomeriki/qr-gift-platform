import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { test, expect, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * "Our Song" with YouTube / YouTube Music and the provider-metadata card
 * (docs/music/OUR-SONG.md). Run twice (playwright.music.config.ts):
 *  - MUSIC_META unset — production default: link-only card, no provider call.
 *  - MUSIC_META=1     — real oEmbed lookups: provider title / channel / artwork.
 * Covers sender field + preview + payment, recipients on desktop, Android
 * (Pixel 7) and iPhone (WebKit), KA/EN, an existing Spotify greeting, an
 * unavailable video, all seven worlds, Scheduled Reveal and Refund Model C.
 * DB rows are only moved by marked FIXTURE writes. Screenshots → $MUSIC_SHOTS.
 */
const META = process.env.MUSIC_META === "1";
const SHOTS = process.env.MUSIC_SHOTS ?? "";
const VID = "dQw4w9WgXcQ"; // public, long-lived
const GONE = "AAAAAAAAAAA"; // oEmbed 404
const SPOTIFY_TRACK = "4cOdK2wGLETKBW3PvgPWqT";
const MESSAGE = "For the drive to Kazbegi — turn it up 9K.";
const THEMES = ["romantic", "birthday", "celebration", "elegant", "luxury-vintage", "minimal", "wedding"];

const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });
const musicRows = (token: string) => sql<{ text_value: string }[]>`
  select c.text_value from greeting_content c join greetings g on g.id = c.greeting_id join qr_codes q on q.id = g.qr_code_id
   where q.public_token = ${token} and c.type = 'music'`;
/** FIXTURE writes (superuser; replica role skips the post-DRAFT freeze triggers). */
async function fixture(statement: string) {
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx.unsafe(statement);
  });
}
const gid = async (token: string) => (await sql`select g.id from greetings g join qr_codes q on q.id = g.qr_code_id where q.public_token = ${token}`)[0]!.id as string;

async function shot(page: Page, name: string, locator?: ReturnType<Page["locator"]>) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${META ? "meta" : "link"}-${name}.png`);
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file });
}

async function walkToMusicBeat(page: Page) {
  await page.getByTestId("greeting-tap-to-open").click();
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId("greeting-music-beat").isVisible()) return;
    const next = page.getByTestId("greeting-continue");
    await expect(next).toBeEnabled({ timeout: 15_000 });
    await next.click();
  }
  throw new Error("music beat never arrived");
}

async function recipient(browser: Browser, token: string, opts: { locale?: "ka" | "en"; device?: (typeof devices)[string] } = {}) {
  const ctx = await browser.newContext({ ...(opts.device ?? devices["Desktop Chrome"]), reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: opts.locale ?? "en", url: test.info().project.use.baseURL! }]);
  const page = await ctx.newPage();
  const providerCalls: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/spotify|youtube|ytimg|scdn/.test(new URL(u).hostname)) providerCalls.push(u);
  });
  const res = await page.goto(`/g/${token}`);
  return { ctx, page, res, providerCalls };
}

/** Artwork state: META → loaded provider image with real pixels; else no image at all (our sleeve). */
async function expectArtwork(card: ReturnType<Page["locator"]>, present: boolean) {
  const img = card.getByTestId("music-artwork");
  if (!present) return expect(img).toHaveCount(0);
  await expect(card).toHaveAttribute("data-art", "ready", { timeout: 20_000 });
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await img.getAttribute("referrerpolicy")).toBe("no-referrer");
}
async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.describe.configure({ mode: "serial" });

test.describe(`Our Song providers — metadata ${META ? "ON" : "OFF"}`, () => {
  let token = "";
  let cleanup: () => Promise<void> = async () => {};
  let sender: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }, info) => {
    const qr = await createAvailableQr();
    token = qr.publicToken;
    cleanup = qr.cleanup;
    sender = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: info.project.use.baseURL });
    await sender.addCookies([{ name: "NEXT_LOCALE", value: "en", url: info.project.use.baseURL! }]);
    page = await sender.newPage();
  });
  test.afterAll(async () => {
    await sender?.close();
    await cleanup();
    await sql.end();
  });

  test("sender: YouTube links validated, normalised and saved; preview shows the card; pay", async () => {
    test.setTimeout(300_000);
    await page.goto(`/g/${token}`);
    // Clicks before hydration are lost on a loaded dev machine: retry each step until it lands.
    await expect(async () => {
      if (await page.getByTestId("start-greeting-button").isVisible()) await page.getByTestId("start-greeting-button").click();
      await expect(page.getByTestId("theme-option-romantic")).toBeVisible({ timeout: 8_000 });
    }).toPass({ timeout: 90_000 });
    await expect(async () => {
      await page.getByTestId("theme-option-romantic").click();
      await page.getByTestId("wizard-continue").click();
      await expect(page.getByTestId("create-step")).toBeVisible({ timeout: 8_000 });
    }).toPass({ timeout: 90_000 });

    await page.getByTestId("music-add").click();
    for (const [link, msg] of [
      ["https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs", /Only one song/],
      [`https://www.youtube.com.evil.example/watch?v=${VID}`, /isn't a Spotify or YouTube link/],
      [`https://youtu.be/${VID}"><img src=x onerror=alert(1)>`, /couldn't read that link/],
      ["https://www.youtube.com/@RickAstleyYT", /Only one song/],
    ] as const) {
      await page.getByTestId("music-input").fill(link);
      await page.getByTestId("music-save").click();
      await expect(page.getByTestId("music-error")).toHaveText(msg);
    }
    expect(await musicRows(token)).toHaveLength(0);

    const cases: [string, string, string, string][] = [
      [`https://youtu.be/${VID}?si=Xyz123tracking`, `youtube:video:${VID}`, "Video on YouTube", `https://www.youtube.com/watch?v=${VID}`],
      [`https://www.youtube.com/shorts/${VID}?feature=share`, `youtube:video:${VID}`, "Video on YouTube", `https://www.youtube.com/watch?v=${VID}`],
      [`https://www.youtube.com/watch?v=${VID}&t=43s&list=RDdQw4w9WgXcQ`, `youtube:video:${VID}`, "Video on YouTube", `https://www.youtube.com/watch?v=${VID}`],
      [`https://music.youtube.com/watch?v=${VID}&si=abc`, `youtube:music:${VID}`, "Song on YouTube Music", `https://music.youtube.com/watch?v=${VID}`],
    ];
    for (const [i, [link, stored, label, href]] of cases.entries()) {
      if (i > 0) await page.getByTestId("music-replace").click();
      await page.getByTestId("music-input").fill(link);
      await page.getByTestId("music-save").click();
      const saved = page.getByTestId("music-saved");
      await expect(saved).toContainText(label);
      await expect(saved).toHaveAttribute("data-provider", "youtube");
      await expect(page.getByTestId("music-check")).toHaveAttribute("href", href);
      expect(await musicRows(token)).toEqual([{ text_value: stored }]);
    }
    if (META) await expect(page.getByTestId("music-saved-title")).toContainText("Never Gonna Give You Up");
    else await expect(page.getByTestId("music-saved-title")).toHaveCount(0);
    await shot(page, "sender-field-desktop", page.getByTestId("music-field"));

    // Survives a reload (server re-reads and re-validates it).
    await page.reload();
    await expect(page.getByTestId("music-saved")).toContainText("Song on YouTube Music");

    await page.getByTestId("message-textarea").fill(MESSAGE);
    // Under heavy load a click can land before hydration finishes: retry until Preview is up.
    await expect(async () => {
      await page.getByTestId("wizard-continue").click();
      await expect(page.getByTestId("preview-step")).toBeVisible({ timeout: 8_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByTestId("preview-watch").click();
    await walkToMusicBeat(page);
    const beat = page.getByTestId("greeting-music-beat");
    await expect(beat.getByTestId("music-listen")).toHaveAttribute("href", `https://music.youtube.com/watch?v=${VID}`);
    await expect(beat.getByTestId("music-listen")).toContainText("Listen on YouTube Music");
    await expect(beat.getByTestId("music-source")).toContainText("YouTube Music");
    await expectArtwork(beat, META);
    if (META) await expect(beat.getByTestId("music-author")).toHaveText("Rick Astley");
    await shot(page, "sender-preview-desktop");
    await page.getByTestId("preview-close").click();

    await page.getByTestId("preview-activate-cta").click();
    await page.getByTestId("checkout-consent").check();
    await page.getByTestId("checkout-consent-activation").check();
    await page.getByTestId("checkout-pay").click();
    await expect(page.getByTestId("sender-success-banner")).toBeVisible({ timeout: 20_000 });
  });

  for (const [name, device, locale] of [
    ["desktop-en", devices["Desktop Chrome"], "en"],
    ["pixel7-ka", devices["Pixel 7"], "ka"],
    ["iphone14-webkit-en", devices["iPhone 14"], "en"],
  ] as const) {
    test(`recipient ${name}: beat + keepsake, provider link, no autoplay, no frames`, async ({ browser }) => {
      // iPhone needs WebKit: launch it explicitly (the project is Chromium).
      const b = name.includes("webkit") ? await (await import("@playwright/test")).webkit.launch() : browser;
      const { ctx, page: r, providerCalls } = await recipient(b, token, { device, locale });
      await walkToMusicBeat(r);
      const beat = r.getByTestId("greeting-music-beat");
      await expect(beat).toHaveAttribute("data-service", "youtubeMusic");
      await expect(beat.getByTestId("music-listen")).toHaveAttribute("href", `https://music.youtube.com/watch?v=${VID}`);
      await expect(beat.getByTestId("music-listen")).toHaveAttribute("rel", /noopener/);
      await expect(beat.getByTestId("music-listen")).toContainText(locale === "ka" ? "მოუსმინე YouTube Music-ზე" : "Listen on YouTube Music");
      await expectArtwork(beat, META);
      if (META) await expect(beat.getByTestId("music-title")).toContainText("Never Gonna Give You Up");
      else await expect(beat).toContainText(locale === "ka" ? "ჩვენი სიმღერა" : "Our Song");
      await expect(r.locator("iframe")).toHaveCount(0);
      expect(await r.locator("audio, video").evaluateAll((els) => els.every((e) => (e as HTMLMediaElement).paused))).toBe(true);
      await noHorizontalScroll(r);
      // Flag off → the browser never talks to a provider; on → only the artwork host.
      if (!META) expect(providerCalls).toEqual([]);
      else expect(providerCalls.every((u) => u.startsWith("https://i.ytimg.com/vi/"))).toBe(true);
      await r.waitForTimeout(300);
      await shot(r, `recipient-beat-${name}`);
      await r.getByTestId("greeting-continue").click();
      const keep = r.getByTestId("greeting-music-keepsake");
      await expect(keep).toBeVisible({ timeout: 15_000 });
      await keep.scrollIntoViewIfNeeded();
      await expectArtwork(keep, META);
      await shot(r, `recipient-keepsake-${name}`, keep);
      await ctx.close();
      if (b !== browser) await b.close();
    });
  }

  test("all seven worlds render the card the same way", async ({ browser }) => {
    test.setTimeout(240_000);
    const g = await gid(token);
    try {
      for (const theme of THEMES) {
        await fixture(`update greetings set theme_id = (select id from themes where key = '${theme}') where id = '${g}'`);
        const { ctx, page: r } = await recipient(browser, token, { device: devices["Pixel 7"] });
        await walkToMusicBeat(r);
        const beat = r.getByTestId("greeting-music-beat");
        await expect(beat.getByTestId("music-listen")).toBeVisible();
        await expectArtwork(beat, META);
        await noHorizontalScroll(r);
        await r.waitForTimeout(300);
        await shot(r, `theme-${theme}`);
        await ctx.close();
      }
    } finally {
      await fixture(`update greetings set theme_id = (select id from themes where key = 'romantic') where id = '${g}'`);
    }
  });

  test("an existing Spotify greeting still opens as our sleeve + link (never Spotify artwork)", async ({ browser }) => {
    const g = await gid(token);
    await fixture(`update greeting_content set text_value = 'spotify:track:${SPOTIFY_TRACK}' where greeting_id = '${g}' and type = 'music'`);
    try {
      const { ctx, page: r } = await recipient(browser, token, { device: devices["Pixel 7"] });
      await walkToMusicBeat(r);
      const beat = r.getByTestId("greeting-music-beat");
      await expect(beat).toHaveAttribute("data-spotify-id", SPOTIFY_TRACK);
      await expect(beat.getByTestId("music-listen")).toHaveAttribute("href", `https://open.spotify.com/track/${SPOTIFY_TRACK}`);
      await expect(beat.getByTestId("music-listen")).toContainText("Listen on Spotify");
      await expectArtwork(beat, false);
      // Spotify metadata is never fetched (policy): no artist, no title from Spotify.
      await expect(beat.getByTestId("music-author")).toHaveCount(0);
      await expect(beat.getByTestId("music-title")).toHaveCount(0);
      await r.waitForTimeout(300);
      await shot(r, "spotify-existing-pixel7");
      await ctx.close();
    } finally {
      await fixture(`update greeting_content set text_value = 'youtube:music:${VID}' where greeting_id = '${g}' and type = 'music'`);
    }
  });

  test("an unavailable video never stops the greeting opening", async ({ browser }) => {
    const g = await gid(token);
    await fixture(`update greeting_content set text_value = 'youtube:video:${GONE}' where greeting_id = '${g}' and type = 'music'`);
    try {
      const { ctx, page: r } = await recipient(browser, token, { device: devices["iPhone 14"] });
      await walkToMusicBeat(r);
      const beat = r.getByTestId("greeting-music-beat");
      await expect(beat).toHaveAttribute("data-meta", META ? "unavailable" : "none");
      await expect(beat.getByTestId("music-artwork")).toHaveCount(0);
      await expect(beat.getByTestId("music-note")).toContainText(META ? "may no longer be available" : "Opens in YouTube");
      await expect(beat.getByTestId("music-listen")).toHaveAttribute("href", `https://www.youtube.com/watch?v=${GONE}`);
      await r.waitForTimeout(300);
      await shot(r, "youtube-unavailable");
      await ctx.close();
    } finally {
      await fixture(`update greeting_content set text_value = 'youtube:music:${VID}' where greeting_id = '${g}' and type = 'music'`);
    }
  });

  test("Scheduled Reveal: before the moment, nothing about the song reaches the page", async ({ browser }) => {
    const g = await gid(token);
    await fixture(`update greetings set unlock_at = now() + interval '2 days', unlock_time_zone = 'Asia/Tbilisi' where id = '${g}'`);
    try {
      const { ctx, page: r, res, providerCalls } = await recipient(browser, token);
      await expect(r.getByTestId("scheduled-reveal")).toBeVisible();
      const html = (await res!.text()) + (await r.content());
      for (const s of [VID, "music.youtube.com/watch", "Never Gonna", "Rick Astley", MESSAGE]) expect(html).not.toContain(s);
      await expect(r.getByTestId("greeting-music-beat")).toHaveCount(0);
      expect(providerCalls).toEqual([]);
      await ctx.close();
    } finally {
      await fixture(`update greetings set unlock_at = null, unlock_time_zone = null where id = '${g}'`);
    }
  });

  test("Refund Model C: a suspended greeting shows nothing about the song", async ({ browser }) => {
    // FIXTURE: REFUNDED is terminal for the app role (trigger); the replica-role fixture flips it and back.
    await fixture(`update orders set status = 'REFUNDED' where qr_code_id = (select id from qr_codes where public_token = '${token}') and status = 'PAID'`);
    try {
      const { ctx, page: r, res, providerCalls } = await recipient(browser, token);
      const html = (await res!.text()) + (await r.content());
      for (const s of [VID, "music.youtube.com/watch", "Never Gonna", "Rick Astley", MESSAGE]) expect(html).not.toContain(s);
      await expect(r.getByTestId("greeting-music-beat")).toHaveCount(0);
      expect(providerCalls).toEqual([]);
      await ctx.close();
    } finally {
      await fixture(`update orders set status = 'PAID' where qr_code_id = (select id from qr_codes where public_token = '${token}') and status = 'REFUNDED'`);
    }
  });
});

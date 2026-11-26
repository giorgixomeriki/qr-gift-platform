import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { test, expect, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createAvailableQr } from "./fixtures";

/**
 * "Our Song" (docs/music/OUR-SONG.md): a sender attaches one Spotify track or
 * playlist; it is saved with the greeting, survives reloads and edits of
 * everything else, appears in Preview and checkout, and after activation the
 * recipient gets the keepsake with a working "Listen on Spotify" link —
 * alongside text, photos, video and a voice note. Nothing reaches Spotify:
 * link-only (embed flag off), so no iframe may exist.
 */
const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
const LIST = "37i9dQZF1DXcBWIGoYBM5M";
const VOICE = path.join(__dirname, "fixtures", "loud-then-quiet.m4a");
const PRINT = path.join(__dirname, "fixtures", "print-a.jpg");
const CLIP = path.join(__dirname, "fixtures", "clip-1s.mp4");
const MESSAGE = "Nino — this one is ours. Press play when you're ready.";

const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });
async function musicRows(publicToken: string) {
  return sql<{ text_value: string; slot: number; status: string }[]>`
    select c.text_value, c.slot, c.status from greeting_content c
      join greetings g on g.id = c.greeting_id join qr_codes q on q.id = g.qr_code_id
     where q.public_token = ${publicToken} and c.type = 'music'`;
}

async function startDraft(page: Page, token: string) {
  await page.goto(`/g/${token}`);
  await page.getByTestId("start-greeting-button").click();
  await expect(page.getByTestId("theme-step")).toBeVisible();
  await page.getByTestId("theme-option-romantic").click();
  await page.getByTestId("wizard-continue").click();
  await expect(page.getByTestId("create-step")).toBeVisible();
}

async function addMusic(page: Page, link: string) {
  const add = page.getByTestId("music-add");
  if (await add.isVisible()) await add.click();
  else await page.getByTestId("music-replace").click();
  await page.getByTestId("music-input").fill(link);
  await page.getByTestId("music-save").click();
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
  const ctx = await browser.newContext({ ...(opts.device ?? {}), reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: opts.locale ?? "en", url: test.info().project.use.baseURL! }]);
  const page = await ctx.newPage();
  await page.goto(`/g/${token}`);
  return { ctx, page };
}

test.describe.configure({ mode: "serial" });

test.describe("Our Song — Spotify link keepsake", () => {
  let token: string;
  let cleanup: () => Promise<void>;
  /** The sender's browser: one context for all sender steps, so the draft's edit cookie carries over. */
  let sender: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "one greeting serves the group; phones are explicit contexts");
    const qr = await createAvailableQr();
    token = qr.publicToken;
    cleanup = qr.cleanup;
    sender = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: info.project.use.baseURL });
    await sender.addCookies([{ name: "NEXT_LOCALE", value: "en", url: info.project.use.baseURL! }]);
    page = await sender.newPage();
  });
  test.afterAll(async () => {
    await sender?.close();
    await cleanup?.();
    await sql.end();
  });

  test("sender: invalid links are refused with the reason, nothing is saved", async () => {
    test.setTimeout(90_000);
    await startDraft(page, token);
    await page.getByTestId("message-textarea").fill(MESSAGE);

    const cases: [string, RegExp][] = [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", /isn't a Spotify link/],
      [`https://open.spotify.com.evil.example/track/${TRACK}`, /isn't a Spotify link/],
      [`javascript:alert(1)//open.spotify.com/track/${TRACK}`, /isn't a Spotify link/],
      [`https://open.spotify.com/album/${TRACK}`, /Only a song or a playlist/],
      ["https://spotify.link/AbCdEf123", /Short links/],
      [`https://open.spotify.com/track/${TRACK}"><img src=x onerror=alert(1)>`, /couldn't read that link/],
    ];
    await page.getByTestId("music-add").click();
    for (const [link, msg] of cases) {
      await page.getByTestId("music-input").fill(link);
      await page.getByTestId("music-save").click();
      await expect(page.getByTestId("music-error")).toHaveText(msg);
    }
    await page.getByTestId("music-cancel").click();
    expect(await musicRows(token)).toHaveLength(0);
  });

  test("sender: add, persist across reload, replace, edit the message, remove, re-add", async () => {
    test.setTimeout(90_000);
    await page.goto(`/g/${token}?step=create`);
    await expect(page.getByTestId("create-step")).toBeVisible();

    await addMusic(page, `https://open.spotify.com/intl-ka/track/${TRACK}?si=abc123`);
    const saved = page.getByTestId("music-saved");
    await expect(saved).toHaveAttribute("data-spotify-id", TRACK);
    await expect(saved).toContainText("Song on Spotify");
    await expect(page.getByTestId("music-check")).toHaveAttribute("href", `https://open.spotify.com/track/${TRACK}`);
    // Only the canonical reference is stored — never the pasted text.
    expect(await musicRows(token)).toEqual([{ text_value: `spotify:track:${TRACK}`, slot: 0, status: "READY" }]);

    await page.reload();
    await expect(page.getByTestId("music-saved")).toHaveAttribute("data-spotify-id", TRACK);

    await addMusic(page, `https://open.spotify.com/playlist/${LIST}`);
    await expect(page.getByTestId("music-saved")).toHaveAttribute("data-kind", "playlist");
    expect(await musicRows(token)).toEqual([{ text_value: `spotify:playlist:${LIST}`, slot: 0, status: "READY" }]);

    // Editing the message (autosave) never drops the song.
    await page.getByTestId("message-textarea").fill(MESSAGE + " Always.");
    await page.waitForTimeout(2200);
    await page.reload();
    await expect(page.getByTestId("message-textarea")).toHaveValue(MESSAGE + " Always.");
    await expect(page.getByTestId("music-saved")).toHaveAttribute("data-spotify-id", LIST);

    await page.getByTestId("music-remove").click();
    await expect(page.getByTestId("music-add")).toBeVisible();
    expect(await musicRows(token)).toHaveLength(0);
    await page.reload();
    await expect(page.getByTestId("music-add")).toBeVisible();

    await addMusic(page, `spotify:track:${TRACK}`);
    await expect(page.getByTestId("music-saved")).toHaveAttribute("data-spotify-id", TRACK);
  });

  test("sender: music with photo, video and voice; Preview and checkout show it; activation", async () => {
    test.setTimeout(150_000);
    await page.goto(`/g/${token}?step=create`);
    await expect(page.getByTestId("music-saved")).toBeVisible();

    await page.getByTestId("media-input-photo").setInputFiles(PRINT);
    await page.getByTestId("media-input-video").setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: fs.readFileSync(CLIP) });
    await page.getByTestId("add-audio").click();
    await page.getByTestId("voice-file-input").setInputFiles({ name: "voice-note.m4a", mimeType: "audio/mp4", buffer: fs.readFileSync(VOICE) });
    await expect(page.getByTestId("media-ready-photo-0")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("media-ready-video-0")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("media-ready-audio-0")).toBeVisible({ timeout: 30_000 });
    // Uploads don't disturb the song.
    await expect(page.getByTestId("music-saved")).toHaveAttribute("data-spotify-id", TRACK);

    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("preview-step")).toBeVisible();
    await expect(page.getByTestId("preview-contents")).toContainText("song");

    // The sender's own "see it as the recipient" shows the same keepsake.
    await page.getByTestId("preview-watch").click();
    await walkToMusicBeat(page);
    await expect(page.getByTestId("music-listen")).toHaveAttribute("href", `https://open.spotify.com/track/${TRACK}`);
    await page.getByTestId("preview-close").click();

    await page.getByTestId("preview-activate-cta").click();
    await expect(page.getByTestId("checkout-step")).toContainText("song");
    // Consent is mandatory before payment (0023_checkout_consents).
    await expect(page.getByTestId("checkout-pay")).toBeDisabled();
    await page.getByTestId("checkout-consent").check();
    await page.getByTestId("checkout-consent-activation").check();
    await page.getByTestId("checkout-pay").click();
    await expect(page.getByTestId("sender-success-banner")).toBeVisible({ timeout: 20_000 });
  });

  test("recipient (EN, desktop): the music beat and the closing keepsake carry the saved song", async ({ browser }) => {
    test.setTimeout(90_000);
    const { ctx, page } = await recipient(browser, token);
    await walkToMusicBeat(page);

    const beat = page.getByTestId("greeting-music-beat");
    await expect(beat).toHaveAttribute("data-spotify-id", TRACK);
    await expect(beat).toContainText("Our Song");
    const listen = beat.getByTestId("music-listen");
    await expect(listen).toHaveAttribute("href", `https://open.spotify.com/track/${TRACK}`);
    await expect(listen).toHaveAttribute("target", "_blank");
    await expect(listen).toHaveAttribute("rel", /noopener/);
    await expect(listen).toContainText("Listen on Spotify");
    // Link-only: no embed, no frame, no Spotify request while the flag is off.
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.getByTestId("music-play-here")).toHaveCount(0);
    // Nothing plays by itself: the voice note and film stay paused.
    expect(await page.locator("audio, video").evaluateAll((els) => els.every((e) => (e as HTMLMediaElement).paused))).toBe(true);

    await page.getByTestId("greeting-continue").click();
    await expect(page.getByTestId("greeting-closing")).toBeVisible({ timeout: 15_000 });
    const keep = page.getByTestId("greeting-music-keepsake");
    await expect(keep).toHaveAttribute("data-spotify-id", TRACK);
    await expect(keep.getByTestId("music-listen")).toHaveAttribute("href", `https://open.spotify.com/track/${TRACK}`);
    // Voice and video keepsakes are still there beside it.
    await expect(page.getByTestId("greeting-closing").locator("audio")).toHaveCount(1);
    await expect(page.getByTestId("greeting-closing").locator("video")).toHaveCount(1);
    await ctx.close();
  });

  test("recipient: playing the voice note, then 'Listen on Spotify' pauses it", async ({ browser }) => {
    test.setTimeout(90_000);
    const { ctx, page } = await recipient(browser, token);
    await walkToMusicBeat(page);
    await page.getByTestId("greeting-continue").click();
    await expect(page.getByTestId("greeting-closing")).toBeVisible({ timeout: 15_000 });
    const audio = page.getByTestId("greeting-closing").locator("audio");
    await audio.evaluate((a: HTMLAudioElement) => {
      a.muted = true;
      return a.play();
    });
    expect(await audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
    // Keep the click in this tab (the popup itself is Spotify's business).
    const popup = ctx.waitForEvent("page").catch(() => null);
    await page.getByTestId("greeting-music-keepsake").getByTestId("music-listen").click({ modifiers: [] });
    expect(await audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
    const opened = await Promise.race([popup, new Promise((r) => setTimeout(() => r(null), 3000))]);
    if (opened) await (opened as Page).close();
    await ctx.close();
  });

  test("recipient (KA): Georgian keepsake copy", async ({ browser }) => {
    test.setTimeout(60_000);
    const { ctx, page } = await recipient(browser, token, { locale: "ka" });
    await walkToMusicBeat(page);
    const beat = page.getByTestId("greeting-music-beat");
    await expect(beat).toContainText("ჩვენი სიმღერა");
    await expect(beat.getByTestId("music-listen")).toContainText("მოუსმინე Spotify-ზე");
    await ctx.close();
  });

  for (const name of ["Pixel 7", "iPhone 13"] as const) {
    test(`recipient (${name}): keepsake fits the phone, no sideways scroll, link works`, async ({ browser, playwright }) => {
      test.setTimeout(120_000);
      const device = devices[name];
      // iPhone profiles run on WebKit; Pixel on Chromium.
      const engine = name === "iPhone 13" ? await playwright.webkit.launch() : browser;
      const { ctx, page } = await recipient(engine, token, { device });
      await walkToMusicBeat(page);
      const beat = page.getByTestId("greeting-music-beat");
      await expect(beat.getByTestId("music-listen")).toHaveAttribute("href", `https://open.spotify.com/track/${TRACK}`);
      const box = await beat.boundingBox();
      const vw = page.viewportSize()!.width;
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const tap = await beat.getByTestId("music-listen").boundingBox();
      expect(tap!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: test.info().outputPath(`music-beat-${name.replace(/\s/g, "-")}.png`) });
      await ctx.close();
      if (engine !== browser) await engine.close();
    });
  }
});

/**
 * Phone keyboard: Android Chrome shrinks the page by the keyboard
 * (interactive-widget=resizes-content), which used to leave the input and its
 * buttons under the sticky Continue. With the form open the dock steps aside,
 * the form follows the keyboard, and a real tap (by coordinates) on "Add song"
 * reaches it. Then the row confirms the save.
 */
test.describe("Our Song — song field with the phone keyboard up", () => {
  test("input, Cancel and Add stay above the keyboard and uncovered; saving is confirmed", async ({ browser }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "explicit phone contexts below");
    for (const vp of [
      { width: 360, height: 640, kb: 290 },
      { width: 412, height: 915, kb: 330 },
    ]) {
      const qr = await createAvailableQr();
      const ctx = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: vp.width, height: vp.height }, baseURL: info.project.use.baseURL, reducedMotion: "reduce" });
      try {
        const page = await ctx.newPage();
        await startDraft(page, qr.publicToken);
        await page.getByTestId("message-textarea").fill(MESSAGE);
        await page.getByTestId("music-add").scrollIntoViewIfNeeded();
        await page.getByTestId("music-add").click();
        await expect(page.getByTestId("music-input")).toBeFocused();
        await page.setViewportSize({ width: vp.width, height: vp.height - vp.kb });
        await page.getByTestId("music-input").fill(`https://open.spotify.com/track/${TRACK}?si=kb`);
        await page.waitForTimeout(800);

        for (const id of ["music-input", "music-cancel", "music-save"]) {
          const state = await page.evaluate((testId) => {
            const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { inView: r.top >= 0 && r.bottom <= window.innerHeight, hit: !!hit && (hit === el || el.contains(hit)) };
          }, id);
          expect(state, `${id} at ${vp.width}x${vp.height - vp.kb}`).toEqual({ inView: true, hit: true });
        }
        await expect(page.getByTestId("music-save")).toHaveText("Add song");

        const box = (await page.getByTestId("music-save").boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(page.getByTestId("music-saved")).toHaveAttribute("data-just-saved", "true");
        await expect(page.getByTestId("music-confirm")).toHaveText("Added to your greeting");
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // the Continue dock is back and the confirmed row is not under it
        await expect(page.getByTestId("music-saved")).toBeInViewport();
        await page.reload();
        await expect(page.getByTestId("music-confirm")).toHaveText("Saved");
      } finally {
        await ctx.close();
        await qr.cleanup();
      }
    }
  });
});

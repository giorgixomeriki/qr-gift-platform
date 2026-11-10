// Signature Experience — sender integration QA (Phase 1).
//
//   node scripts/qa/signature-sender.mjs <baseURL> <outDir> [--legacy] [--only=<device>]
//
// Drives the REAL sender flow (/g/{token}) against local Supabase: it creates
// throwaway AVAILABLE cards under a throwaway partner (superuser connection,
// like e2e/fixtures.ts), walks them through the wizard, and deletes them
// afterwards. Never touches existing cards, orders or payments; checkout is
// only opened, never paid.
//
// Four emulated phones × KA/EN (the Final Polish review's profiles): WebKit for
// iOS, Chromium for Android. These are browser emulations, not devices. Every
// screenshot uses a fresh context + page (a reused WebKit page can leave
// document.fonts "loading" and hang Playwright's screenshot).
//
// --legacy captures the same moments on the pre-integration UI (for before/after).
import { chromium, webkit, devices } from "playwright";
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";

const [BASE, OUT, ...flags] = process.argv.slice(2);
if (!BASE || !OUT) throw new Error("usage: signature-sender.mjs <baseURL> <outDir> [--legacy] [--only=<device>]");
const LEGACY = flags.includes("--legacy");
const ONLY = flags.find((f) => f.startsWith("--only="))?.slice(7);
mkdirSync(OUT, { recursive: true });

const DEVICES = [
  { id: "ios-iphone16pro", engine: webkit, ua: devices["iPhone 15 Pro"], viewport: { width: 402, height: 738 } },
  { id: "android-pixel8", engine: chromium, ua: devices["Pixel 7"], viewport: { width: 412, height: 803 } },
  { id: "ios-iphonese", engine: webkit, ua: devices["iPhone SE"], viewport: { width: 375, height: 553 } },
  { id: "android-compact", engine: chromium, ua: devices["Galaxy S9+"], viewport: { width: 360, height: 640 } },
].filter((d) => !ONLY || d.id === ONLY);
const WORLDS = ["minimal", "romantic", "birthday", "wedding", "celebration", "elegant"];
const LONG = {
  ka: "ჩემო ძვირფასო ნინო, დღეს, ჩვენი ერთად გატარებული მეხუთე წლისთავის დილას, მინდა გითხრა ის, რასაც ყოველდღიურობაში ხშირად ვერ ვამბობ. შენ ხარ ჩემი სიმშვიდე ხმაურიან დღეებში და ჩემი სიცილი მოსაწყენ საღამოებში. მადლობა თბილისის ქუჩებში გატარებული უთვალავი გასეირნებისთვის, ზღვისპირა დილებისთვის, ყავისთვის, რომელსაც ყოველთვის ჩემზე ადრე ადუღებ, და მოთმინებისთვის, რომლითაც ჩემს დაუსრულებელ ისტორიებს უსმენ. ვიცი, რომ ეს წელი ადვილი არ ყოფილა, მაგრამ შენ ყოველთვის პოულობდი სინათლეს. დაუვიწყარი წლისთავი გქონდეს. მიყვარხარ — დღეს, ხვალ და ყოველთვის.",
  en: "My dearest Nino, on the morning of our fifth anniversary I want to tell you the things I rarely say on ordinary days. You are my calm on loud days and my laughter on slow evenings. Thank you for the countless walks through Tbilisi, for the mornings by the sea, for the coffee you always make before I wake, and for the patience with which you listen to my endless stories. I know this year was not an easy one, but you always found the light. Happy anniversary. I love you, today, tomorrow and always, more than this small card could ever hold.",
};
const SHORT = { ka: "ჩემო ნინო, ყველა ჩვეულებრივი დღე შენთან ერთად უკეთესია. მიყვარხარ.", en: "Nino, every ordinary day is better with you. I love you." };
// A real JPEG-shaped photo is not needed: a tiny PNG goes through the real pipeline (normalised to JPEG in the browser).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const UPLOAD = "**/storage/v1/object/upload/sign/**";

const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });
const created = [];
async function card() {
  const p = crypto.randomUUID(), b = crypto.randomUUID(), q = crypto.randomUUID();
  const token = "QAS" + Math.random().toString(36).slice(2, 10).toUpperCase();
  await sql`insert into partners (id, slug, name, commission_rate_bps, status) values (${p}, ${"qa-sig-" + p.slice(0, 8)}, 'Signature QA Partner', 3000, 'ACTIVE')`;
  await sql`insert into qr_batches (id, partner_id, label, quantity) values (${b}, ${p}, 'qa-sig', 1)`;
  await sql`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${q}, ${token}, ${b}, ${p}, 'AVAILABLE')`;
  created.push({ p, b, q });
  return token;
}
async function cleanup() {
  for (const { p, b, q } of created) {
    await sql`delete from analytics_events where qr_code_id = ${q}`;
    await sql`delete from greeting_content where greeting_id in (select id from greetings where qr_code_id = ${q})`;
    await sql`delete from payments where order_id in (select id from orders where qr_code_id = ${q})`;
    await sql`delete from orders where qr_code_id = ${q}`;
    await sql`delete from greetings where qr_code_id = ${q}`;
    await sql`delete from qr_codes where id = ${q}`;
    await sql`delete from qr_batches where id = ${b}`;
    await sql`delete from partners where id = ${p}`;
  }
}

const results = [];
const check = (env, name, pass, detail = "") => {
  results.push({ env, name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  [${env}] ${name}${detail ? " — " + detail : ""}`);
};

async function context(browser, dev, lang, { reduced = false, cookies = [] } = {}) {
  const ctx = await browser.newContext({ ...dev.ua, viewport: dev.viewport, reducedMotion: reduced ? "reduce" : "no-preference", locale: lang === "ka" ? "ka-GE" : "en-US" });
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: lang, url: BASE }, ...cookies]);
  return ctx;
}
async function shot(page, dev, lang, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${dev.id}--${lang}--${name}.png` });
}

/** Measurements the checks share: overflow, short touch targets, clipped text, low-contrast text. */
async function audit(page) {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const visible = (el) => el.checkVisibility?.() !== false && el.getBoundingClientRect().height > 0;
    const controls = [...document.querySelectorAll("button, a[href], [role=radio], label:has(input[type=file])")].filter(visible);
    const short = controls
      .map((el) => {
        const r = el.getBoundingClientRect();
        const before = getComputedStyle(el, "::before");
        const h = Math.max(r.height, before.position === "absolute" ? parseFloat(before.height) || 0 : 0);
        return { id: el.dataset.testid || el.getAttribute("aria-label") || el.textContent.trim().slice(0, 24), h: Math.round(h), w: Math.round(r.width) };
      })
      .filter((t) => t.h < 43.5 || t.w < 43.5);
    const clipped = [...document.querySelectorAll(".sig-title, .sig-sub, .sigf-tile__name, .sigf-hero__name b, .sigf-row__name, .sigf-row__status, .sig-edits button, .sig-cta, .sigf-add__btn b, .sigf-add__btn small, .sig-steps, .sig-letter-field__foot span")]
      .filter(visible)
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.className.toString().split(" ")[0] + ":" + el.textContent.trim().slice(0, 20));
    // Text contrast against the surface it sits on (paper, card, wine), for the screen's own text.
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => {
        v = +v / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bgOf = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const m = cs.backgroundColor.match(/[\d.]+/g);
        if (m && (m[3] === undefined || +m[3] > 0.9)) return cs.backgroundColor;
        if (cs.backgroundImage.includes("gradient") && n.classList.contains("sig-cta")) return "rgb(95, 30, 50)";
      }
      return "rgb(246, 240, 230)"; // --sig-paper
    };
    const low = [...document.querySelectorAll(".sig p, .sig span, .sig b, .sig small, .sig h1, .sig h2, .sig button")]
      .filter(visible)
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .filter((el) => !el.closest("[aria-hidden=true], .sigf-hero, .sig-window, .sig-cta, .sigf-row__retry, .sigf-voice__actions [data-primary]"))
      .map((el) => {
        const L1 = lum(getComputedStyle(el).color), L2 = lum(bgOf(el));
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const big = parseFloat(getComputedStyle(el).fontSize) >= 24;
        return { t: el.textContent.trim().slice(0, 24), ratio: Math.round(ratio * 10) / 10, need: big ? 3 : 4.5 };
      })
      .filter((x) => x.ratio < x.need);
    return { overflow, short, clipped, low };
  });
}
function auditChecks(env, a, screen) {
  check(env, `${screen}: no horizontal overflow`, a.overflow === 0, `${a.overflow}px`);
  check(env, `${screen}: touch targets ≥ 44px`, a.short.length === 0, JSON.stringify(a.short));
  check(env, `${screen}: no clipped text`, a.clipped.length === 0, JSON.stringify(a.clipped));
  check(env, `${screen}: text contrast ≥ WCAG AA`, a.low.length === 0, JSON.stringify(a.low.slice(0, 4)));
}

async function startGreeting(browser, dev, lang) {
  const token = await card();
  const ctx = await context(browser, dev, lang);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/g/${token}`);
  await page.getByTestId("start-greeting-button").click();
  await page.getByTestId("theme-step").waitFor();
  const cookies = await ctx.cookies();
  await ctx.close();
  return { token, cookies: cookies.filter((c) => c.name !== "NEXT_LOCALE") };
}
/** A fresh context + page on one step of an existing draft. */
async function open(browser, dev, lang, g, step, opts = {}) {
  const ctx = await context(browser, dev, lang, { ...opts, cookies: g.cookies });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/g/${g.token}${step ? `?step=${step}` : ""}`);
  return { ctx, page, errors };
}

async function legacyRun(browser, dev, lang) {
  const env = `${dev.id}/${lang}`;
  const g = await startGreeting(browser, dev, lang);
  for (const [step, name, prep] of [
    [null, "1-picker", null],
    ["message", "3-create-empty-error", async (p) => p.getByTestId("wizard-continue").click()],
    ["message", "4-create-long", async (p) => p.getByTestId("message-textarea").fill(LONG[lang])],
  ]) {
    const { ctx, page } = await open(browser, dev, lang, g, step);
    await page.waitForLoadState("networkidle");
    if (prep) await prep(page);
    await shot(page, dev, lang, name);
    if (name === "4-create-long") {
      await page.getByTestId("wizard-continue").click();
      await page.getByTestId("media-step").waitFor();
      await shot(page, dev, lang, "5-media");
    }
    await ctx.close();
  }
  const { ctx, page } = await open(browser, dev, lang, g, "preview");
  await page.getByTestId("greeting-tap-to-open").waitFor();
  await shot(page, dev, lang, "8-preview");
  await ctx.close();
  await legacyHome(browser, dev, lang);
  check(env, "legacy captures", true);
}
async function legacyHome(browser, dev, lang) {
  const ctx = await context(browser, dev, lang);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await shot(page, dev, lang, "0-home");
  await ctx.close();
}

async function run(browser, dev, lang) {
  const env = `${dev.id}/${lang}`;
  const isChromium = dev.engine === chromium;

  // Home
  {
    const ctx = await context(browser, dev, lang);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await page.getByTestId("home").waitFor();
    await shot(page, dev, lang, "0-home");
    auditChecks(env, await audit(page), "home");
    await ctx.close();
  }

  const g = await startGreeting(browser, dev, lang);

  // Picker: default, then a chosen world; all six + the action on one screen.
  {
    const { ctx, page, errors } = await open(browser, dev, lang, g, null);
    await page.getByTestId("theme-step").waitFor();
    await shot(page, dev, lang, "1-picker");
    auditChecks(env, await audit(page), "picker");
    const fit = await page.evaluate(() => {
      const cta = document.querySelector("[data-testid=wizard-continue]").getBoundingClientRect();
      const tiles = [...document.querySelectorAll("[data-testid^=theme-option-]")].map((t) => t.getBoundingClientRect());
      return { cta: Math.round(cta.bottom), vh: innerHeight, tilesAbove: tiles.every((r) => r.bottom <= cta.top + 1), n: tiles.length };
    });
    check(env, "picker: six worlds and Continue on one screen", fit.n === 6 && fit.tilesAbove && fit.cta <= fit.vh, JSON.stringify(fit));
    const saved = page.waitForResponse((r) => r.request().method() === "POST");
    await page.getByTestId("theme-option-romantic").click();
    await saved;
    check(env, "picker: choosing a world saves it and marks one radio", (await page.locator("[role=radio][aria-checked=true]").count()) === 1);
    await shot(page, dev, lang, "2-picker-romantic");
    if (isChromium) {
      await page.getByTestId("theme-option-romantic").focus();
      await page.keyboard.press("ArrowRight");
      const focus = await page.evaluate(() => ({ id: document.activeElement?.dataset.testid, outline: getComputedStyle(document.activeElement).outlineStyle !== "none" || getComputedStyle(document.activeElement).boxShadow !== "none" }));
      check(env, "picker: arrow keys move choice and focus (Chromium)", focus.id === "theme-option-birthday", JSON.stringify(focus));
      await page.keyboard.press("ArrowLeft");
      await page.waitForResponse((r) => r.request().method() === "POST");
    }
    check(env, "picker: no page errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // Create: empty-message validation.
  {
    const { ctx, page } = await open(browser, dev, lang, g, "create");
    await page.getByTestId("create-step").waitFor();
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("message-error").waitFor();
    const focused = await page.evaluate(() => document.activeElement?.dataset.testid);
    check(env, "create: empty message refused, reason shown, field focused", focused === "message-textarea");
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(500);
    await shot(page, dev, lang, "3-create-empty-error");
    auditChecks(env, await audit(page), "create (error)");
    await ctx.close();
  }

  // Create: long letter (600), keyboard-style focus keeps the field clear of the action.
  {
    const { ctx, page } = await open(browser, dev, lang, g, "create");
    await page.getByTestId("create-step").waitFor();
    await page.getByTestId("message-textarea").fill(LONG[lang]);
    const typing = await page.evaluate(() => {
      const f = document.querySelector("[data-testid=message-textarea]").getBoundingClientRect();
      const c = document.querySelector("[data-testid=wizard-continue]").getBoundingClientRect();
      return { overlap: !(c.top >= f.bottom || c.bottom <= f.top), dockSticky: getComputedStyle(document.querySelector(".sig-dock")).position };
    });
    check(env, "create: while typing, the action never covers the letter", !typing.overlap && typing.dockSticky === "relative", JSON.stringify(typing));
    const count = await page.locator(".sig-count").textContent();
    check(env, "create: long letter accepted up to the limit", /600|\d{3} \/ 600/.test(count ?? ""), count ?? "");
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(600);
    await page.evaluate(() => scrollTo(0, 0));
    await shot(page, dev, lang, "4-create-long");
    auditChecks(env, await audit(page), "create (long)");
    await ctx.close();
  }

  // Create: upload in progress (held), failure → retry → ready, voice panel, remove → undo.
  {
    const { ctx, page, errors } = await open(browser, dev, lang, g, "create");
    await page.getByTestId("create-step").waitFor();
    await page.getByTestId("message-textarea").fill(SHORT[lang]);
    let release = () => {};
    const held = new Promise((r) => (release = r));
    let mode = "hold";
    await page.route(UPLOAD, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      if (mode === "hold") await held;
      if (mode === "fail") return route.abort("connectionreset");
      return route.continue().catch(() => {});
    });
    await page.getByTestId("media-input-photo").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("media-cancel-photo-0").waitFor({ timeout: 20000 });
    await page.getByTestId("media-row-photo-0").scrollIntoViewIfNeeded();
    await shot(page, dev, lang, "5-create-uploading");
    auditChecks(env, await audit(page), "create (uploading)");
    // Continue during the upload: queued, says so.
    await page.getByTestId("wizard-continue").click();
    const busy = await page.waitForSelector("[data-testid=wizard-continue][aria-busy=true]", { timeout: 5000 }).then(() => true, () => false);
    check(env, "create: Continue during an upload waits and says so", busy);
    mode = "fail";
    release();
    // The held PUT now fails (aborted at the route) → failed row with Retry.
    await page.getByTestId("media-retry-photo-0").waitFor({ timeout: 20000 });
    const blocked = await page.getByTestId("failed-block").waitFor({ timeout: 5000 }).then(() => true, () => false);
    check(env, "create: a failed upload shows the reason and Retry, and blocks Continue", blocked);
    await page.getByTestId("media-row-photo-0").scrollIntoViewIfNeeded();
    await shot(page, dev, lang, "6-create-failed");
    auditChecks(env, await audit(page), "create (failed)");
    mode = "pass";
    await page.getByTestId("media-retry-photo-0").click();
    await page.getByTestId("preview-step").waitFor({ timeout: 20000 }).catch(() => null);
    // A retry that lands lets the remembered Continue go on — if it did, come back to Create.
    if (await page.getByTestId("preview-step").isVisible()) {
      check(env, "create: after Retry lands, the remembered Continue proceeds to Preview", true);
      await page.goBack();
    }
    await page.getByTestId("media-ready-photo-0").waitFor({ timeout: 20000 });
    await page.getByTestId("add-audio").click();
    await page.getByTestId("voice-recorder").scrollIntoViewIfNeeded();
    await shot(page, dev, lang, "7-create-ready-voice");
    auditChecks(env, await audit(page), "create (ready + voice)");
    await page.getByTestId("voice-close").click();
    await page.getByTestId("media-remove-photo-0").click();
    await page.getByTestId("media-undo-photo-0").scrollIntoViewIfNeeded();
    await shot(page, dev, lang, "7b-create-undo");
    await page.getByTestId("media-undo-photo-0").click();
    check(env, "create: Undo restores a removed photo", await page.getByTestId("media-ready-photo-0").isVisible());
    check(env, "create: no page errors", errors.length === 0, errors.join(" | "));
    // In-app Back (a new history entry, as in the legacy wizard) keeps the letter and the photo; browser Back returns.
    await page.getByTestId("wizard-back").click();
    await page.getByTestId("theme-step").waitFor();
    await page.goBack();
    await page.getByTestId("create-step").waitFor();
    const kept = { text: await page.getByTestId("message-textarea").inputValue(), photo: await page.getByTestId("media-ready-photo-0").isVisible() };
    check(env, "create: in-app Back, then browser Back, keeps the letter and the photo", kept.text === SHORT[lang] && kept.photo, JSON.stringify({ photo: kept.photo, text: kept.text.slice(0, 40), url: page.url().split("?")[1] }));
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("preview-step").waitFor();
    await page.waitForTimeout(300);
    await shot(page, dev, lang, "8-preview");
    auditChecks(env, await audit(page), "preview");
    const contents = await page.getByTestId("preview-contents").textContent();
    check(env, "preview: lists the saved letter and photo", /1/.test(contents ?? ""), contents ?? "");
    await page.goBack();
    await page.getByTestId("create-step").waitFor();
    check(env, "browser Back from Preview returns to Create", true);
    await ctx.close();
  }

  // Preview → recipient view (the real renderer), then checkout opens (not paid).
  {
    const { ctx, page } = await open(browser, dev, lang, g, "preview");
    await page.getByTestId("preview-watch").click();
    await page.getByTestId("greeting-tap-to-open").waitFor();
    await shot(page, dev, lang, "9-preview-recipient");
    await ctx.close();
    const c2 = await open(browser, dev, lang, g, "preview");
    await c2.page.getByTestId("preview-activate-cta").click();
    await c2.page.getByTestId("checkout-step").waitFor();
    await c2.page.getByTestId("checkout-amount").waitFor({ timeout: 20000 });
    await shot(c2.page, dev, lang, "10-checkout-unchanged");
    check(env, "checkout: opens from Preview, unchanged (order slip arrives in Phase 3)", true);
    await c2.ctx.close();
  }

  // Reduced motion: picker shows worlds at rest, choosing works.
  {
    const { ctx, page } = await open(browser, dev, lang, g, "theme", { reduced: true });
    await page.getByTestId("theme-step").waitFor();
    const saved = page.waitForResponse((r) => r.request().method() === "POST");
    await page.getByTestId("theme-option-wedding").click();
    await saved;
    await page.waitForTimeout(400);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    check(env, "reduced motion: picker at rest after a choice", running === 0, `${running} running`);
    await shot(page, dev, lang, "11-picker-reduced-motion");
    await ctx.close();
  }
}

/** Six worlds across the refined sender chrome (picker hero, letter head, preview window). */
async function worlds(browser, dev, lang) {
  const env = `${dev.id}/${lang}`;
  const g = await startGreeting(browser, dev, lang);
  {
    // Preview needs a saved message: write it through the real Create step once.
    const { ctx, page } = await open(browser, dev, lang, g, "create");
    await page.getByTestId("message-textarea").fill(SHORT[lang]);
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("preview-step").waitFor();
    await ctx.close();
  }
  for (const w of WORLDS) {
    for (const [step, name] of [["theme", "picker"], ["create", "create"], ["preview", "preview"]]) {
      const { ctx, page } = await open(browser, dev, lang, g, step);
      await page.getByTestId(step === "theme" ? "theme-step" : step === "create" ? "create-step" : "preview-step").waitFor();
      if (step === "theme" && (await page.getByTestId(`theme-option-${w}`).getAttribute("aria-checked")) !== "true") {
        // Chosen through the real picker (saved by updateThemeAction).
        const saved = page.waitForResponse((r) => r.request().method() === "POST");
        await page.getByTestId(`theme-option-${w}`).click();
        await saved;
      }
      await shot(page, dev, lang, `w-${w}-${name}`);
      const a = await audit(page);
      check(env, `${w}/${name}: no overflow, clipping or short targets`, a.overflow === 0 && a.clipped.length === 0 && a.short.length === 0, JSON.stringify({ o: a.overflow, c: a.clipped, s: a.short }));
      await ctx.close();
    }
  }
}

try {
  for (const dev of DEVICES) {
    const browser = await dev.engine.launch();
    try {
      for (const lang of ["ka", "en"]) {
        if (LEGACY) await legacyRun(browser, dev, lang);
        else {
          await run(browser, dev, lang);
          if ((dev.id === "ios-iphone16pro" && lang === "ka") || (dev.id === "android-pixel8" && lang === "en") || dev.id === "ios-iphonese" || dev.id === "android-compact") await worlds(browser, dev, lang);
        }
      }
    } catch (e) {
      check(dev.id, "harness completed", false, String(e.message).split("\n")[0]);
    } finally {
      await browser.close();
    }
  }
} finally {
  await cleanup();
  await sql.end();
  const passed = results.filter((r) => r.pass).length;
  writeFileSync(`${OUT}/qa-report.json`, JSON.stringify({ base: BASE, legacy: LEGACY, at: new Date().toISOString(), passed, failed: results.length - passed, results }, null, 2));
  console.log(`\n${passed}/${results.length} passed`);
}

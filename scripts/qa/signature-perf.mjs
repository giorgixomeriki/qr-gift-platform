// Signature Experience — sender performance, before vs after (Phase 1).
//
//   node scripts/qa/signature-perf.mjs <beforeURL> <afterURL> <out.json>
//
// Both URLs must be LOCAL PRODUCTION builds (next build && next start) of the
// pre-integration commit and of this branch, on the same machine and database.
// EMULATION ONLY. Chromium (Android engine): Pixel 7, 4× CPU, slow 4G (150 ms
// RTT, 1.6 / 0.75 Mbps), cold cache per run. WebKit (iOS engine) can't be
// throttled by Playwright, so it runs unthrottled and is reported separately.
// Each cold-load metric is the median of RUNS runs.
//
//   visibleMs      navigation → the screen's primary control is visible
//   interactiveMs  navigation → the first tap the app actually ANSWERS (state changes; a pressed style doesn't count)
//   tbtMs          Σ(long task − 50 ms) during the load   ·   cls  layout shift   ·   jsKB  script bytes transferred
//   choice         (hydrated, 4× CPU) tap a world → it is checked, and rAF intervals for 700 ms after
//
// Taps are the same intent on both UIs, but the screens differ where the
// design does: Create's empty-letter Continue (legacy: the Message step),
// Preview's primary tap (legacy: Open on the inline renderer; Signature: "See
// it as the recipient").
import { chromium, webkit, devices } from "playwright";
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const [BEFORE, AFTER, OUT] = process.argv.slice(2);
if (!BEFORE || !AFTER || !OUT) throw new Error("usage: signature-perf.mjs <beforeURL> <afterURL> <out.json>");
const RUNS = Number(process.env.RUNS ?? 3);
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", { max: 1 });
const created = [];

async function card() {
  const p = crypto.randomUUID(), b = crypto.randomUUID(), q = crypto.randomUUID();
  const token = "QAP" + Math.random().toString(36).slice(2, 10).toUpperCase();
  await sql`insert into partners (id, slug, name, commission_rate_bps, status) values (${p}, ${"qa-perf-" + p.slice(0, 8)}, 'Signature Perf Partner', 3000, 'ACTIVE')`;
  await sql`insert into qr_batches (id, partner_id, label, quantity) values (${b}, ${p}, 'qa-perf', 1)`;
  await sql`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${q}, ${token}, ${b}, ${p}, 'AVAILABLE')`;
  created.push({ p, b, q });
  return token;
}

const INIT = () => {
  window.__lt = [];
  window.__cls = 0;
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask", buffered: true });
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true });
  } catch {}
};

async function setup(engine, throttle, cookies, { cpuOnly = false } = {}) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], isMobile: engine === chromium, hasTouch: false });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  if (throttle) {
    const cdp = await ctx.newCDPSession(page);
    if (!cpuOnly) {
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await page.addInitScript(INIT);
  return { browser, page };
}

/** A draft on the given server: started through the real Screen #1, optionally with a saved message. */
async function draft(base, legacy, message) {
  const token = await card();
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: "ka", url: base }]);
  const page = await ctx.newPage();
  await page.goto(`${base}/g/${token}`);
  await page.getByTestId("start-greeting-button").click();
  await page.getByTestId("theme-step").waitFor();
  if (message) {
    await page.goto(`${base}/g/${token}?step=${legacy ? "message" : "create"}`);
    await page.getByTestId("message-textarea").fill(message);
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId(legacy ? "media-step" : "preview-step").waitFor();
  }
  // Production builds mark the edit-token cookie Secure. Chromium treats http://127.0.0.1 as a secure
  // context and keeps it; WebKit drops it — so for this LOCAL measurement only, the copy is not Secure.
  const cookies = (await ctx.cookies()).map((c) => ({ ...c, secure: false }));
  await browser.close();
  return { token, cookies };
}

function screens(legacy) {
  return [
    { name: "home", path: () => "/", target: legacy ? "a[href='/partner/login']" : "[data-testid=home-partner-cta]" },
    {
      name: "picker",
      path: (g) => `/g/${g.token}`,
      target: (i) => `[data-testid=theme-option-${["birthday", "wedding", "celebration", "elegant", "romantic"][i % 5]}]`,
      answered: (i) => `[data-testid=theme-option-${["birthday", "wedding", "celebration", "elegant", "romantic"][i % 5]}][aria-checked=true]`,
    },
    {
      name: "create",
      empty: true,
      path: (g) => `/g/${g.token}?step=${legacy ? "message" : "create"}`,
      target: "[data-testid=wizard-continue]",
      answered: legacy ? "#greeting-message-error" : "[data-testid=message-error]",
    },
    {
      name: "preview",
      path: (g) => `/g/${g.token}?step=preview`,
      target: legacy ? "[data-testid=greeting-tap-to-open]" : "[data-testid=preview-watch]",
      answered: legacy ? "[data-beat=message]" : "[data-testid=greeting-tap-to-open]",
    },
  ];
}

async function load(engine, throttle, base, g, sc, i) {
  const { browser, page } = await setup(engine, throttle, [{ name: "NEXT_LOCALE", value: "ka", url: base }, ...g.cookies.filter((c) => c.name !== "NEXT_LOCALE")]);
  const t0 = Date.now();
  await page.goto(`${base}${sc.path(g)}`, { waitUntil: "commit" });
  const sel = typeof sc.target === "function" ? sc.target(i) : sc.target;
  const target = page.locator(sel).first();
  await target.waitFor({ state: "visible", timeout: 90000 });
  const visibleMs = Date.now() - t0;
  let interactiveMs = null;
  if (sc.answered) {
    const ans = typeof sc.answered === "function" ? sc.answered(i) : sc.answered;
    for (let k = 0; k < 300; k++) {
      await target.click({ timeout: 500 }).catch(() => {});
      if ((await page.locator(ans).count()) > 0) {
        interactiveMs = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(100);
    }
  }
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => ({
    tbt: window.__lt.reduce((a, d) => a + Math.max(0, d - 50), 0),
    cls: window.__cls,
    js: performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script").reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0),
  }));
  await browser.close();
  return { visibleMs, interactiveMs, tbtMs: Math.round(m.tbt), cls: Number(m.cls.toFixed(4)), jsKB: Math.round(m.js / 1024) };
}

async function choice(engine, throttle, base, g) {
  const { browser, page } = await setup(engine, throttle, [{ name: "NEXT_LOCALE", value: "ka", url: base }, ...g.cookies.filter((c) => c.name !== "NEXT_LOCALE")], { cpuOnly: true });
  await page.goto(`${base}/g/${g.token}`);
  await page.getByTestId("theme-step").waitFor();
  await page.waitForTimeout(2500);
  const out = [];
  for (const key of ["wedding", "celebration", "birthday"]) {
    await page.evaluate((key) => {
      window.__frames = [];
      window.__sel = null;
      document.addEventListener(
        "pointerdown",
        (ev) => {
          const t0 = ev.timeStamp;
          const start = performance.now();
          const loop = (t) => {
            window.__frames.push(t);
            if (t - start < 700) requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
          const poll = () => {
            if (document.querySelector(`[data-testid=theme-option-${key}][aria-checked=true]`)) window.__sel = performance.now() - t0;
            else if (performance.now() - t0 < 5000) setTimeout(poll, 2);
          };
          setTimeout(poll, 0);
        },
        { capture: true, once: true },
      );
    }, key);
    await page.getByTestId(`theme-option-${key}`).click();
    await page.waitForTimeout(1100);
    out.push(
      await page.evaluate(() => {
        const d = window.__frames.slice(1).map((t, i) => t - window.__frames[i]);
        const s = [...d].sort((a, b) => a - b);
        return { selectMs: window.__sel === null ? null : Math.round(window.__sel), p95: Math.round(s[Math.floor(s.length * 0.95)] ?? 0), over50: d.filter((x) => x > 50).length };
      }),
    );
  }
  await browser.close();
  return out;
}

const median = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};

const rows = [];
const choices = [];
try {
  for (const [label, base, legacy] of [["before", BEFORE, true], ["after", AFTER, false]]) {
    const filled = await draft(base, legacy, "ჩემო ნინო, ყველა ჩვეულებრივი დღე შენთან ერთად უკეთესია. მიყვარხარ.");
    const empty = await draft(base, legacy, null);
    for (const [engineName, engine, throttle] of [["chromium", chromium, true], ["webkit", webkit, false]]) {
      for (const sc of screens(legacy)) {
        const runs = [];
        for (let i = 0; i < RUNS; i++) runs.push(await load(engine, throttle, base, sc.empty ? empty : filled, sc, i));
        const r = Object.fromEntries(["visibleMs", "interactiveMs", "tbtMs", "cls", "jsKB"].map((k) => [k, median(runs.map((x) => x[k]))]));
        rows.push({ build: label, engine: engineName, throttled: throttle, screen: sc.name, ...r, runs });
        console.log(label, engineName, sc.name, JSON.stringify(r));
      }
      const c = await choice(engine, throttle, base, filled);
      choices.push({ build: label, engine: engineName, throttled: throttle, samples: c, selectMs: median(c.map((x) => x.selectMs)), p95: Math.max(...c.map((x) => x.p95)), over50: c.reduce((a, x) => a + x.over50, 0) });
      console.log(label, engineName, "choice", JSON.stringify(choices.at(-1)));
    }
  }
} finally {
  for (const { p, b, q } of created) {
    await sql`delete from analytics_events where qr_code_id = ${q}`;
    await sql`delete from greeting_content where greeting_id in (select id from greetings where qr_code_id = ${q})`;
    await sql`delete from greetings where qr_code_id = ${q}`;
    await sql`delete from qr_codes where id = ${q}`;
    await sql`delete from qr_batches where id = ${b}`;
    await sql`delete from partners where id = ${p}`;
  }
  await sql.end();
  writeFileSync(OUT, JSON.stringify({ before: BEFORE, after: AFTER, at: new Date().toISOString(), runs: RUNS, method: "Chromium: Pixel 7, 4x CPU, slow 4G (150 ms RTT, 1.6/0.75 Mbps), cold cache; WebKit unthrottled", rows, choice: choices }, null, 2));
  console.log("done");
}

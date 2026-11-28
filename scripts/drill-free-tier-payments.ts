import Module from "node:module";
import http from "node:http";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomBytes, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ALL_CHECKOUT_CONSENTS } from "../src/lib/payments/checkout-codes";

// Same server-only shim as the verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};
const postgres = require("postgres") as typeof import("postgres");

/**
 * Render Free payment-reliability drill (docs/bog-release/RENDER_FREE_PAYMENTS.md).
 *
 * Runs the REAL production build (`next start`, NODE_ENV=production,
 * PAYMENTS_PROVIDER=BOG) behind a proxy that behaves like Render Free:
 * the instance is stopped when idle and cold-started by the next request,
 * which is either held until the app is up ("hold") or answered 503 while it
 * boots ("503", as observed on qrapp.ge). BOG is the local simulator; its
 * callbacks are signed and sent over HTTP through the proxy; the scheduled
 * reconciliation is the real GitHub caller (.github/scripts/payments-reconcile.sh).
 * BOG documents no callback retries ("If callback was not received
 * successfully, business must use the Get Payment Details method"), so a
 * callback lost to a cold start must be recovered by reconciliation.
 *
 * Local only: local Supabase, 127.0.0.1, no real money. Needs a prior
 * `next build` with NEXT_PUBLIC_APP_URL=http://localhost:3870 and the local
 * stack env exported (MIGRATIONS_DATABASE_URL, DATABASE_URL, Supabase keys).
 */
const W = path.resolve(__dirname, "..");
const PROXY_PORT = 3870;
const APP_PORT = 3871;
const APP_URL = `http://127.0.0.1:${PROXY_PORT}`;
const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl || !/127\.0\.0\.1|localhost/.test(migrationsUrl)) throw new Error("local MIGRATIONS_DATABASE_URL required");
const db = postgres(migrationsUrl, { max: 2, onnotice: () => {} });

let passed = 0;
let failed = 0;
const results: string[] = [];
function check(name: string, condition: boolean, detail?: string) {
  const line = `  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
  if (condition) passed++;
  else failed++;
  results.push(line);
  console.log(line);
}
const note = (s: string) => {
  results.push(`  NOTE  ${s}`);
  console.log(`  NOTE  ${s}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { bog, server: simulator, publicKey, privateKey, complete, settleRefund } = require("./lib-bog-simulator") as typeof import("./lib-bog-simulator");

// ── Render Free emulator ────────────────────────────────────────────────
type Mode = "hold" | "503";
const free = {
  mode: "hold" as Mode,
  state: "asleep" as "asleep" | "booting" | "awake",
  app: null as ChildProcess | null,
  booting: null as Promise<void> | null,
  lastRequest: Date.now(),
  idleMs: 0, // 0 = only explicit sleeps; set for the idle check
  bootTimes: [] as number[],
  served503: 0,
  appEnv: {} as NodeJS.ProcessEnv,
  // Extra cold-start time on top of the local boot (Render Free measured ~31 s).
  bootDelayMs: Number(process.env.DRILL_BOOT_DELAY_MS ?? 0),
};

async function appHealthy(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
    return r.status === 200;
  } catch {
    return false;
  }
}

function boot(): Promise<void> {
  if (free.booting) return free.booting;
  free.state = "booting";
  const started = Date.now();
  free.booting = (async () => {
    await wait(free.bootDelayMs);
    free.app = spawn(path.join(W, "node_modules/.bin/next"), ["start", "-p", String(APP_PORT)], { cwd: W, env: free.appEnv, stdio: ["ignore", "ignore", "pipe"] });
    free.app.stderr?.on("data", (d: Buffer) => process.env.DRILL_VERBOSE && process.stderr.write(`[app] ${d}`));
    for (let i = 0; i < 480; i++) {
      if (await appHealthy()) {
        free.bootTimes.push(Date.now() - started);
        free.state = "awake";
        free.booting = null;
        return;
      }
      await wait(250);
    }
    throw new Error("app did not boot in 120 s");
  })();
  return free.booting;
}

async function sleepNow(how: "SIGTERM" | "SIGKILL" = "SIGTERM") {
  // Let a boot that a 503 started finish first, so its promise never polls a dead process.
  if (free.booting && how === "SIGTERM") await free.booting.catch(() => {});
  free.booting = null;
  const app = free.app;
  free.app = null;
  free.state = "asleep";
  if (!app || app.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    app.once("exit", () => resolve());
    app.kill(how);
    // Render stops a sleeping instance regardless of open connections.
    setTimeout(() => app.exitCode === null && app.kill("SIGKILL"), 5000).unref();
  });
  for (let i = 0; i < 40 && (await appHealthy()); i++) await wait(100);
}

const proxy = http.createServer(async (req, res) => {
  free.lastRequest = Date.now();
  if (free.state !== "awake") {
    if (free.mode === "503") {
      void boot().catch(() => {});
      free.served503++;
      res.writeHead(503, { "Content-Type": "text/plain" });
      return res.end("Service Unavailable (cold start)");
    }
    try {
      await boot();
    } catch {
      res.writeHead(502);
      return res.end("boot failed");
    }
  }
  // The caller gave up while the instance was booting: nothing to deliver
  // (the conservative reading of an undocumented Render behaviour).
  if (req.destroyed || res.destroyed || req.socket.destroyed) return;
  const upstream = http.request({ host: "127.0.0.1", port: APP_PORT, method: req.method, path: req.url, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("upstream error");
  });
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
});
setInterval(() => {
  if (free.idleMs && free.state === "awake" && Date.now() - free.lastRequest > free.idleMs) void sleepNow();
}, 500).unref();

// ── BOG side ────────────────────────────────────────────────────────────
type Delivery = { status: number | "timeout" | "error"; ms: number };
async function bogCallback(bogId: string, timeoutMs: number): Promise<Delivery> {
  const raw = JSON.stringify({ event: "order_payment", zoned_request_time: new Date().toISOString(), body: { order_id: bogId } });
  const signature = sign("sha256", Buffer.from(raw, "utf8"), privateKey).toString("base64");
  const started = Date.now();
  try {
    const r = await fetch(`${APP_URL}/api/webhooks/payments/BOG`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Callback-Signature": signature },
      body: raw,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await r.text();
    return { status: r.status, ms: Date.now() - started };
  } catch (e) {
    return { status: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "error", ms: Date.now() - started };
  }
}

// The GitHub Actions caller, unchanged, with test-sized waits.
function reconcileCaller(cronSecret: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [path.join(W, ".github/scripts/payments-reconcile.sh")],
      { env: { NODE_ENV: "production", PATH: process.env.PATH ?? "/usr/bin:/bin", APP_URL, CRON_SECRET: cronSecret, WAKE_SLEEP: process.env.DRILL_WAKE_SLEEP ?? "3", RUN_BACKOFF: "2" }, timeout: 300_000, encoding: "utf8" },
      (err: Error | null, stdout: string, stderr: string) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}`.trim() }),
    );
  });
}

async function main() {
  await new Promise<void>((r) => simulator.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(simulator.address() as AddressInfo).port}`;
  const cronSecret = randomBytes(24).toString("hex");
  const reconcileAdmin = crypto.randomUUID();
  await db`insert into admin_users (user_id) values (${reconcileAdmin})`;

  const bogEnv = {
    PAYMENTS_PROVIDER: "BOG",
    BOG_CLIENT_ID: "qa-client",
    BOG_CLIENT_SECRET: "qa-secret",
    BOG_API_BASE_URL: base,
    BOG_OAUTH_TOKEN_URL: `${base}/token`,
    BOG_WEBHOOK_SIGNING_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    CHECKOUT_ENABLED: "true",
    BOG_REFUNDS_ENABLED: "true",
    LEGAL_EFFECTIVE_DATE: "2026-01-01",
    NEXT_PUBLIC_APP_URL: `http://localhost:${PROXY_PORT}`,
  };
  Object.assign(process.env, bogEnv);
  for (const k of ["MERCHANT_PROFILE", "ALLOW_TEST_PAYMENTS", "VERCEL", "RENDER", "APP_HOSTED", "PAYMENTS_SCOPE_PARTNER_ID"]) delete process.env[k];
  free.appEnv = { ...process.env, ...bogEnv, NODE_ENV: "production", CRON_SECRET: cronSecret, RECONCILE_ADMIN_USER_ID: reconcileAdmin, PORT: String(APP_PORT) };
  await new Promise<void>((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r));

  const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
  const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
  const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
  const { getOrCreateCheckoutOrder, acceptCheckoutTerms } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
  const { refundPaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");

  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const [product] = await db`select id from products where key = 'PREMIUM_GREETING'`;
  await db`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"free-" + partnerId.slice(0, 8)}, 'Free-tier drill partner', 3000, 'ACTIVE')`;
  await db`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'free-tier-drill', 20)`;
  await db`insert into prices (product_id, partner_id, currency, amount_minor, active) values (${product!.id}, ${partnerId}, 'GEL', 1000, true)`;

  async function newOrder() {
    const token = generatePublicToken();
    await db`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${crypto.randomUUID()}, ${token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    await updateGreetingMessage(greetingId, editToken, "Free-tier drill");
    const { summary } = await getOrCreateCheckoutOrder(greetingId, editToken);
    await acceptCheckoutTerms(greetingId, editToken, "ka", ALL_CHECKOUT_CONSENTS);
    const [pay] = await db`select provider_payment_id from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    return { greetingId, orderId: summary.orderId, bogId: pay!.provider_payment_id as string };
  }
  const state = async (o: { orderId: string; greetingId: string }) => {
    const [ord] = await db`select status from orders where id = ${o.orderId}`;
    const [g] = await db`select status from greetings where id = ${o.greetingId}`;
    const ledger = (await db`select type, amount_minor from partner_ledger_entries where order_id = ${o.orderId} order by created_at`).map((r) => `${r.type}:${r.amount_minor}`).join(",");
    return { order: ord!.status as string, greeting: g!.status as string, ledger };
  };
  // Reconciliation repairs a pending payment only once it is > 30 min old
  // (STALE_PENDING). Instead of waiting, age the attempt as the next hourly
  // run would find it.
  const ageOut = async (orderId: string) => {
    await db`update payments set created_at = created_at - interval '31 minutes' where order_id = ${orderId}`;
    await db`update orders set created_at = created_at - interval '31 minutes' where id = ${orderId}`;
  };
  const paidOnce = (s: { order: string; greeting: string; ledger: string }) => s.order === "PAID" && s.greeting === "ACTIVE" && s.ledger === "COMMISSION_EARNED:300";

  console.log("\n--- 0. Warm baseline ---");
  await boot();
  note(`local cold boot of next start: ${free.bootTimes[0]} ms (Render Free measured ~31 s and 503s; local is a lower bound)`);
  const a = await newOrder();
  complete(a.bogId);
  const warm = await bogCallback(a.bogId, 10_000);
  check("0a. Warm: signed callback → 200, PAID once", warm.status === 200 && paidOnce(await state(a)), `${warm.status} in ${warm.ms} ms`);

  console.log("\n--- 1. Idle spin-down (emulator check) ---");
  free.idleMs = 3000;
  await wait(5000);
  check("1a. The instance stops after the idle window", free.state === "asleep" && !(await appHealthy()));
  free.idleMs = 0;

  console.log("\n--- 2. Callback into a sleeping instance, Render holds the request ---");
  {
    const o = await newOrder();
    await sleepNow();
    complete(o.bogId);
    const d = await bogCallback(o.bogId, 120_000);
    check("2a. Held cold request is delivered after boot: 200, PAID once", d.status === 200 && paidOnce(await state(o)), `${d.status} in ${d.ms} ms`);
  }
  const late = await newOrder();
  {
    const o = late;
    await sleepNow();
    complete(o.bogId);
    const d = await bogCallback(o.bogId, free.bootDelayMs ? 10_000 : 1_000); // BOG's timeout is undocumented; one shorter than the cold start gives up first
    note(`2b. BOG timeout shorter than the cold start: BOG sees "${d.status}" after ${d.ms} ms`);
    for (let i = 0; i < 480 && free.state !== "awake"; i++) await wait(250);
    await wait(1500);
    const s = await state(o);
    // Delivered late (PAID once) or dropped (still pending, settled in §4) — never anything in between.
    check("2b. …the app is either PAID once or untouched PENDING (no partial state)", paidOnce(s) || (s.order === "PENDING_PAYMENT" && s.ledger === "" && s.greeting === "DRAFT"), JSON.stringify(s));
  }

  console.log("\n--- 3. Callback lost to a 503 cold start; no BOG retry ---");
  const lost = await newOrder();
  {
    await sleepNow();
    free.mode = "503";
    complete(lost.bogId);
    const d = await bogCallback(lost.bogId, 10_000);
    check("3a. Cold start answers 503 to BOG", d.status === 503, String(d.status));
    for (let i = 0; i < 480 && free.state !== "awake"; i++) await wait(250);
    const s = await state(lost);
    check("3b. Paid at the bank, still PENDING_PAYMENT here (no false FAILED, no activation)", s.order === "PENDING_PAYMENT" && s.greeting !== "ACTIVE" && s.ledger === "", JSON.stringify(s));
  }

  console.log("\n--- 4. Scheduled reconciliation wakes a sleeping instance and settles it ---");
  {
    const early = await reconcileCaller(cronSecret);
    check("4-. Inside the 30-min window the run leaves it PENDING (not yet stale)", (await state(lost)).order === "PENDING_PAYMENT", `exit ${early.code}`);
    await ageOut(lost.orderId);
    if ((await state(late)).order === "PENDING_PAYMENT") await ageOut(late.orderId);
    await sleepNow();
    const before = free.served503;
    const r = await reconcileCaller(cronSecret);
    const s = await state(lost);
    check("4a. Caller retries through the 503 cold start and gets 200", free.served503 > before && /reconcile endpoint: HTTP 200/.test(r.out), r.out.split("\n").join(" | "));
    check("4b. The lost-callback payments (503 and timed-out) are PAID and activated once", paidOnce(s) && paidOnce(await state(late)), JSON.stringify(s));
    check("4c. Run ends clean (exit 0)", r.code === 0 && /reconciliation clean/.test(r.out), `exit ${r.code}`);
    const again = await reconcileCaller(cronSecret);
    check("4d. A second run changes nothing", again.code === 0 && paidOnce(await state(lost)));
  }

  console.log("\n--- 5. BOG-style retry after a 503 ---");
  {
    const o = await newOrder();
    await sleepNow();
    complete(o.bogId);
    const first = await bogCallback(o.bogId, 10_000);
    for (let i = 0; i < 480 && free.state !== "awake"; i++) await wait(250);
    const retries = await Promise.all([bogCallback(o.bogId, 10_000), bogCallback(o.bogId, 10_000), bogCallback(o.bogId, 10_000)]);
    check("5a. First 503, retries 200 (concurrent), PAID with exactly one commission", first.status === 503 && retries.every((x) => x.status === 200) && paidOnce(await state(o)), `${first.status} then ${retries.map((x) => x.status)}`);
  }
  free.mode = "hold";

  console.log("\n--- 6. Instance killed while handling a callback ---");
  {
    const o = await newOrder();
    complete(o.bogId);
    const inflight = bogCallback(o.bogId, 10_000);
    await wait(15);
    await sleepNow("SIGKILL");
    const d = await inflight;
    const mid = await state(o);
    note(`6. BOG saw "${d.status}"; state after the crash: ${mid.order}/${mid.ledger || "no ledger"}`);
    // By design (service.ts confirmPaymentSuccess): money-captured commits on
    // its own, activation is a separate idempotent step, so a crash between
    // them leaves PAID + DRAFT (PAID_NOT_ACTIVATED, repaired by the next run).
    const moneyDurable = mid.order === "PAID" && mid.ledger === "COMMISSION_EARNED:300";
    const untouched = mid.order === "PENDING_PAYMENT" && mid.ledger === "" && mid.greeting === "DRAFT";
    check("6a. Crash leaves a consistent state: money booked once (activation may lag) or untouched; never live without payment", moneyDurable || untouched, JSON.stringify(mid));
    if (untouched) await ageOut(o.orderId); // only a still-pending attempt waits for the stale window
    const r = await reconcileCaller(cronSecret);
    check("6b. After the next reconciliation: PAID once, run clean", paidOnce(await state(o)) && r.code === 0, `exit ${r.code}`);
  }

  console.log("\n--- 7. Refund callback days later hits a sleeping instance ---");
  {
    const r1 = await refundPaidOrder(reconcileAdmin, a.orderId);
    const [ref] = await db`select status from payment_refunds where order_id = ${a.orderId} order by requested_at desc limit 1`;
    check("7a. Refund sent to BOG → REQUESTED", ref?.status === "REQUESTED", JSON.stringify({ r1, ref }));
    await sleepNow();
    free.mode = "503";
    settleRefund(a.bogId, "completed");
    const d = await bogCallback(a.bogId, 10_000);
    check("7b. Refund callback lost to a 503 cold start", d.status === 503);
    // Refunds are re-asked after 1 h (REFUND_AWAITING_PROVIDER); age it as the next run would find it.
    // (requested_at is trigger-protected; bypass triggers for this test-only clock shift.)
    await db.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update payment_refunds set requested_at = requested_at - interval '61 minutes' where order_id = ${a.orderId}`;
    });
    await sleepNow();
    const r = await reconcileCaller(cronSecret);
    const [ord] = await db`select status from orders where id = ${a.orderId}`;
    const [ref2] = await db`select status from payment_refunds where order_id = ${a.orderId} order by requested_at desc limit 1`;
    const ledger = (await db`select type, amount_minor from partner_ledger_entries where order_id = ${a.orderId} order by created_at`).map((x) => `${x.type}:${x.amount_minor}`).join(",");
    check(
      "7c. Reconciliation completes it: REFUNDED, commission reversed once",
      ord!.status === "REFUNDED" && ref2!.status === "COMPLETED" && ledger === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300" && r.code === 0,
      `${ord!.status}/${ref2!.status}/${ledger}/exit ${r.code}`,
    );
    free.mode = "hold";
  }

  console.log("\n--- 8. BOG receipt unavailable during reconciliation ---");
  {
    const o = await newOrder();
    complete(o.bogId);
    await sleepNow();
    await ageOut(o.orderId);
    bog.receiptFailure = "503";
    const r = await reconcileCaller(cronSecret);
    const s = await state(o);
    check("8a. Nothing guessed: order stays PENDING_PAYMENT", s.order === "PENDING_PAYMENT" && s.ledger === "", JSON.stringify(s));
    check("8b. The run is red (exit ≠ 0), so the owner is told", r.code !== 0, `exit ${r.code}: ${r.out.split("\n").slice(-1)[0]}`);
    bog.receiptFailure = null;
    const r2 = await reconcileCaller(cronSecret);
    check("8c. Next run after BOG recovers: PAID once, clean", paidOnce(await state(o)) && r2.code === 0, `exit ${r2.code}`);
  }

  note(`boot times (ms): ${free.bootTimes.join(", ")}; 503s served: ${free.served503}`);
  await sleepNow();
  proxy.close();
  simulator.close();
  // The drill's admin row is test data; leaving it would break admin-mfa's ops tool on this DB.
  await db`delete from admin_users where user_id = ${reconcileAdmin}`;
  await db.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await sleepNow("SIGKILL").catch(() => {});
  process.exit(1);
});

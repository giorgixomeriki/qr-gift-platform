import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

/**
 * Low-cost hosting (Render + Supabase Free) safety checks. Pure: no
 * database, no app server, no network. Every credential below is made up.
 *
 *  1. Client IP: a spoofed X-Forwarded-For can't pick the rate-limit key.
 *  2. Owner-review gate: Basic auth everywhere but /api/health and /api/cron.
 *  3. Media limits: video and the storage bucket fit Supabase Free's 50 MB.
 *  4. Checkout-disabled mode: production + TEST provider = closed.
 *  5. Render startup: hosted guards run and an unset IP setting is refused.
 *  6. render.yaml: plan, region, health check, payments off, no secrets.
 */
let passed = 0;
let failed = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (ok) passed++;
  else failed++;
}

const ENV = process.env as Record<string, string | undefined>;
const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-example",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-example",
  EDIT_TOKEN_SECRET: "x".repeat(64),
  NEXT_PUBLIC_APP_URL: "https://qrapp.ge",
  DATABASE_URL: "postgresql://app_runtime.abcdefgh:rotated-example@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
};
const ENV_KEYS = [
  ...Object.keys(BASE_ENV),
  "NODE_ENV", "VERCEL", "RENDER", "APP_HOSTED", "PAYMENTS_PROVIDER", "ALLOW_TEST_PAYMENTS", "CHECKOUT_ENABLED",
  "TRUSTED_PROXY_COUNT", "CLIENT_IP_HEADER", "CLIENT_IP_DIAGNOSTICS", "MIGRATIONS_DATABASE_URL",
  "BOG_CLIENT_ID", "BOG_CLIENT_SECRET", "BOG_API_BASE_URL", "BOG_WEBHOOK_SIGNING_KEY",
];

/** Loads a fresh copy of `modulePath` (and lib/env) under exactly `vars`. */
function loadWith<T>(vars: Record<string, string>, modulePath: string): T {
  for (const key of ENV_KEYS) delete ENV[key];
  Object.assign(ENV, vars);
  for (const id of Object.keys(require.cache)) {
    if (/src[\\/]lib[\\/](env|payments[\\/]checkout-gate)/.test(id)) delete require.cache[id];
  }
  return require(modulePath) as T;
}

async function main() {
  // 1 ── Client IP ────────────────────────────────────────────────────────
  console.log("1. Client IP");
  const { getClientIp, clientIpConfigFromEnv } = require("../src/lib/rate-limit/client-ip") as typeof import("../src/lib/rate-limit/client-ip");
  const h = (o: Record<string, string>) => new Headers(o);

  check("default (Vercel): first X-Forwarded-For entry", getClientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), {}) === "203.0.113.7");
  check("default: no header → shared bucket", getClientIp(h({}), {}) === "unattributed");
  check("default: a non-IP entry → shared bucket", getClientIp(h({ "x-forwarded-for": "evil, 10.0.0.1" }), {}) === "unattributed");

  // The chain measured on Render: client, Cloudflare edge, Render internal.
  check(
    "Render's real chain, count=3: spoofed prefix ignored",
    getClientIp(h({ "x-forwarded-for": "6.6.6.6,188.169.159.182, 172.70.250.218, 10.197.182.121" }), { proxyCount: 3 }) === "188.169.159.182",
  );
  check(
    "Render's real chain: cf-connecting-ip wins over a spoofed X-Forwarded-For",
    getClientIp(h({ "cf-connecting-ip": "188.169.159.182", "x-forwarded-for": "6.6.6.6, 1.1.1.1, 10.0.0.1" }), { header: "cf-connecting-ip", proxyCount: 3 }) === "188.169.159.182",
  );
  const one = { proxyCount: 1 };
  check("count=1: the entry the proxy appended", getClientIp(h({ "x-forwarded-for": "203.0.113.7" }), one) === "203.0.113.7");
  check(
    "count=1: a spoofed prefix is ignored",
    getClientIp(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 203.0.113.7" }), one) === "203.0.113.7",
  );
  const spoofs = new Set(
    Array.from({ length: 50 }, (_, i) => getClientIp(h({ "x-forwarded-for": `10.9.${i}.1, 203.0.113.7` }), one)),
  );
  check("count=1: 50 different spoofed IPs all share the real client's bucket", spoofs.size === 1 && spoofs.has("203.0.113.7"));
  check(
    "count=2: the client before two trusted hops",
    getClientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 172.70.1.1" }), { proxyCount: 2 }) === "203.0.113.7",
  );
  check(
    "count=2 with one entry → shared bucket (not via the expected chain)",
    getClientIp(h({ "x-forwarded-for": "203.0.113.7" }), { proxyCount: 2 }) === "unattributed",
  );
  check("count=1: IPv6 works", getClientIp(h({ "x-forwarded-for": "6.6.6.6, 2001:db8::1" }), one) === "2001:db8::1");

  const hdr = { header: "true-client-ip" };
  check(
    "header: used, and X-Forwarded-For ignored",
    getClientIp(h({ "true-client-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6" }), hdr) === "203.0.113.7",
  );
  check(
    "header missing, no count → shared bucket, NOT the spoofable first entry",
    getClientIp(h({ "x-forwarded-for": "6.6.6.6" }), hdr) === "unattributed",
  );
  check(
    "header missing, count=1 → count fallback",
    getClientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), { ...hdr, proxyCount: 1 }) === "203.0.113.7",
  );
  check("header with a non-IP value → shared bucket", getClientIp(h({ "true-client-ip": "x" }), hdr) === "unattributed");
  const cfg = clientIpConfigFromEnv({ TRUSTED_PROXY_COUNT: "2", CLIENT_IP_HEADER: "True-Client-IP" });
  check("config from env parses (header lower-cased)", cfg.proxyCount === 2 && cfg.header === "true-client-ip");
  check("config from env ignores garbage counts", clientIpConfigFromEnv({ TRUSTED_PROXY_COUNT: "abc" }).proxyCount === undefined);

  // 2 ── Owner-review gate ────────────────────────────────────────────────
  console.log("2. Owner-review gate");
  const { NextRequest } = require("next/server") as typeof import("next/server");
  const { ownerGateAllows, ownerGateChallenge } = require("../src/lib/security/owner-gate") as typeof import("../src/lib/security/owner-gate");
  const req = (path: string, auth?: string) =>
    new NextRequest(`https://qrapp.ge${path}`, { headers: auth ? { authorization: `Basic ${btoa(auth)}` } : {} });

  delete ENV.OWNER_REVIEW_GATE_PASSWORD;
  check("off when no password is configured", ownerGateAllows(req("/")));
  ENV.OWNER_REVIEW_GATE_USER = "owner";
  ENV.OWNER_REVIEW_GATE_PASSWORD = "correct-horse-battery";
  check("no credentials → refused", !ownerGateAllows(req("/")));
  check("wrong password → refused", !ownerGateAllows(req("/", "owner:wrong")));
  check("wrong user → refused", !ownerGateAllows(req("/", "admin:correct-horse-battery")));
  check("a password prefix → refused", !ownerGateAllows(req("/", "owner:correct-horse")));
  check("correct credentials → allowed", ownerGateAllows(req("/", "owner:correct-horse-battery")));
  check("a password containing ':' works", (ENV.OWNER_REVIEW_GATE_PASSWORD = "a:b:c", ownerGateAllows(req("/", "owner:a:b:c"))));
  check("QR pages are gated", !ownerGateAllows(req("/g/ABCDEF")));
  check("API routes are gated", !ownerGateAllows(req("/api/qr/123")));
  check("dashboards are gated", !ownerGateAllows(req("/admin/dashboard")) && !ownerGateAllows(req("/partner/login")));
  check("the IP diagnostics endpoint is gated", !ownerGateAllows(req("/api/ops/client-ip")));
  check("/api/health stays open", ownerGateAllows(req("/api/health")));
  check("/api/health-anything is not", !ownerGateAllows(req("/api/healthz")));
  check("/api/cron/* stays open (own bearer secret)", ownerGateAllows(req("/api/cron/payments-reconcile")));
  const challenge = ownerGateChallenge();
  check(
    "challenge is 401 + WWW-Authenticate + noindex",
    challenge.status === 401 && /^Basic /.test(challenge.headers.get("www-authenticate") ?? "") && /noindex/.test(challenge.headers.get("x-robots-tag") ?? ""),
  );
  delete ENV.OWNER_REVIEW_GATE_PASSWORD;
  delete ENV.OWNER_REVIEW_GATE_USER;

  // 3 ── Media limits ─────────────────────────────────────────────────────
  console.log("3. Media limits vs Supabase Free (50 MB per file)");
  const media = require("../src/lib/validation/content-types") as typeof import("../src/lib/validation/content-types");
  const MiB = 1024 * 1024;
  const SUPABASE_FREE_MAX = 50 * MiB;
  check("video limit is 50 MB", media.sizeLimitFor("video") === 50 * MiB);
  check("photo (15 MB) and audio (20 MB) unchanged", media.sizeLimitFor("photo") === 15 * MiB && media.sizeLimitFor("audio") === 20 * MiB);
  check("bucket limit = largest type limit = 50 MB", media.MAX_MEDIA_BYTES === 50 * MiB);
  check("no type exceeds Supabase Free's per-file cap", (["photo", "video", "audio"] as const).every((t) => media.sizeLimitFor(t) <= SUPABASE_FREE_MAX));
  const upload = (sizeBytes: number) => {
    try {
      media.validateMediaUpload({ type: "video", slot: 0, mimeType: "video/mp4", sizeBytes });
      return true;
    } catch {
      return false;
    }
  };
  check("a 50 MB video is accepted", upload(50 * MiB));
  check("50 MB + 1 byte is refused", !upload(50 * MiB + 1));
  const seed = readFileSync(join(__dirname, "../src/db/seed.ts"), "utf8");
  check("seed creates the bucket with MAX_MEDIA_BYTES (no hard-coded size)", /fileSizeLimit: MAX_MEDIA_BYTES/.test(seed) && !/fileSizeLimit: "\d+MB"/.test(seed));
  check("seed re-aligns an existing bucket and keeps it private", /updateBucket\(bucketName, settings\)/.test(seed) && /public: false/.test(seed));

  // 4 ── Checkout-disabled mode ───────────────────────────────────────────
  console.log("4. Checkout-disabled mode");
  type Gate = typeof import("../src/lib/payments/checkout-gate");
  const gatePath = "../src/lib/payments/checkout-gate";
  const prodRender = { ...BASE_ENV, NODE_ENV: "production", RENDER: "true", TRUSTED_PROXY_COUNT: "1", PAYMENTS_PROVIDER: "TEST" };

  let gate = loadWith<Gate>(prodRender, gatePath);
  check("production + TEST → checkout closed", !gate.isCheckoutOpen());
  let threw: unknown = null;
  try {
    gate.assertCheckoutOpen();
  } catch (err) {
    threw = err;
  }
  check("…and assertCheckoutOpen throws CheckoutUnavailableError (→ 'Payments open soon')", threw instanceof gate.CheckoutUnavailableError);
  gate = loadWith<Gate>({ ...prodRender, CHECKOUT_ENABLED: "true" }, gatePath);
  check("production + TEST stays closed even with CHECKOUT_ENABLED=true", !gate.isCheckoutOpen());
  gate = loadWith<Gate>({ ...prodRender, ALLOW_TEST_PAYMENTS: "true" }, gatePath);
  check("production + TEST stays closed even with ALLOW_TEST_PAYMENTS=true", !gate.isCheckoutOpen());
  gate = loadWith<Gate>({ ...BASE_ENV, NODE_ENV: "development", PAYMENTS_PROVIDER: "TEST", ALLOW_TEST_PAYMENTS: "true" }, gatePath);
  check("development + TEST is unchanged (open, simulated)", gate.isCheckoutOpen());

  // 5 ── Render startup guards ────────────────────────────────────────────
  console.log("5. Render startup guards");
  const envPath = "../src/lib/env";
  const loads = (vars: Record<string, string>) => {
    try {
      loadWith(vars, envPath);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };
  check("the Render review config starts", loads(prodRender) === null);
  check("Render without TRUSTED_PROXY_COUNT/CLIENT_IP_HEADER refuses to start", /TRUSTED_PROXY_COUNT/.test(loads({ ...prodRender, TRUSTED_PROXY_COUNT: "" }) ?? ""));
  check("Render + local database refuses to start", /local database/.test(loads({ ...prodRender, DATABASE_URL: "postgresql://app_runtime:x@127.0.0.1:54322/postgres" }) ?? ""));
  check("Render + superuser DATABASE_URL refuses to start", /app_runtime/.test(loads({ ...prodRender, DATABASE_URL: "postgresql://postgres.abcdefgh:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" }) ?? ""));
  check("Render + local Supabase refuses to start", /local Supabase/.test(loads({ ...prodRender, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }) ?? ""));
  check("Render + http app URL refuses to start", /https/.test(loads({ ...prodRender, NEXT_PUBLIC_APP_URL: "http://qrapp.ge" }) ?? ""));
  check("any host with APP_HOSTED=true gets the same guards", /TRUSTED_PROXY_COUNT/.test(loads({ ...prodRender, RENDER: "", APP_HOSTED: "true", TRUSTED_PROXY_COUNT: "" }) ?? ""));
  check("a local production build still starts without IP settings", loads({ ...BASE_ENV, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000", DATABASE_URL: "postgresql://app_runtime:x@127.0.0.1:54322/postgres" }) === null);

  // 6 ── render.yaml ──────────────────────────────────────────────────────
  console.log("6. render.yaml");
  const blueprint = readFileSync(join(__dirname, "../render.yaml"), "utf8");
  const envValue = (key: string) => new RegExp(`- key: ${key}\\n\\s+value: "?([^"\\n]+)"?`).exec(blueprint)?.[1];
  const generated = (key: string) => new RegExp(`- key: ${key}\\n\\s+generateValue: true`).test(blueprint);
  const dashboardOnly = (key: string) => new RegExp(`- key: ${key}\\n\\s+sync: false`).test(blueprint);
  check("Free or Starter plan in Frankfurt with /api/health as health check", /plan: (free|starter)/.test(blueprint) && /region: frankfurt/.test(blueprint) && /healthCheckPath: \/api\/health/.test(blueprint));
  check("Node 22 (package.json engines)", envValue("NODE_VERSION") === "22");
  check("PAYMENTS_PROVIDER=TEST, ALLOW_TEST_PAYMENTS=false, CHECKOUT_ENABLED=false", envValue("PAYMENTS_PROVIDER") === "TEST" && envValue("ALLOW_TEST_PAYMENTS") === "false" && envValue("CHECKOUT_ENABLED") === "false");
  check("no BOG_* variable and no CRON_SECRET", !/BOG_|CRON_SECRET/.test(blueprint));
  check(
    "client IP: CF-Connecting-IP with a 3-hop fallback (verified on Render)",
    envValue("CLIENT_IP_HEADER") === "cf-connecting-ip" && envValue("TRUSTED_PROXY_COUNT") === "3",
  );
  check("IP diagnostics endpoint off", envValue("CLIENT_IP_DIAGNOSTICS") === "false");
  check("NEXT_PUBLIC_APP_URL=https://qrapp.ge", envValue("NEXT_PUBLIC_APP_URL") === "https://qrapp.ge");
  check("gate password + edit-token secret are generated by Render", generated("OWNER_REVIEW_GATE_PASSWORD") && generated("EDIT_TOKEN_SECRET"));
  check(
    "database/Supabase secrets are dashboard-only (sync: false)",
    ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].every(dashboardOnly),
  );
  check("no MIGRATIONS_DATABASE_URL on the runtime service", !/MIGRATIONS_DATABASE_URL/.test(blueprint));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

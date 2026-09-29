import Module from "node:module";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { checkRateLimit } = require("../src/lib/rate-limit/store") as typeof import("../src/lib/rate-limit/store");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const admin = postgres(migrationsUrl, { max: 1 });

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const runId = crypto.randomUUID().slice(0, 8);

  console.log("\n--- Allows up to the configured limit ---");
  {
    const key = `verify-rl:basic:${runId}`;
    let allAllowed = true;
    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit({ key, limit: 5, windowSeconds: 60 });
      if (!result.allowed) allAllowed = false;
    }
    check("1. All 5 calls within a limit of 5 are allowed", allAllowed);
  }

  console.log("\n--- Blocks the call after the limit is exceeded ---");
  {
    const key = `verify-rl:overflow:${runId}`;
    for (let i = 0; i < 5; i++) {
      await checkRateLimit({ key, limit: 5, windowSeconds: 60 });
    }
    const sixth = await checkRateLimit({ key, limit: 5, windowSeconds: 60 });
    check("2. The 6th call within the same window is blocked", !sixth.allowed);
    check("3. A blocked result carries a positive retryAfterSeconds", (sixth.retryAfterSeconds ?? 0) > 0);
  }

  console.log("\n--- A different key never shares a bucket with an exhausted one ---");
  {
    const exhaustedKey = `verify-rl:tenantA:${runId}`;
    const otherKey = `verify-rl:tenantB:${runId}`;
    for (let i = 0; i < 5; i++) {
      await checkRateLimit({ key: exhaustedKey, limit: 5, windowSeconds: 60 });
    }
    const exhausted = await checkRateLimit({ key: exhaustedKey, limit: 5, windowSeconds: 60 });
    const other = await checkRateLimit({ key: otherKey, limit: 5, windowSeconds: 60 });
    check("4. The exhausted key's own next call is blocked", !exhausted.allowed);
    check("5. A distinct key is unaffected by another key's exhausted bucket", other.allowed);
  }

  console.log("\n--- Concurrent hits on the same key are counted atomically ---");
  {
    const key = `verify-rl:concurrent:${runId}`;
    const results = await Promise.all(Array.from({ length: 10 }, () => checkRateLimit({ key, limit: 5, windowSeconds: 60 })));
    const allowedCount = results.filter((r) => r.allowed).length;
    check("6. Exactly 5 of 10 truly concurrent calls to the same key are allowed", allowedCount === 5, `got ${allowedCount}`);
  }

  console.log("\n--- A new window resets the count ---");
  {
    const key = `verify-rl:window-reset:${runId}`;
    for (let i = 0; i < 2; i++) {
      await checkRateLimit({ key, limit: 2, windowSeconds: 1 });
    }
    const withinWindow = await checkRateLimit({ key, limit: 2, windowSeconds: 1 });
    check("7. The 3rd call within the same 1s window is blocked", !withinWindow.allowed);
    await sleep(1200);
    const nextWindow = await checkRateLimit({ key, limit: 2, windowSeconds: 1 });
    check("8. The first call in the next window is allowed again", nextWindow.allowed);
  }

  console.log("\nCleaning up fixtures...");
  await admin`delete from rate_limit_hits where key like ${"verify-rl:%:" + runId}`;
  await admin.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end();
  process.exit(1);
});

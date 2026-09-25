import { defineConfig, devices } from "@playwright/test";

/**
 * Minimal, focused config — Desktop Chromium plus one mobile-viewport
 * emulation project (per the audit's Phase 8 requirement), not a full
 * cross-browser matrix. Browser-emulated mobile is explicitly NOT a
 * substitute for the real-device checklist in docs/MOBILE_QA_CHECKLIST.md —
 * see that file and docs/CI.md.
 *
 * Boots the app itself against the TEST payment provider so the checkout
 * spec can exercise a real (simulated) payment without any real provider or
 * production credentials. Requires local Supabase already running
 * (`supabase start`) and migrated/seeded — the same precondition every
 * `verify:*` script already has.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false, // fixtures share the same local DB — avoid cross-test interference
  // Forced to 1: with >1 worker, separate spec files hit the single shared
  // `next dev` webServer concurrently on cold (not-yet-compiled) routes,
  // which reproducibly threw a webpack module-resolution error on the first
  // concurrent request and cascaded into unrelated fixture failures.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  // 10s rather than Playwright's 5s default: next dev compiles each route on
  // its first hit, and this suite deliberately runs against dev (not a
  // production build) since PAYMENTS_PROVIDER=TEST is refused outright when
  // NODE_ENV=production (see provider-factory.ts) — the checkout test has no
  // way to run against `next start`. A generous assertion timeout absorbs
  // that first-hit compile pause instead of flaking on it.
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    // A Chromium-based mobile-viewport emulation, not devices["iPhone 13"]
    // (which defaults to the WebKit engine) — WebKit's headless process
    // could not be launched at all in this environment (every WebKit test
    // hung for the full 180s browser-launch timeout). Pixel 7 still exercises
    // real mobile-viewport emulation per the audit's Phase 8 requirement;
    // it's simply Chromium underneath rather than WebKit.
    { name: "mobile-emulated", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PAYMENTS_PROVIDER: "TEST",
    },
  },
});

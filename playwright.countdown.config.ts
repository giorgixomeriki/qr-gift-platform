import { defineConfig, devices } from "@playwright/test";

/**
 * Scheduled Reveal + Celebration Countdown e2e, isolated: no globalSetup (the
 * default one resets the shared dev admin's MFA on the local Supabase stack,
 * which other worktrees may be using). Boots `next dev` (TEST payments are
 * refused under NODE_ENV=production) with the lab enabled.
 *
 *   npx playwright test -c playwright.countdown.config.ts
 */
const port = process.env.E2E_PORT ?? "3978";
export default defineConfig({
  testDir: "./e2e",
  testMatch: process.env.PW_MATCH ? new RegExp(process.env.PW_MATCH) : /scheduled-reveal\.spec\.ts/,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-emulated", use: { ...devices["Pixel 7"] } },
    { name: "iphone-webkit", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: `node --env-file=.env.local ./node_modules/.bin/next dev -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { PAYMENTS_PROVIDER: "TEST", ALLOW_TEST_PAYMENTS: "true", NEXT_PUBLIC_LAB: "1" },
  },
});

import { defineConfig, devices } from "@playwright/test";

/**
 * "Our Song" providers e2e (e2e/music-providers.spec.ts), isolated like the
 * countdown config: no globalSetup, `next dev` on its own port.
 *
 *   npx playwright test -c playwright.music.config.ts                 metadata flags off (production default)
 *   MUSIC_META=1 E2E_PORT=3981 npx playwright test -c playwright.music.config.ts   flags on: real oEmbed calls
 */
const port = process.env.E2E_PORT ?? "3980";
const meta = process.env.MUSIC_META === "1" ? "1" : "";
export default defineConfig({
  testDir: "./e2e",
  testMatch: process.env.PW_MATCH ? new RegExp(process.env.PW_MATCH) : /music-providers\.spec\.ts/,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-webkit", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: `node --env-file=.env.local ./node_modules/.bin/next dev -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { PAYMENTS_PROVIDER: "TEST", ALLOW_TEST_PAYMENTS: "true", MUSIC_METADATA_YOUTUBE: meta },
  },
});

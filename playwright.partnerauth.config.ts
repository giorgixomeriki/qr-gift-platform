import { defineConfig, devices } from "@playwright/test";
// Local-only config for the partner-auth worktree: no globalSetup (it resets
// shared dev-admin MFA), no webServer (a `next start` build runs on :3992
// against the dedicated qrpartnerauth Supabase stack).
export default defineConfig({
  testDir: "./e2e",
  testMatch: process.env.PW_MATCH ? new RegExp(process.env.PW_MATCH) : /partner-login-access\.spec\.ts/,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3992", trace: "retain-on-failure" },
  outputDir: "/private/tmp/claude-501/-Users-G-s-m-Desktop-QR/9c7b785e-9b67-46d7-b1ac-67f4b61b065f/scratchpad/pw-results",
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-emulated", use: { ...devices["Pixel 7"] } },
    { name: "iphone-webkit", use: { ...devices["iPhone 14"] } },
  ],
});

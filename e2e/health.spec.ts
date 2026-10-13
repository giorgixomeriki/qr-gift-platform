import { test, expect } from "@playwright/test";

test.describe("Health check", () => {
  test("reports ok, uncached, and reveals nothing else", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

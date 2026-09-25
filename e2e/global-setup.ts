/**
 * Pre-compiles every route the suite touches, once, before any test's
 * assertions start racing the clock. `next dev` compiles each route on its
 * first request — hitting that cold-compile mid-test (rather than here,
 * where nothing is asserting yet) is what produced the transient
 * "Unexpected end of JSON input" / "clientReferenceManifest" dev-server
 * errors during earlier runs of this suite. A production build has no
 * on-demand compilation at all, so this warm-up is a `next dev`-only
 * concern — see playwright.config.ts's own note on why this suite must run
 * against dev rather than a production build.
 */
export default async function globalSetup() {
  const baseURL = "http://localhost:3000";
  const routes = ["/", "/partner/login", "/admin/login", "/partner/forgot-password", "/admin/forgot-password", "/reset-password", "/g/warmup-nonexistent-token"];

  for (const route of routes) {
    try {
      await fetch(`${baseURL}${route}`);
    } catch {
      // The webServer may still be coming up for the very first route — a
      // failed warm-up request is harmless, it just means that route will
      // compile on the real test's first hit instead of here.
    }
  }
}

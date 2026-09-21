import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

// Read directly rather than through lib/env.public.ts — this file runs in
// Next's build/config context, before the app's own module graph (and its
// "server-only" guards) exist. Falls back to '*' only for local dev when the
// var is genuinely unset, so a missing env var never silently produces an
// empty (i.e. same-origin-only, breaking real Supabase calls) connect-src.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * Baseline security headers (Phase 4 §20) — PRODUCTION ONLY. Confirmed live
 * that applying these in development breaks the dev environment: Next's
 * dev-mode Fast Refresh runtime needs eval() (script-src), and — more
 * surprisingly — something in this local toolchain (most likely
 * X-Frame-Options/frame-ancestors, possibly interacting with browser
 * automation/devtools instrumentation) reproducibly left every page
 * rendering blank after these headers were added, independent of route or
 * of any app code. Rather than chase that down for a local-only value,
 * these headers simply don't apply outside NODE_ENV=production, where none
 * of that tooling is present and the headers matter for real.
 *
 * CSP here is deliberately not maximally strict — this app renders a
 * handful of literal inline <style> tags (e.g. the print sheet's @media
 * print rules) and relies on React's ordinary inline `style` props
 * throughout, so style-src allows 'unsafe-inline' rather than taking on
 * nonce plumbing for a polish phase. script-src does NOT allow
 * unsafe-inline/unsafe-eval — no inline <script> exists anywhere in the
 * production app (see components/admin/print-button.tsx's comment).
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseUrl}`,
  `media-src 'self' blob: ${supabaseUrl}`,
  `connect-src 'self' ${supabaseUrl}`,
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly rather than relying on Turbopack's
  // upward-scanning inference, which picked the wrong boundary when this
  // project lived under a path with an ancestor package-lock.json.
  turbopack: {
    root: path.join(__dirname),
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);

import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Content-Security-Policy is NOT set here: it needs a fresh nonce per
  // request, so middleware.ts builds it (lib/security/csp.ts). A static CSP
  // here would be sent alongside it and, being nonce-less, block every
  // inline script Next.js streams — blanking every page.
];

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly rather than relying on Turbopack's
  // upward-scanning inference, which picked the wrong boundary when this
  // project lived under a path with an ancestor package-lock.json.
  turbopack: {
    root: path.join(__dirname),
  },
  // The dev-tools badge sits bottom-left over the phone layout: it covered the
  // left edge of the sticky Continue/Pay bar and the reveal's Previous button,
  // so taps there opened the dev menu instead. Runtime errors still surface.
  devIndicators: false,
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);

import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env.public";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";

/**
 * Two jobs:
 *
 * 1. Production Content-Security-Policy with a per-request nonce (every
 *    page). The policy goes on the REQUEST so Next.js can stamp the nonce on
 *    the inline scripts it streams, and on the RESPONSE so the browser
 *    enforces it. See lib/security/csp.ts for why a nonce is required. Not
 *    applied in development: React's dev runtime relies on eval, and the
 *    other security headers are production-only too (next.config.ts).
 *
 * 2. Standard @supabase/ssr session refresh, only on partner/admin routes —
 *    the sender/recipient surfaces have no Supabase session, so /g/* never
 *    pays for an auth round-trip.
 */
export async function middleware(request: NextRequest) {
  const csp =
    process.env.NODE_ENV === "production" ? buildContentSecurityPolicy(createNonce(), publicEnv.NEXT_PUBLIC_SUPABASE_URL) : null;

  // Rebuilt from the request each time so cookie updates made below by the
  // Supabase client are forwarded along with the CSP header.
  const forward = () => {
    const headers = new Headers(request.headers);
    if (csp) headers.set("content-security-policy", csp);
    return NextResponse.next({ request: { headers } });
  };

  let response = forward();

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/partner") || pathname.startsWith("/admin")) {
    const supabase = createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = forward();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });
    await supabase.auth.getUser();
  }

  if (csp) response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Every page. Skips static files and API routes (JSON/CSV/SVG
      // responses execute no scripts), and prefetches (they reuse the
      // nonce-bearing document that triggered them).
      source: "/((?!api|_next/static|_next/image|fonts/|customer/|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    // Partner/admin keep the session refresh on every request, prefetches
    // included — exactly as before the CSP moved here.
    "/partner/:path*",
    "/admin/:path*",
  ],
};

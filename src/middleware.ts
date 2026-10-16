import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env.public";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";
import { ownerGateAllows, ownerGateChallenge } from "@/lib/security/owner-gate";

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
 *
 * Plus, before either: the optional owner-review gate (lib/security/owner-gate.ts).
 * When OWNER_REVIEW_GATE_PASSWORD is set, every request except the static
 * bundle, /api/health and /api/cron/* needs HTTP Basic credentials.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!ownerGateAllows(request)) return ownerGateChallenge();

  // The matcher is broad so the gate also covers API routes, media and
  // prefetches; CSP and the session refresh keep their original scope.
  const isPrefetch =
    request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
  const isDashboard = pathname.startsWith("/partner") || pathname.startsWith("/admin");
  const isPage = !/^\/(api|_next\/image|fonts\/|customer\/)/.test(pathname);
  if (!isDashboard && (!isPage || isPrefetch)) return NextResponse.next();

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

  if (isDashboard) {
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
  // Everything but the static bundle and the favicon: the owner-review gate
  // must cover API routes, media and prefetches too. The branches at the top
  // of middleware() give CSP and the session refresh their original scope
  // (pages, not API/static/media/prefetches; partner/admin always).
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enforceRateLimit, getClientIp, RateLimitedError } from "@/lib/rate-limit";

/**
 * Supabase email-link landing point (password recovery today; the same
 * pattern would serve email-confirmation links later). Exchanges the
 * short-lived `code` for a real session server-side, then redirects to the
 * actual "set a new password" screen.
 *
 * `next` is NEVER reflected as a raw redirect target — only "admin" or
 * "partner" are accepted, mapped to a fixed internal path. This is the
 * allowlisted-redirect requirement from the audit: a URL like
 * `?next=https://evil.example` cannot make this handler redirect anywhere
 * an attacker chose.
 */
const ALLOWED_ROLES = new Set(["admin", "partner"]);

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedRole = request.nextUrl.searchParams.get("next");
  const role = requestedRole && ALLOWED_ROLES.has(requestedRole) ? requestedRole : "partner";

  // AUTHENTICATION-SENSITIVE: this handler burns a Supabase auth call
  // (exchangeCodeForSession) per hit, keyed by IP since the code itself is
  // single-use and unauthenticated at this point. Fails open (see
  // checkRateLimit) so a rate-limit-store outage never blocks a real
  // password reset — Supabase's own [auth.rate_limit] remains the backstop.
  const ip = getClientIp(request.headers);
  try {
    await enforceRateLimit({ key: `auth-confirm:${ip}`, limit: 20, windowSeconds: 60 });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } },
      );
    }
    throw err;
  }

  if (!code) {
    return NextResponse.redirect(new URL(`/reset-password?role=${role}&error=invalid`, request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL(`/reset-password?role=${role}&error=invalid`, request.url));
  }

  return NextResponse.redirect(new URL(`/reset-password?role=${role}`, request.url));
}

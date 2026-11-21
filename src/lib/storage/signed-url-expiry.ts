/**
 * How long a Supabase signed Storage URL is valid: its `token` is a JWT, and
 * `exp − iat` is its lifetime. A lifetime, not the absolute `exp`: the page
 * measures it from when it received the URL on its own clock, so a phone
 * whose clock is minutes off still renews at the right moment (comparing
 * `exp` with a fast clock would renew forever).
 * Null for a URL with no token (a local blob) or an unreadable one — callers
 * then never try to renew it. Shared by the voice player and verify-voice.
 */
export function signedUrlLifetimeMs(url: string): number | null {
  try {
    const token = new URL(url).searchParams.get("token");
    const part = token?.split(".")[1];
    if (!part) return null;
    const { exp, iat } = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown; iat?: unknown };
    return typeof exp === "number" && typeof iat === "number" && exp > iat ? (exp - iat) * 1000 : null;
  } catch {
    return null;
  }
}

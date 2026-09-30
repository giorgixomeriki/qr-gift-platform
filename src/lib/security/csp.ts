/**
 * Content-Security-Policy for production, built per request around a
 * one-time nonce (see middleware.ts).
 *
 * Why a nonce: the App Router streams HTML with inline <script> tags —
 * React's streaming instructions ($RC, $RS…) that reveal each streamed
 * segment, and the RSC payload (self.__next_f.push). A static
 * `script-src 'self'` blocks all of them, which leaves every page blank
 * (content stays in hidden streaming placeholders). Next.js reads the nonce
 * from this header on the request and stamps it on every script it emits,
 * so only scripts produced by this server for this response can run —
 * no 'unsafe-inline', no 'unsafe-eval', no wildcard origins.
 *
 * 'strict-dynamic' lets those nonce-trusted scripts load the app's own
 * chunks; 'self' is only a fallback for browsers without CSP3.
 *
 * Every other directive is unchanged from the previous static policy:
 * style-src keeps 'unsafe-inline' because React renders inline `style`
 * attributes (which nonces cannot cover), and Supabase is the only external
 * origin (storage media + auth API).
 */
export function buildContentSecurityPolicy(nonce: string, supabaseUrl: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabaseUrl}`,
    `media-src 'self' blob: ${supabaseUrl}`,
    `connect-src 'self' ${supabaseUrl}`,
    "form-action 'self'",
  ].join("; ");
}

/** 128 bits from the platform CSPRNG, base64 — the character set Next.js accepts for nonces. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

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
 *
 * Partner locations map (components/maps): vector tiles, glyphs and the
 * tile manifest come from OpenFreeMap over fetch (connect-src), and MapLibre
 * decodes them in a same-origin module worker (public/vendor) — worker-src
 * names it explicitly, since with 'strict-dynamic' script-src no longer
 * honours 'self' for workers. blob: covers MapLibre's fallback worker.
 */
export const MAP_TILE_ORIGIN = "https://tiles.openfreemap.org";

export function buildContentSecurityPolicy(nonce: string, supabaseUrl: string, opts: { spotifyEmbed?: boolean; musicArtOrigins?: readonly string[] } = {}): string {
  // "Our Song" artwork (lib/music/metadata.ts): provider image hosts, only while that provider's metadata flag is on.
  const art = opts.musicArtOrigins?.length ? ` ${opts.musicArtOrigins.join(" ")}` : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabaseUrl}${art}`,
    `media-src 'self' blob: ${supabaseUrl}`,
    `connect-src 'self' ${supabaseUrl} ${MAP_TILE_ORIGIN}`,
    "worker-src 'self' blob:",
    "form-action 'self'",
    // "Our Song": the official Spotify embed is the only frame ever allowed, and only while
    // SPOTIFY_EMBED_ENABLED=1 (lib/music/flag.ts). Off, frames fall back to default-src 'self'.
    ...(opts.spotifyEmbed ? ["frame-src https://open.spotify.com"] : []),
  ].join("; ");
}

/** 128 bits from the platform CSPRNG, base64 — the character set Next.js accepts for nonces. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

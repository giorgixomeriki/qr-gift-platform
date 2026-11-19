/**
 * Spotify's official embedded player is OFF unless SPOTIFY_EMBED_ENABLED=1.
 *
 * QR STARR is a paid product. Spotify's Developer Policy (15 May 2025, §IV.2)
 * says "commercial uses are not permitted" for streaming integrations, and
 * embeds are governed by the separate Widget Terms (2014); neither explicitly
 * clears an embed inside a paid greeting. Until Spotify confirms in writing
 * that this use is permitted, the recipient gets the canonical link and a
 * "Listen on Spotify" action only. See docs/music/OUR-SONG.md.
 *
 * Read on the server per request (page + CSP middleware) — never shipped as a
 * public build-time constant, so turning it off needs no rebuild.
 */
export function spotifyEmbedEnabled(): boolean {
  return process.env.SPOTIFY_EMBED_ENABLED === "1";
}

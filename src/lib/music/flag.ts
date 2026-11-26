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

/**
 * Title / artist / artwork on the "Our Song" card, fetched per view from the
 * provider's public oEmbed endpoint (lib/music/metadata.ts). OFF unless set:
 *
 * - MUSIC_METADATA_SPOTIFY=1 — Spotify's Developer Policy IV.2 / Terms V.5
 *   (effective 15 May 2025, unchanged as of 2026-11-26) do not clearly allow
 *   Spotify cover art or metadata in a paid product. Needs Spotify's written
 *   confirmation AND the official Spotify logo asset for attribution first.
 * - MUSIC_METADATA_YOUTUBE=1 — YouTube API Services require our Terms to link
 *   YouTube's Terms of Service and our Privacy Policy to name YouTube API
 *   Services + link Google's Privacy Policy (Developer Policies III.A.1–2).
 *   Needs that legal-page update (and owner/legal sign-off) first.
 *
 * Off, the card is QR STARR's own record sleeve + the provider link: nothing
 * is fetched from either provider. Read per request; no rebuild to toggle.
 */
export function musicMetadataEnabled(provider: "spotify" | "youtube"): boolean {
  return provider === "spotify" ? process.env.MUSIC_METADATA_SPOTIFY === "1" : process.env.MUSIC_METADATA_YOUTUBE === "1";
}

/** Hosts the card may load artwork from (must match lib/music/metadata.ts); csp.ts adds them only while the flag is on. */
const MUSIC_ART_ORIGINS = {
  spotify: ["https://i.scdn.co", "https://mosaic.scdn.co", "https://*.spotifycdn.com"],
  youtube: ["https://i.ytimg.com"],
} as const;

export function musicArtOrigins(): string[] {
  return [...(musicMetadataEnabled("spotify") ? MUSIC_ART_ORIGINS.spotify : []), ...(musicMetadataEnabled("youtube") ? MUSIC_ART_ORIGINS.youtube : [])];
}

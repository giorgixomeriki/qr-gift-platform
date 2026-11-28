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
 * - Spotify: never. Developer Policy IV.2 ("commercial uses are not permitted"
 *   except narrow Non-Streaming cases), Terms III.1.1 / V.5 and the design rules
 *   (no co-branding; artwork unaltered, with the full Spotify logo) do not clear
 *   cover art or titles inside a paid, branded greeting (checked 2026-11-26).
 *   No env switch on purpose: enabling it needs Spotify's written permission and
 *   a code change, not a config flip. The Spotify card is our record sleeve + link.
 * - MUSIC_METADATA_YOUTUBE=1 — YouTube API Services require our Terms to link
 *   YouTube's Terms of Service and our Privacy Policy to name YouTube API
 *   Services + link Google's Privacy Policy (Developer Policies III.A.1–2).
 *   Needs that legal-page update (and owner/legal sign-off) first.
 *
 * Off, the card is QR STARR's own record sleeve + the provider link: nothing
 * is fetched from either provider. Read per request; no rebuild to toggle.
 */
export function musicMetadataEnabled(provider: "spotify" | "youtube"): boolean {
  return provider === "youtube" && process.env.MUSIC_METADATA_YOUTUBE === "1";
}

/** Hosts the card may load artwork from (must match lib/music/metadata.ts); csp.ts adds them only while the flag is on. */
const YOUTUBE_ART_ORIGINS = ["https://i.ytimg.com"] as const;

export function musicArtOrigins(): string[] {
  return musicMetadataEnabled("youtube") ? [...YOUTUBE_ART_ORIGINS] : [];
}

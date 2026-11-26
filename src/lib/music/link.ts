/**
 * "Our Song": the one music link a greeting may carry — a Spotify track or
 * playlist (lib/music/spotify.ts) or a YouTube / YouTube Music video
 * (lib/music/youtube.ts). Provider-neutral entry points used by the sender
 * field, the server action, the page loader and the card.
 *
 * Stored in greeting_content (type 'music', slot 0) as a canonical URI:
 *   spotify:<track|playlist>:<22-char id>   (unchanged since 0022)
 *   youtube:<video|music>:<11-char id>      (new; no migration — text_value is free text)
 * Code without YouTube support reads a youtube: row as "no music", so a
 * rollback never breaks a greeting.
 */
import { MUSIC_INPUT_MAX, parseSpotifyInput, parseStoredMusic as parseStoredSpotify, spotifyOpenUrl, toSpotifyUri, type SpotifyMusic } from "./spotify";
import { isYouTubeHost, parseStoredYouTube, parseYouTubeUrl, toYouTubeUri, youTubeOpenUrl, type YouTubeMusic } from "./youtube";

export { MUSIC_INPUT_MAX };

export type SpotifyMusicRef = SpotifyMusic & { provider: "spotify" };
export type MusicRef = SpotifyMusicRef | YouTubeMusic;
export type MusicProvider = MusicRef["provider"];
/** Which brand the link opens in — also how the card names its source. */
export type MusicService = "spotify" | "youtube" | "youtubeMusic";

export type MusicParseError = "empty" | "tooLong" | "notSupported" | "shortLink" | "unsupported" | "invalid";
export type MusicParseResult = { ok: true; music: MusicRef } | { ok: false; error: MusicParseError };

export function parseMusicInput(raw: unknown): MusicParseResult {
  const spotify = parseSpotifyInput(raw);
  if (spotify.ok) return { ok: true, music: { provider: "spotify", ...spotify.music } };
  if (spotify.error !== "notSpotify") return { ok: false, error: spotify.error };

  // Not a Spotify link: the only other place a song may come from is YouTube.
  // parseSpotifyInput has already refused non-strings, empties, over-long input and whitespace.
  const input = (raw as string).trim();
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !isYouTubeHost(url.hostname)) return { ok: false, error: "notSupported" };
  const yt = parseYouTubeUrl(url);
  if (yt.ok) return yt;
  return { ok: false, error: yt.error === "notYouTube" ? "notSupported" : yt.error };
}

export function toStoredMusic(music: MusicRef): string {
  return music.provider === "youtube" ? toYouTubeUri(music) : toSpotifyUri(music);
}

/** Strict reader for persisted values; anything non-canonical is "no music" (the greeting still opens). */
export function parseStoredMusic(value: string | null | undefined): MusicRef | null {
  const spotify = parseStoredSpotify(value);
  if (spotify) return { provider: "spotify", ...spotify };
  return parseStoredYouTube(value);
}

/** The canonical page on the provider, rebuilt from the validated id (throws on a forged reference). */
export function musicOpenUrl(music: MusicRef): string {
  return music.provider === "youtube" ? youTubeOpenUrl(music) : spotifyOpenUrl(music);
}

export function musicService(music: MusicRef): MusicService {
  if (music.provider === "spotify") return "spotify";
  return music.kind === "music" ? "youtubeMusic" : "youtube";
}

/** A stable key for caches and test hooks: never contains sender input. */
export function musicKey(music: MusicRef): string {
  return toStoredMusic(music);
}

/**
 * What a provider says about the linked item, fetched per view while the
 * provider's metadata flag is on (lib/music/metadata.ts). Every field is
 * provider-supplied and sanitised; a missing one stays null — never guessed.
 *  - "ok": something to show (title and/or artwork).
 *  - "unavailable": the provider answered that the item doesn't exist (404).
 * No metadata at all (flag off, timeout, provider error, rate limit) is `null`.
 */
export type MusicMeta =
  | { status: "ok"; title: string | null; author: string | null; artworkUrl: string | null; artworkAspect: "square" | "wide" }
  | { status: "unavailable" };

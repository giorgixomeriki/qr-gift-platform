/**
 * "Our Song": one Spotify track or playlist attached to a greeting.
 *
 * Shared by server (validation before persistence, re-validation on every
 * read) and client (instant feedback while typing). The sender's raw input is
 * NEVER stored, rendered as a link, or put in an iframe: it is parsed down to
 * a kind + a 22-character base62 id, and every URL the app ever emits is
 * rebuilt from those two values against fixed Spotify origins. That is the
 * whole XSS / open-redirect / iframe-injection defence — there is no path by
 * which sender-controlled text reaches an href or src.
 *
 * Accepted:  https://open.spotify.com/track/<id>        (optional /intl-xx/, ?si=…, #…)
 *            https://open.spotify.com/playlist/<id>
 *            spotify:track:<id>, spotify:playlist:<id>
 * Rejected:  every other host (incl. look-alikes and spotify.link short links,
 *            which are redirects we refuse to follow), albums/artists/podcasts,
 *            credentials, ports, non-http(s) schemes, malformed ids.
 *
 * Nothing is fetched from Spotify here: no metadata, no artwork, no audio.
 */

export const MUSIC_KINDS = ["track", "playlist"] as const;
export type MusicKind = (typeof MUSIC_KINDS)[number];
export type SpotifyMusic = { kind: MusicKind; id: string };

export type SpotifyParseError = "empty" | "tooLong" | "notSpotify" | "shortLink" | "unsupported" | "invalid";
export type SpotifyParseResult = { ok: true; music: SpotifyMusic } | { ok: false; error: SpotifyParseError };

/** Longer than any real share link (they are ~80 chars with ?si=); anything beyond is not one. */
export const MUSIC_INPUT_MAX = 512;

const ID_RE = /^[A-Za-z0-9]{22}$/;
const STORED_RE = /^spotify:(track|playlist):([A-Za-z0-9]{22})$/;
const UNSUPPORTED_KINDS = new Set(["album", "artist", "episode", "show", "audiobook", "chapter", "user", "collection", "genre", "concert", "prerelease"]);
const OPEN_ORIGIN = "https://open.spotify.com";

function isKind(v: string): v is MusicKind {
  return (MUSIC_KINDS as readonly string[]).includes(v);
}

function classify(kind: string | undefined, id: string | undefined): SpotifyParseResult {
  if (!kind) return { ok: false, error: "invalid" };
  const k = kind.toLowerCase();
  if (!isKind(k)) return { ok: false, error: UNSUPPORTED_KINDS.has(k) ? "unsupported" : "invalid" };
  if (!id || !ID_RE.test(id)) return { ok: false, error: "invalid" };
  return { ok: true, music: { kind: k, id } };
}

export function parseSpotifyInput(raw: unknown): SpotifyParseResult {
  if (typeof raw !== "string") return { ok: false, error: "invalid" };
  const input = raw.trim();
  if (!input) return { ok: false, error: "empty" };
  if (input.length > MUSIC_INPUT_MAX) return { ok: false, error: "tooLong" };
  // Whitespace/control characters inside a link are never part of a real share link.
  if (/[\s\u0000-\u001f\u007f]/.test(input)) return { ok: false, error: "invalid" };

  if (/^spotify:/i.test(input)) {
    const parts = input.split(":");
    if (parts.length !== 3) return { ok: false, error: parts.length > 3 ? "unsupported" : "invalid" };
    return classify(parts[1], parts[2]);
  }

  // A pasted link without a scheme ("open.spotify.com/track/…") is still a link.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "notSpotify" };
  const host = url.hostname.toLowerCase();
  if (host === "spotify.link" || host.endsWith(".app.link") || host === "spoti.fi") return { ok: false, error: "shortLink" };
  if (host !== "open.spotify.com" && host !== "play.spotify.com") return { ok: false, error: "notSpotify" };
  if (url.username || url.password || url.port) return { ok: false, error: "invalid" };

  const segments = url.pathname.split("/").filter(Boolean);
  // Localised links: /intl-ka/track/<id>, /intl-pt-br/track/<id>.
  if (segments[0] && /^intl-[a-z]{2}(-[a-z]{2})?$/i.test(segments[0])) segments.shift();
  // The embed path itself is a valid way to name the same item.
  if (segments[0] === "embed") segments.shift();
  if (segments.length !== 2) {
    // e.g. legacy /user/<name>/playlist/<id>, or a bare /album
    const first = segments[0]?.toLowerCase();
    return { ok: false, error: first && UNSUPPORTED_KINDS.has(first) ? "unsupported" : "invalid" };
  }
  return classify(segments[0], segments[1]);
}

/** Canonical persisted form (greeting_content.text_value). */
export function toSpotifyUri(music: SpotifyMusic): string {
  return `spotify:${music.kind}:${music.id}`;
}

/**
 * Strict reader for persisted values. Anything that is not exactly a
 * canonical URI (a hand-edited row, a future format) is treated as no music —
 * the greeting still renders, it just has no song.
 */
export function parseStoredMusic(value: string | null | undefined): SpotifyMusic | null {
  if (!value) return null;
  const m = STORED_RE.exec(value);
  if (!m) return null;
  return { kind: m[1] as MusicKind, id: m[2]! };
}

/** Always rebuilt from a validated id against the fixed Spotify origin. */
export function spotifyOpenUrl(music: SpotifyMusic): string {
  if (!isKind(music.kind) || !ID_RE.test(music.id)) throw new Error("invalid music reference");
  return `${OPEN_ORIGIN}/${music.kind}/${music.id}`;
}

/** Official embed player URL — only ever used when the embed feature flag is on (see lib/music/flag.ts). */
export function spotifyEmbedUrl(music: SpotifyMusic): string {
  if (!isKind(music.kind) || !ID_RE.test(music.id)) throw new Error("invalid music reference");
  return `${OPEN_ORIGIN}/embed/${music.kind}/${music.id}`;
}

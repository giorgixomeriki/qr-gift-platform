/**
 * "Our Song" on YouTube / YouTube Music: one video attached to a greeting.
 *
 * Same defence as lib/music/spotify.ts: the sender's raw input is parsed down
 * to a kind + an 11-character video id, and every URL the app emits is
 * rebuilt from those two values against fixed YouTube origins. Sender text
 * never reaches an href, src or a server-side fetch.
 *
 * Accepted:  https://www.youtube.com/watch?v=<id>    (m./no-www, extra params: si, t, list, feature…)
 *            https://youtu.be/<id>                   (path-only; the redirect is never followed)
 *            https://music.youtube.com/watch?v=<id>  → kind "music" (opens in YouTube Music)
 *            https://www.youtube.com/shorts/<id>, /live/<id>, /embed/<id>
 * Rejected:  every other host and look-alike, playlists/channels/handles/
 *            search, credentials, ports, non-http(s) schemes, malformed ids.
 */

export const YOUTUBE_KINDS = ["video", "music"] as const;
export type YouTubeKind = (typeof YOUTUBE_KINDS)[number];
export type YouTubeMusic = { provider: "youtube"; kind: YouTubeKind; id: string };

export type YouTubeParseError = "notYouTube" | "unsupported" | "invalid";
export type YouTubeParseResult = { ok: true; music: YouTubeMusic } | { ok: false; error: YouTubeParseError };

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const STORED_RE = /^youtube:(video|music):([A-Za-z0-9_-]{11})$/;
const VIDEO_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const MUSIC_HOST = "music.youtube.com";
const SHORT_HOST = "youtu.be";
/** Paths that name something other than one video: refused with "unsupported", not "invalid". */
const UNSUPPORTED_PATHS = new Set(["playlist", "channel", "c", "user", "results", "feed", "browse", "search", "library", "explore", "podcast", "hashtag", "post"]);

export function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase();
  return VIDEO_HOSTS.has(h) || h === MUSIC_HOST || h === SHORT_HOST;
}

function video(kind: YouTubeKind, id: string | null | undefined): YouTubeParseResult {
  if (!id || !ID_RE.test(id)) return { ok: false, error: "invalid" };
  return { ok: true, music: { provider: "youtube", kind, id } };
}

/** Parses an already-constructed https URL whose host passed isYouTubeHost(). */
export function parseYouTubeUrl(url: URL): YouTubeParseResult {
  const host = url.hostname.toLowerCase();
  if (!isYouTubeHost(host)) return { ok: false, error: "notYouTube" };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "notYouTube" };
  if (url.username || url.password || url.port) return { ok: false, error: "invalid" };

  const segments = url.pathname.split("/").filter(Boolean);
  const kind: YouTubeKind = host === MUSIC_HOST ? "music" : "video";

  if (host === SHORT_HOST) {
    return segments.length === 1 ? video("video", segments[0]) : { ok: false, error: "invalid" };
  }

  const first = segments[0]?.toLowerCase();
  if (first === "watch" && segments.length === 1) {
    const ids = url.searchParams.getAll("v");
    if (ids.length !== 1) return { ok: false, error: url.searchParams.has("list") ? "unsupported" : "invalid" };
    return video(kind, ids[0]);
  }
  if ((first === "shorts" || first === "live" || first === "embed") && segments.length === 2 && kind === "video") {
    return video("video", segments[1]);
  }
  if (first && (UNSUPPORTED_PATHS.has(first) || first.startsWith("@"))) return { ok: false, error: "unsupported" };
  return { ok: false, error: "invalid" };
}

/** Canonical persisted form (greeting_content.text_value). */
export function toYouTubeUri(music: YouTubeMusic): string {
  return `youtube:${music.kind}:${music.id}`;
}

export function parseStoredYouTube(value: string | null | undefined): YouTubeMusic | null {
  if (!value) return null;
  const m = STORED_RE.exec(value);
  if (!m) return null;
  return { provider: "youtube", kind: m[1] as YouTubeKind, id: m[2]! };
}

function assertValid(music: YouTubeMusic) {
  if (!(YOUTUBE_KINDS as readonly string[]).includes(music.kind) || !ID_RE.test(music.id)) throw new Error("invalid music reference");
}

/** Always rebuilt from a validated id against a fixed YouTube origin. */
export function youTubeOpenUrl(music: YouTubeMusic): string {
  assertValid(music);
  return music.kind === "music" ? `https://music.youtube.com/watch?v=${music.id}` : `https://www.youtube.com/watch?v=${music.id}`;
}

/**
 * The official 16:9 "medium" thumbnail (320×180, no letterbox bars) on
 * YouTube's own image host. Shown only while YouTube metadata is enabled
 * (lib/music/flag.ts) and only alongside YouTube attribution + the link back.
 */
export function youTubeThumbnailUrl(music: YouTubeMusic): string {
  assertValid(music);
  return `https://i.ytimg.com/vi/${music.id}/mqdefault.jpg`;
}

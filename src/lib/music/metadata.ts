import "server-only";
import { musicKey, musicOpenUrl, type MusicMeta, type MusicRef } from "./link";
import { musicMetadataEnabled } from "./flag";
import { youTubeThumbnailUrl } from "./youtube";

/**
 * "Our Song" metadata: title / artist-or-channel / artwork for the card, from
 * the provider's public oEmbed endpoint. Server-side only, per view.
 *
 * Safety (docs/music/OUR-SONG.md §3):
 * - No arbitrary fetch: the only URLs ever requested are the two fixed oEmbed
 *   endpoints, with a `url` parameter rebuilt from the validated id
 *   (musicOpenUrl). Sender text never reaches a request. Redirects are refused.
 * - 2.5 s timeout, 64 KB body cap, JSON only. Anything unexpected = no metadata.
 * - The response's `html` is never read. Text fields are stripped of control /
 *   bidi characters, whitespace-collapsed and capped; React escapes them.
 * - Artwork must be https on an allowlisted provider image host (CSP img-src
 *   matches), else it is dropped. YouTube's is rebuilt from the id.
 * - Nothing is stored: an in-memory cache (1 h for answers, 5 min for
 *   failures, 500 entries) only spares the provider repeated calls — Spotify
 *   Terms IV.3.2 allow temporary caching of metadata/cover art; YouTube's
 *   limit is 30 days. Process restart = cache gone.
 * - Outbound budget: 60 calls/min per provider per process; over budget =
 *   no metadata (the card falls back to the sleeve), never an error.
 * - Any failure returns null: music metadata can never stop a greeting opening.
 */

const TIMEOUT_MS = 2500;
const MAX_BODY = 64 * 1024;
const TEXT_MAX = 200;
const OK_TTL_MS = 60 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const BUDGET_PER_MIN = 60;

const SPOTIFY_ART_HOST = /^(i\.scdn\.co|mosaic\.scdn\.co|image-cdn-[a-z]{2}\.spotifycdn\.com)$/;

type Entry = { at: number; ttl: number; value: MusicMeta | null };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<MusicMeta | null>>();
const budget = new Map<string, { windowStart: number; used: number }>();

/** Test hook (scripts/verify-music-links.ts): swap the network and clock. */
export const __musicMetaTest = {
  fetch: (input: string, init: RequestInit) => fetch(input, init),
  now: () => Date.now(),
  reset() {
    cache.clear();
    inflight.clear();
    budget.clear();
  },
};

/** Strips control, zero-width and bidi-override characters, collapses whitespace, caps length. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1).trimEnd()}…` : s;
}

export function cleanSpotifyArtwork(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 512) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !SPOTIFY_ART_HOST.test(u.hostname)) return null;
    if (/[\s"'<>\\]/.test(u.pathname + u.search)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function endpoint(music: MusicRef): string {
  const target = encodeURIComponent(musicOpenUrl(music));
  return music.provider === "spotify" ? `https://open.spotify.com/oembed?url=${target}` : `https://www.youtube.com/oembed?url=${target}&format=json`;
}

function takeBudget(provider: string): boolean {
  const now = __musicMetaTest.now();
  const b = budget.get(provider);
  if (!b || now - b.windowStart >= 60_000) {
    budget.set(provider, { windowStart: now, used: 1 });
    return true;
  }
  if (b.used >= BUDGET_PER_MIN) return false;
  b.used += 1;
  return true;
}

async function fetchMeta(music: MusicRef): Promise<{ value: MusicMeta | null; ttl: number }> {
  let res: Response;
  try {
    res = await __musicMetaTest.fetch(endpoint(music), {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { value: null, ttl: FAIL_TTL_MS }; // timeout, DNS, redirect, TLS
  }
  if (res.status === 404) return { value: { status: "unavailable" }, ttl: FAIL_TTL_MS };
  if (!res.ok) return { value: null, ttl: FAIL_TTL_MS }; // 401/403 (private, embedding off), 429, 5xx
  if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("json")) return { value: null, ttl: FAIL_TTL_MS };
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return { value: null, ttl: FAIL_TTL_MS };

  let body: unknown;
  try {
    const text = await res.text();
    if (text.length > MAX_BODY) return { value: null, ttl: FAIL_TTL_MS };
    body = JSON.parse(text);
  } catch {
    return { value: null, ttl: FAIL_TTL_MS };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { value: null, ttl: FAIL_TTL_MS };
  const o = body as Record<string, unknown>;

  const title = cleanText(o.title);
  // Spotify's oEmbed carries no artist: it stays null (never inferred from the title).
  const author = music.provider === "youtube" ? cleanText(o.author_name) : null;
  let artworkUrl: string | null;
  if (music.provider === "spotify") artworkUrl = cleanSpotifyArtwork(o.thumbnail_url);
  else artworkUrl = typeof o.thumbnail_url === "string" && o.thumbnail_url.startsWith("https://i.ytimg.com/") ? youTubeThumbnailUrl(music) : null;

  if (!title && !artworkUrl) return { value: null, ttl: FAIL_TTL_MS };
  return { value: { status: "ok", title, author, artworkUrl, artworkAspect: music.provider === "spotify" ? "square" : "wide" }, ttl: OK_TTL_MS };
}

/**
 * Metadata for the card, or null. Never throws, never waits longer than the
 * timeout, and returns null at once while the provider's flag is off.
 * Call only after the caller has established the viewer may see the music
 * (recipient: OPEN + not suspended; sender: valid edit token).
 */
export async function getMusicMetadata(music: MusicRef | null | undefined): Promise<MusicMeta | null> {
  try {
    if (!music || !musicMetadataEnabled(music.provider)) return null;
    const key = musicKey(music);
    const now = __musicMetaTest.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < hit.ttl) return hit.value;
    const pending = inflight.get(key);
    if (pending) return pending;
    if (!takeBudget(music.provider)) return hit?.value ?? null;

    const p = fetchMeta(music)
      .then(({ value, ttl }) => {
        cache.delete(key);
        cache.set(key, { at: __musicMetaTest.now(), ttl, value });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
        return value;
      })
      .catch(() => null)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return await p;
  } catch {
    return null;
  }
}

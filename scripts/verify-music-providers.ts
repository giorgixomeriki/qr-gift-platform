/**
 * "Our Song" providers (src/lib/music/link.ts, youtube.ts, metadata.ts,
 * flag.ts, security/csp.ts). Pure — no DB, no network (fetch is stubbed):
 *   npm run verify:music-providers
 *
 * - Spotify + YouTube parsing (incl. tracking parameters, look-alikes,
 *   injection, playlists/channels) and the stored format round-trip.
 * - Metadata: flags off = no fetch at all; only the two fixed oEmbed
 *   endpoints are ever requested, with the URL rebuilt from the id; redirects
 *   refused; html ignored; text sanitised; artwork host allowlist; 404 =
 *   unavailable; timeout/5xx/bad JSON/oversize = null; cache + budget.
 * - CSP adds provider image hosts only while the matching flag is on.
 */
import Module from "node:module";
import assert from "node:assert/strict";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

let n = 0;
const check = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  n++;
};

async function main() {
  const { parseMusicInput, parseStoredMusic, toStoredMusic, musicOpenUrl, musicService } = await import("../src/lib/music/link");
  const { youTubeOpenUrl, youTubeThumbnailUrl } = await import("../src/lib/music/youtube");
  const { getMusicMetadata, cleanText, __musicMetaTest } = await import("../src/lib/music/metadata");
  const { musicArtOrigins } = await import("../src/lib/music/flag");
  const { buildContentSecurityPolicy } = await import("../src/lib/security/csp");

  const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
  const LIST = "37i9dQZF1DXcBWIGoYBM5M";
  const VID = "dQw4w9WgXcQ";
  const VID2 = "a-b_C1d2E3f";

  const ok = (input: string, expected: object) => {
    const r = parseMusicInput(input);
    assert.ok(r.ok, `expected OK: ${input} → ${JSON.stringify(r)}`);
    assert.deepEqual(r.music, expected, input);
    n++;
  };
  const bad = (input: unknown, error: string) => {
    const r = parseMusicInput(input);
    assert.ok(!r.ok, `expected rejection: ${String(input)} → ${JSON.stringify(r)}`);
    assert.equal(r.error, error, `${String(input)} → ${r.error}`);
    n++;
  };

  // ---- Spotify (backward compatible: same results as before, now with provider)
  ok(`https://open.spotify.com/track/${TRACK}?si=a1b2c3d4e5f6&utm_source=copy-link`, { provider: "spotify", kind: "track", id: TRACK });
  ok(`https://open.spotify.com/intl-ka/track/${TRACK}?si=x`, { provider: "spotify", kind: "track", id: TRACK });
  ok(`https://open.spotify.com/playlist/${LIST}?si=abc&pt=xyz`, { provider: "spotify", kind: "playlist", id: LIST });
  ok(`spotify:track:${TRACK}`, { provider: "spotify", kind: "track", id: TRACK });
  bad("https://spotify.link/AbCdEf123", "shortLink");
  bad(`https://open.spotify.com/album/${TRACK}`, "unsupported");
  bad(`https://open.spotify.com.evil.example/track/${TRACK}`, "notSupported");

  // ---- YouTube: the four required forms + common share variants
  const video = { provider: "youtube", kind: "video", id: VID };
  ok(`https://www.youtube.com/watch?v=${VID}`, video);
  ok(`https://youtube.com/watch?v=${VID}&t=42s&si=AbC123`, video);
  ok(`https://m.youtube.com/watch?feature=share&v=${VID}`, video);
  ok(`https://www.youtube.com/watch?v=${VID}&list=PL123&index=2`, video);
  ok(`youtube.com/watch?v=${VID}`, video);
  ok(`HTTPS://WWW.YOUTUBE.COM/watch?v=${VID}`, video);
  ok(`https://youtu.be/${VID}`, video);
  ok(`https://youtu.be/${VID}?si=tracking123&t=10`, video);
  ok(`youtu.be/${VID}`, video);
  ok(`https://music.youtube.com/watch?v=${VID}&si=xyz`, { provider: "youtube", kind: "music", id: VID });
  ok(`https://music.youtube.com/watch?v=${VID}&list=RDAMVM${VID}`, { provider: "youtube", kind: "music", id: VID });
  ok(`https://www.youtube.com/shorts/${VID2}`, { provider: "youtube", kind: "video", id: VID2 });
  ok(`https://youtube.com/shorts/${VID2}?si=abc`, { provider: "youtube", kind: "video", id: VID2 });
  ok(`https://www.youtube.com/live/${VID}`, video);
  ok(`https://www.youtube.com/embed/${VID}`, video);

  // ---- YouTube rejections
  bad(`https://www.youtube.com/playlist?list=PL1234567890`, "unsupported");
  bad(`https://music.youtube.com/playlist?list=OLAK5uy_abc`, "unsupported");
  bad(`https://www.youtube.com/@someone`, "unsupported");
  bad(`https://www.youtube.com/channel/UC123`, "unsupported");
  bad(`https://music.youtube.com/browse/MPREb_abc`, "unsupported");
  bad(`https://www.youtube.com/watch?list=PL1234567890`, "unsupported");
  bad(`https://www.youtube.com/watch`, "invalid");
  bad(`https://www.youtube.com/watch?v=short`, "invalid");
  bad(`https://www.youtube.com/watch?v=${VID}x`, "invalid");
  bad(`https://www.youtube.com/watch?v=${VID}&v=${VID2}`, "invalid");
  bad(`https://www.youtube.com/watch?v=%22%3E%3Cscript%3E`, "invalid");
  bad(`https://www.youtube.com/watch?v=${VID}"><script>alert(1)</script>`, "invalid");
  bad(`https://youtu.be/${VID}/extra`, "invalid");
  bad(`https://youtu.be/`, "invalid");
  bad(`https://user:pass@www.youtube.com/watch?v=${VID}`, "invalid");
  bad(`https://www.youtube.com:8443/watch?v=${VID}`, "invalid");
  bad(`https://music.youtube.com/shorts/${VID}`, "invalid");
  bad(`https://www.youtube.com.evil.example/watch?v=${VID}`, "notSupported");
  bad(`https://evil.example/www.youtube.com/watch?v=${VID}`, "notSupported");
  bad(`https://youtube.co/watch?v=${VID}`, "notSupported");
  bad(`https://youtu.be.evil.example/${VID}`, "notSupported");
  bad(`https://www.youtube-nocookie.com/embed/${VID}`, "notSupported");
  bad(`https://www.google.com/url?q=https://www.youtube.com/watch?v=${VID}`, "notSupported");
  bad(`javascript:alert(1)//www.youtube.com/watch?v=${VID}`, "notSupported");
  bad(`data:text/html,<script>alert(1)</script>`, "notSupported");
  bad(`ftp://www.youtube.com/watch?v=${VID}`, "notSupported");
  bad(`http://127.0.0.1/watch?v=${VID}`, "notSupported");
  bad(`http://169.254.169.254/latest/meta-data`, "notSupported");
  bad(`https://www.youtube.com/watch?v=${VID} onload=alert(1)`, "invalid");
  bad(`https://www.youtube.com/watch?v=${VID}&x=${"a".repeat(600)}`, "tooLong");
  bad("", "empty");
  bad(undefined, "invalid");

  // ---- Stored format + canonical URLs
  check(toStoredMusic({ provider: "youtube", kind: "music", id: VID }) === `youtube:music:${VID}`, "yt music stored");
  check(toStoredMusic({ provider: "spotify", kind: "track", id: TRACK }) === `spotify:track:${TRACK}`, "spotify stored unchanged");
  assert.deepEqual(parseStoredMusic(`spotify:track:${TRACK}`), { provider: "spotify", kind: "track", id: TRACK });
  assert.deepEqual(parseStoredMusic(`youtube:video:${VID}`), video);
  for (const v of [`youtube:shorts:${VID}`, `youtube:video:${VID} `, `youtube:video:${VID}x`, `https://youtu.be/${VID}`, "youtube:video:<script>"]) check(parseStoredMusic(v) === null, `stored reject ${v}`);
  check(musicOpenUrl(video as never) === `https://www.youtube.com/watch?v=${VID}`, "video url");
  check(youTubeOpenUrl({ provider: "youtube", kind: "music", id: VID }) === `https://music.youtube.com/watch?v=${VID}`, "music url");
  check(youTubeThumbnailUrl(video as never) === `https://i.ytimg.com/vi/${VID}/mqdefault.jpg`, "thumb url");
  check(musicService({ provider: "youtube", kind: "music", id: VID }) === "youtubeMusic", "service");
  assert.throws(() => youTubeOpenUrl({ provider: "youtube", kind: "video", id: "../../evil" }));
  assert.throws(() => youTubeOpenUrl({ provider: "youtube", kind: "shorts" as "video", id: VID }));

  // ---- Sanitisers
  check(cleanText("  Song‮ evil \u0000 title\n\n ") === "Song evil title", "bidi/control stripped");
  check(cleanText("<script>alert(1)</script>") === "<script>alert(1)</script>", "text is text (React escapes it)");
  check(cleanText(42) === null && cleanText("   ") === null, "non-strings/empty → null");
  check(cleanText("x".repeat(500))!.length === 200, "capped");

  // ---- Metadata with a stubbed network
  type Call = { url: string; init: RequestInit };
  let calls: Call[] = [];
  let reply: (url: string) => Promise<Response> = async () => new Response("{}", { status: 500 });
  let clock = 1_000_000;
  __musicMetaTest.fetch = async (url, init) => {
    calls.push({ url, init });
    return reply(url);
  };
  __musicMetaTest.now = () => clock;
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
  const fresh = () => {
    __musicMetaTest.reset();
    calls = [];
  };
  const spotify = { provider: "spotify" as const, kind: "track" as const, id: TRACK };
  const yt = { provider: "youtube" as const, kind: "video" as const, id: VID };
  const ytMusic = { provider: "youtube" as const, kind: "music" as const, id: VID };

  // Flags off (default): nothing is fetched, ever.
  delete process.env.MUSIC_METADATA_SPOTIFY;
  delete process.env.MUSIC_METADATA_YOUTUBE;
  fresh();
  check((await getMusicMetadata(spotify)) === null && (await getMusicMetadata(yt)) === null && calls.length === 0, "flags off → no fetch");
  check((await getMusicMetadata(null)) === null, "no music → null");
  process.env.MUSIC_METADATA_SPOTIFY = "1"; // the retired switch must do nothing
  fresh();
  await getMusicMetadata(yt);
  check(calls.length === 0, "legacy spotify env does not enable youtube");
  process.env.MUSIC_METADATA_YOUTUBE = "1";
  fresh();
  reply = async () => json({ title: "T", thumbnail_url: "https://i.scdn.co/image/x" });
  check((await getMusicMetadata(spotify)) === null && calls.length === 0, "spotify never fetched, even with every switch on");

  // YouTube: endpoint + channel + thumbnail rebuilt from the id (not the response's URL).
  fresh();
  reply = async () => json({ title: "Rick Astley - Never Gonna Give You Up", author_name: "Rick Astley", thumbnail_url: "https://i.ytimg.com/vi/OTHERIDxxxx/hqdefault.jpg", html: "<iframe>" });
  const ym = await getMusicMetadata(yt);
  check(calls[0]!.url === `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${VID}`)}&format=json`, "youtube endpoint fixed");
  assert.deepEqual(ym, { status: "ok", title: "Rick Astley - Never Gonna Give You Up", author: "Rick Astley", artworkUrl: `https://i.ytimg.com/vi/${VID}/mqdefault.jpg`, artworkAspect: "wide" });
  n++;
  fresh();
  await getMusicMetadata(ytMusic);
  check(calls[0]!.url.includes(encodeURIComponent(`https://music.youtube.com/watch?v=${VID}`)), "yt music endpoint");
  fresh();
  reply = async () => json({ title: "T", author_name: "C", thumbnail_url: "https://evil.example/x.jpg" });
  const ytOff = await getMusicMetadata(yt);
  check(ytOff?.status === "ok" && ytOff.artworkUrl === null, "youtube foreign thumbnail dropped");

  // Deleted / private / errors / timeouts / junk → never throws.
  const cases: [string, () => Promise<Response>, unknown][] = [
    ["404 deleted", async () => new Response("Not Found", { status: 404 }), { status: "unavailable" }],
    ["401 private", async () => new Response("Unauthorized", { status: 401 }), null],
    ["403", async () => new Response("", { status: 403 }), null],
    ["429", async () => new Response("", { status: 429 }), null],
    ["500", async () => new Response("", { status: 500 }), null],
    ["timeout", async () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")), null],
    ["redirect", async () => Promise.reject(new TypeError("fetch failed: redirect")), null],
    ["html not json", async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), null],
    ["bad json", async () => new Response("{nope", { status: 200, headers: { "content-type": "application/json" } }), null],
    ["array", async () => json([1, 2]), null],
    ["empty object", async () => json({}), null],
    ["oversize declared", async () => new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": "999999" } }), null],
    ["oversize body", async () => new Response(JSON.stringify({ title: "x".repeat(70_000) }), { status: 200, headers: { "content-type": "application/json" } }), null],
  ];
  for (const [name, r, expected] of cases) {
    fresh();
    reply = r;
    assert.deepEqual(await getMusicMetadata(yt), expected, name);
    n++;
  }

  // Real timeout: a provider that never answers is cut off by the AbortSignal (2.5 s).
  fresh();
  reply = (url) =>
    new Promise((_, reject) => {
      const signal = calls[calls.length - 1]!.init.signal!;
      signal.addEventListener("abort", () => reject(signal.reason));
      void url;
    });
  const t0 = Date.now();
  // AbortSignal.timeout's timer is unref'd: keep this script's event loop alive (a server always has one).
  const keepAlive = setInterval(() => {}, 1000);
  const hung = await getMusicMetadata(yt);
  clearInterval(keepAlive);
  check(hung === null && Date.now() - t0 >= 2400 && Date.now() - t0 < 4000, `hung provider times out → null (${Date.now() - t0} ms)`);

  // Cache: an answer is reused for an hour; failures retried after 5 minutes; in-flight de-duplicated.
  fresh();
  reply = async () => json({ title: "Cached", thumbnail_url: null });
  await Promise.all([getMusicMetadata(yt), getMusicMetadata(yt), getMusicMetadata(yt)]);
  check(calls.length === 1, "in-flight dedupe");
  clock += 30 * 60_000;
  await getMusicMetadata(yt);
  check(calls.length === 1, "cached within 1 h");
  clock += 31 * 60_000;
  await getMusicMetadata(yt);
  check(calls.length === 2, "refetched after 1 h");

  // Budget: at most 60 provider calls per minute per process; over budget → null, no call.
  fresh();
  reply = async () => json({ title: "x", thumbnail_url: null });
  for (let i = 0; i < 70; i++) await getMusicMetadata({ provider: "youtube", kind: "video", id: `${"A".repeat(9)}${String(i).padStart(2, "0")}` });
  check(calls.length === 60, `budget caps calls (${calls.length})`);
  clock += 61_000;
  await getMusicMetadata({ provider: "youtube", kind: "video", id: "B".repeat(11) });
  check(calls.length === 61, "budget refills");

  // ---- CSP: image hosts only for enabled providers.
  delete process.env.MUSIC_METADATA_SPOTIFY;
  delete process.env.MUSIC_METADATA_YOUTUBE;
  check(musicArtOrigins().length === 0, "no art origins when off");
  const offCsp = buildContentSecurityPolicy("n", "https://x.supabase.co", { musicArtOrigins: musicArtOrigins() });
  check(!offCsp.includes("ytimg") && !offCsp.includes("scdn"), "CSP unchanged when off");
  process.env.MUSIC_METADATA_YOUTUBE = "1";
  const ytCsp = buildContentSecurityPolicy("n", "https://x.supabase.co", { musicArtOrigins: musicArtOrigins() });
  check(/img-src [^;]*https:\/\/i\.ytimg\.com/.test(ytCsp) && !ytCsp.includes("scdn"), "CSP youtube only");
  check(!/frame-src/.test(ytCsp), "no frames added");
  process.env.MUSIC_METADATA_SPOTIFY = "1";
  const both = buildContentSecurityPolicy("n", "https://x.supabase.co", { musicArtOrigins: musicArtOrigins() });
  check(!both.includes("scdn") && !both.includes("spotifycdn"), "CSP never allows Spotify image hosts");

  console.log(`verify:music-providers — ${n} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

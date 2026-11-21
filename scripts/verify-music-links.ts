/**
 * "Our Song" link validation (src/lib/music/spotify.ts). Pure, no DB:
 *   npm run verify:music
 * Every accepted input must reduce to exactly a kind + 22-char id, and every
 * URL the app emits must be rebuilt on https://open.spotify.com from those.
 */
import assert from "node:assert/strict";
import { parseSpotifyInput, parseStoredMusic, spotifyEmbedUrl, spotifyOpenUrl, toSpotifyUri } from "../src/lib/music/spotify";
import { buildContentSecurityPolicy } from "../src/lib/security/csp";

const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
const LIST = "37i9dQZF1DXcBWIGoYBM5M";
let n = 0;
function ok(input: string, kind: "track" | "playlist", id: string) {
  const r = parseSpotifyInput(input);
  assert.ok(r.ok, `expected OK: ${input} → ${JSON.stringify(r)}`);
  assert.deepEqual(r.music, { kind, id }, input);
  n++;
}
function bad(input: unknown, error: string) {
  const r = parseSpotifyInput(input);
  assert.ok(!r.ok, `expected rejection: ${String(input)}`);
  assert.equal(r.error, error, `${String(input)} → ${r.error}`);
  n++;
}

// Accepted
ok(`https://open.spotify.com/track/${TRACK}`, "track", TRACK);
ok(`https://open.spotify.com/track/${TRACK}?si=a1b2c3d4e5f6`, "track", TRACK);
ok(`  https://open.spotify.com/track/${TRACK}?si=x#frag  `, "track", TRACK);
ok(`https://open.spotify.com/intl-ka/track/${TRACK}`, "track", TRACK);
ok(`https://open.spotify.com/intl-pt-br/track/${TRACK}?si=1`, "track", TRACK);
ok(`open.spotify.com/track/${TRACK}`, "track", TRACK);
ok(`http://open.spotify.com/track/${TRACK}`, "track", TRACK);
ok(`HTTPS://OPEN.SPOTIFY.COM/track/${TRACK}`, "track", TRACK);
ok(`https://open.spotify.com/embed/track/${TRACK}`, "track", TRACK);
ok(`https://open.spotify.com/playlist/${LIST}`, "playlist", LIST);
ok(`https://open.spotify.com/playlist/${LIST}?si=abc&pt=xyz`, "playlist", LIST);
ok(`spotify:track:${TRACK}`, "track", TRACK);
ok(`spotify:playlist:${LIST}`, "playlist", LIST);

// Rejected: empty / not a string / too long
bad("", "empty");
bad("   ", "empty");
bad(undefined, "invalid");
bad(42, "invalid");
bad(`https://open.spotify.com/track/${TRACK}?si=${"a".repeat(600)}`, "tooLong");
// Rejected: wrong host, look-alikes, schemes
bad(`https://open.spotify.com.evil.example/track/${TRACK}`, "notSpotify");
bad(`https://evil.example/open.spotify.com/track/${TRACK}`, "notSpotify");
bad(`https://spotify.com/track/${TRACK}`, "notSpotify");
bad(`https://open-spotify.com/track/${TRACK}`, "notSpotify");
bad(`https://open.spotify.co/track/${TRACK}`, "notSpotify");
bad(`javascript:alert(1)//open.spotify.com/track/${TRACK}`, "notSpotify");
bad(`data:text/html,<script>alert(1)</script>`, "notSpotify");
bad(`ftp://open.spotify.com/track/${TRACK}`, "notSpotify");
bad(`https://www.youtube.com/watch?v=dQw4w9WgXcQ`, "notSpotify");
bad("https://spotify.link/AbCdEf123", "shortLink");
bad("https://spotify.app.link/AbCdEf123", "shortLink");
// Rejected: credentials, port, injection in path/id
bad(`https://user:pass@open.spotify.com/track/${TRACK}`, "invalid");
bad(`https://evil.example@open.spotify.com/track/${TRACK}`, "invalid");
bad(`https://open.spotify.com:8443/track/${TRACK}`, "invalid");
bad(`https://open.spotify.com/track/${TRACK}"><script>alert(1)</script>`, "invalid");
bad(`https://open.spotify.com/track/${TRACK} onload=alert(1)`, "invalid");
bad(`https://open.spotify.com/track/${TRACK}%22%3E%3Cscript%3E`, "invalid");
bad(`https://open.spotify.com/track/../../evil`, "invalid");
bad(`https://open.spotify.com/track/${TRACK}/extra`, "invalid");
bad(`https://open.spotify.com/track/short`, "invalid");
bad(`https://open.spotify.com/track/${TRACK}x`, "invalid");
bad(`https://open.spotify.com/track/`, "invalid");
bad(`spotify:track:${TRACK}:extra`, "unsupported");
bad(`spotify:track:<script>`, "invalid");
bad("not a link at all", "invalid");
// Rejected: unsupported kinds
bad(`https://open.spotify.com/album/${TRACK}`, "unsupported");
bad(`https://open.spotify.com/artist/${TRACK}`, "unsupported");
bad(`https://open.spotify.com/episode/${TRACK}`, "unsupported");
bad(`https://open.spotify.com/show/${TRACK}`, "unsupported");
bad(`https://open.spotify.com/user/someone/playlist/${LIST}`, "unsupported");
bad(`spotify:album:${TRACK}`, "unsupported");

// Persisted form round-trips; anything else reads as "no music".
assert.equal(toSpotifyUri({ kind: "track", id: TRACK }), `spotify:track:${TRACK}`);
assert.deepEqual(parseStoredMusic(`spotify:playlist:${LIST}`), { kind: "playlist", id: LIST });
for (const v of [null, undefined, "", `https://open.spotify.com/track/${TRACK}`, `spotify:album:${TRACK}`, `spotify:track:${TRACK} `, `spotify:track:${TRACK}\n`, "javascript:alert(1)"]) {
  assert.equal(parseStoredMusic(v as string | null), null, String(v));
  n++;
}

// Emitted URLs are fixed-origin and refuse anything not validated.
assert.equal(spotifyOpenUrl({ kind: "track", id: TRACK }), `https://open.spotify.com/track/${TRACK}`);
assert.equal(spotifyEmbedUrl({ kind: "playlist", id: LIST }), `https://open.spotify.com/embed/playlist/${LIST}`);
assert.throws(() => spotifyOpenUrl({ kind: "track", id: "../../x" }));
assert.throws(() => spotifyOpenUrl({ kind: "album" as "track", id: TRACK }));

// CSP: no frames unless the embed flag is on, and then only Spotify's.
assert.ok(!buildContentSecurityPolicy("n", "https://x.supabase.co").includes("frame-src"));
assert.ok(buildContentSecurityPolicy("n", "https://x.supabase.co", { spotifyEmbed: true }).includes("frame-src https://open.spotify.com"));

console.log(`verify:music — ${n + 8} checks passed`);

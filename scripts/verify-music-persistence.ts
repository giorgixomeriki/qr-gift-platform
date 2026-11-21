import Module from "node:module";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

/**
 * "Our Song" persistence against the real DB + RLS (npm run verify:music-db):
 * the server re-validates (never trusts the client), stores only the
 * canonical reference, keeps exactly one row, leaves other content alone,
 * refuses a wrong edit token and any change once the greeting is ACTIVE, and
 * the recipient loader returns the saved song.
 */
const postgres = require("postgres") as typeof import("postgres");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const content = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { loadActiveGreetingForRecipient } = require("../src/lib/greetings/recipient") as typeof import("../src/lib/greetings/recipient");
const { parseStoredMusic } = require("../src/lib/music/spotify") as typeof import("../src/lib/music/spotify");

const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
const LIST = "37i9dQZF1DXcBWIGoYBM5M";
const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const admin = postgres(migrationsUrl, { max: 1 });

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
async function rejects(fn: () => Promise<unknown>, cls?: new (...a: never[]) => Error): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return cls ? e instanceof cls : true;
  }
}

async function main() {
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const qrId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"music-" + partnerId.slice(0, 8)}, 'Music Verify Partner', 3000, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'music-verify', 1)`;
  const qrToken = generatePublicToken();
  await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${qrToken}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
  const { greetingId: g, editToken: tok } = await startGreeting(qrToken);
  const rows = () => admin<{ text_value: string; slot: number; status: string }[]>`select text_value, slot, status from greeting_content where greeting_id = ${g} and type = 'music'`;

  try {
    console.log("\n--- server-side validation ---");
    for (const bad of ["https://evil.example/track/x", `https://open.spotify.com/album/${TRACK}`, `javascript:alert(1)`, `https://open.spotify.com/track/${TRACK}"><script>`, "x".repeat(600)]) {
      check(`rejects ${bad.slice(0, 50)}`, await rejects(() => content.setGreetingMusic(g, tok, bad), content.MusicLinkError));
    }
    check("nothing stored after rejections", (await rows()).length === 0);
    check("wrong edit token refused", await rejects(() => content.setGreetingMusic(g, "not-the-token", `spotify:track:${TRACK}`)));
    check("nothing stored after wrong token", (await rows()).length === 0);

    console.log("\n--- set / replace / concurrency ---");
    const m1 = await content.setGreetingMusic(g, tok, `https://open.spotify.com/intl-ka/track/${TRACK}?si=zz`);
    check("returns canonical kind/id", m1.kind === "track" && m1.id === TRACK);
    let r = await rows();
    check("stores canonical URI only", r.length === 1 && r[0]!.text_value === `spotify:track:${TRACK}` && r[0]!.status === "READY" && r[0]!.slot === 0, JSON.stringify(r));

    await content.setGreetingMusic(g, tok, `https://open.spotify.com/playlist/${LIST}`);
    r = await rows();
    check("replace keeps one row", r.length === 1 && r[0]!.text_value === `spotify:playlist:${LIST}`);

    await Promise.all(Array.from({ length: 6 }, (_, i) => content.setGreetingMusic(g, tok, i % 2 ? `spotify:track:${TRACK}` : `spotify:playlist:${LIST}`)));
    r = await rows();
    check("6 concurrent saves still leave exactly one row", r.length === 1, JSON.stringify(r));

    console.log("\n--- coexistence with other content ---");
    await content.setGreetingMusic(g, tok, `spotify:track:${TRACK}`);
    await content.updateGreetingMessage(g, tok, "Our song, always.");
    const draft = await content.loadDraftForEdit(g, tok);
    const musicRow = draft.content.find((c) => c.type === "music");
    check("message save leaves the song", parseStoredMusic(musicRow?.textValue)?.id === TRACK);
    check("song never gets a signed URL", musicRow?.signedUrl === null);

    await content.removeGreetingMusic(g, tok);
    check("remove deletes the song", (await rows()).length === 0);
    await content.removeGreetingMusic(g, tok);
    check("remove is idempotent", (await rows()).length === 0);
    const after = await content.loadDraftForEdit(g, tok);
    check("remove leaves the message", after.content.some((c) => c.type === "text" && c.textValue === "Our song, always."));

    console.log("\n--- after activation ---");
    await content.setGreetingMusic(g, tok, `spotify:playlist:${LIST}`);
    // Simulate a completed activation (the payment path itself is covered by e2e + verify:payment-integrity).
    await admin`update greetings set status = 'ACTIVE', activated_at = now() where id = ${g}`;
    await admin`update qr_codes set status = 'ACTIVE' where id = ${qrId}`;
    check("set refused once ACTIVE", await rejects(() => content.setGreetingMusic(g, tok, `spotify:track:${TRACK}`)));
    check("remove refused once ACTIVE", await rejects(() => content.removeGreetingMusic(g, tok)));
    const active = await loadActiveGreetingForRecipient(g);
    const loaded = parseStoredMusic(active.content.find((c) => c.type === "music")?.textValue);
    check("recipient loader returns the saved song", loaded?.kind === "playlist" && loaded.id === LIST, JSON.stringify(loaded));
  } finally {
    await admin`delete from analytics_events where qr_code_id = ${qrId} or greeting_id = ${g}`;
    await admin`delete from greeting_content where greeting_id = ${g}`;
    await admin`delete from greetings where id = ${g}`;
    await admin`delete from qr_codes where id = ${qrId}`;
    await admin`delete from qr_batches where id = ${batchId}`;
    await admin`delete from partners where id = ${partnerId}`;
    await admin.end();
  }
  console.log(`\nverify:music-db — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

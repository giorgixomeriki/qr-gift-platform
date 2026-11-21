import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveSecretKey } from "../src/lib/supabase/keys";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

/**
 * The voice message's whole server lifecycle, on real Storage and real RLS:
 * a file in every accepted phone format is reserved, uploaded, verified by
 * its real bytes and committed; re-signing returns those exact bytes, for
 * the sender (edit token, DRAFT) and for the recipient (ACTIVE, available,
 * QR ACTIVE — and refused otherwise); names phones give their files map to
 * the allowlist; a mislabelled file is refused.
 */
const postgres = require("postgres") as typeof import("postgres");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { requestMediaUpload, finalizeMediaUpload, deleteContent, loadDraftForEdit, signDraftVoiceUrl } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { signRecipientVoiceUrl, loadActiveGreetingForRecipient } = require("../src/lib/greetings/recipient") as typeof import("../src/lib/greetings/recipient");
const { canonicalAudioType } = require("../src/lib/client/audio-type") as typeof import("../src/lib/client/audio-type");
const { signedUrlLifetimeMs } = require("../src/lib/storage/signed-url-expiry") as typeof import("../src/lib/storage/signed-url-expiry");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const storage = createClient(supabaseUrl, resolveSecretKey(process.env)!.key, { auth: { persistSession: false } });
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "greeting-media";
const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const admin = postgres(migrationsUrl, { max: 1 });
const FIX = path.join(__dirname, "..", "e2e", "fixtures", "voice");

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
async function throws(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
const sha = (b: Buffer | ArrayBuffer) => createHash("sha256").update(Buffer.from(b as ArrayBuffer)).digest("hex");
async function fetchBytes(url: string) {
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()) };
}
async function put(storageKey: string, bytes: Buffer, contentType: string) {
  const { error } = await storage.storage.from(bucket).upload(storageKey, bytes, { contentType, upsert: true });
  if (error) throw error;
}

const FORMATS: { file: string; mime: string; label: string }[] = [
  { file: "voice.m4a", mime: "audio/mp4", label: "iPhone/Android recording, M4A (AAC in MP4)" },
  { file: "voice.webm", mime: "audio/webm", label: "older Android Chrome recording, WebM/Opus" },
  { file: "voice.ogg", mime: "audio/ogg", label: "Ogg/Opus (WhatsApp-style .opus)" },
  { file: "voice.mp3", mime: "audio/mpeg", label: "MP3 with ID3 tag" },
  { file: "voice-noid3.mp3", mime: "audio/mpeg", label: "MP3, MPEG-1 frames, no tag" },
  { file: "voice-mpeg25.mp3", mime: "audio/mpeg", label: "MP3, MPEG-2.5 frames (8 kHz), no tag" },
  { file: "voice.wav", mime: "audio/wav", label: "WAV (Android recorders)" },
  { file: "voice.aac", mime: "audio/aac", label: "raw AAC/ADTS (Android recorders)" },
];

async function main() {
  console.log("\n--- File names phones give: mapped to the allowlist (bytes still sniffed by the server) ---");
  const named = (type: string, name: string) => canonicalAudioType(Object.assign(new Blob([], { type }), { name }));
  check("iPhone Voice Memo audio/x-m4a → audio/mp4", named("audio/x-m4a", "New Recording.m4a") === "audio/mp4");
  check("audio/m4a → audio/mp4", named("audio/m4a", "a.m4a") === "audio/mp4");
  check("audio/mp3 → audio/mpeg", named("audio/mp3", "a.mp3") === "audio/mpeg");
  check("audio/x-wav → audio/wav", named("audio/x-wav", "a.wav") === "audio/wav");
  check("audio/x-aac → audio/aac", named("audio/x-aac", "a.aac") === "audio/aac");
  check("audio/opus → audio/ogg", named("audio/opus", "a.opus") === "audio/ogg");
  check("no type, .m4a → audio/mp4", named("", "Recording 12.m4a") === "audio/mp4");
  check("application/octet-stream, .mp3 → audio/mpeg", named("application/octet-stream", "x.mp3") === "audio/mpeg");
  check("a recorder's own audio/webm is kept", named("audio/webm", "") === "audio/webm");
  check("audio/amr is refused (no browser plays it)", named("audio/amr", "a.amr") === null);
  check("audio/3gpp is refused", named("audio/3gpp", "a.3gp") === null);
  check("a video file is refused", named("video/mp4", "a.mp4") === null);

  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"vv-" + partnerId.slice(0, 8)}, 'Voice Verify Partner', 3000, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'verify-voice', 3)`;
  const greetingIds: string[] = [];
  const newDraft = async () => {
    const token = generatePublicToken();
    const qrId = crypto.randomUUID();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    greetingIds.push(greetingId);
    return { greetingId, editToken, qrId };
  };

  try {
    const { greetingId: g, editToken: tok, qrId } = await newDraft();
    let lastId: string | null = null;
    let lastHash = "";

    for (const f of FORMATS) {
      console.log(`\n--- ${f.label} ---`);
      const bytes = fs.readFileSync(path.join(FIX, f.file));
      if (lastId) await deleteContent(g, tok, lastId);
      const r = await requestMediaUpload(g, tok, { type: "audio", slot: 0, mimeType: f.mime, sizeBytes: bytes.length });
      await put(r.storageKey, bytes, f.mime);
      const fin = await finalizeMediaUpload(g, tok, r.contentId).then(
        (x) => x,
        (e: Error) => e,
      );
      check(`${f.file}: accepted as ${f.mime} after the byte check`, !(fin instanceof Error), fin instanceof Error ? fin.message : undefined);
      if (fin instanceof Error) continue;
      const got = await fetchBytes(fin.signedUrl);
      check(`${f.file}: the signed URL returns exactly the uploaded bytes`, got.status === 200 && sha(got.bytes) === sha(bytes), `status ${got.status}`);
      const fresh = await signDraftVoiceUrl(g, tok);
      const again = fresh ? await fetchBytes(fresh) : null;
      check(`${f.file}: a re-signed sender URL returns the same bytes`, !!again && again.status === 200 && sha(again.bytes) === sha(bytes));
      lastId = r.contentId;
      lastHash = sha(bytes);
    }

    console.log("\n--- Mislabelled files are refused, the saved voice stays ---");
    const mp3 = fs.readFileSync(path.join(FIX, "voice.mp3"));
    for (const claimed of ["audio/wav", "audio/aac", "audio/mp4"]) {
      const bad = await requestMediaUpload(g, tok, { type: "audio", slot: 0, mimeType: claimed, sizeBytes: mp3.length });
      await put(bad.storageKey, mp3, claimed);
      check(`MP3 bytes declared ${claimed} are refused`, await throws(() => finalizeMediaUpload(g, tok, bad.contentId)));
    }
    const draft = await loadDraftForEdit(g, tok);
    const voices = draft.content.filter((c) => c.type === "audio" && c.signedUrl);
    check("the draft still holds exactly one saved voice (the last good one)", voices.length === 1 && voices[0]!.id === lastId);
    check("an unsupported type is refused before any upload URL is issued", await throws(() => requestMediaUpload(g, tok, { type: "audio", slot: 0, mimeType: "audio/amr", sizeBytes: 100 })));
    check("a wrong edit token cannot re-sign the draft's voice", await throws(() => signDraftVoiceUrl(g, "not-the-token")));

    console.log("\n--- Signed URLs expire after 10 minutes; the player reads that from the URL ---");
    const signed = (await signDraftVoiceUrl(g, tok))!;
    check("signedUrlLifetimeMs reads the URL's lifetime: 600 s", signedUrlLifetimeMs(signed) === 600_000, String(signedUrlLifetimeMs(signed)));
    check("a local blob URL has no lifetime (never renewed)", signedUrlLifetimeMs("blob:https://qrapp.ge/123") === null);
    check("a URL without a token has no lifetime", signedUrlLifetimeMs("https://example.com/a.mp3") === null);

    console.log("\n--- Recipient: re-signing follows the page's own access rule ---");
    check("a DRAFT greeting's voice is not signed for the public", await throws(() => signRecipientVoiceUrl(g)));
    await admin`update greetings set status = 'ACTIVE', activated_at = now() where id = ${g}`;
    await admin`update qr_codes set status = 'ACTIVE' where id = ${qrId}`;
    const rUrl = await signRecipientVoiceUrl(g);
    const rGot = rUrl ? await fetchBytes(rUrl) : null;
    check("ACTIVE: the recipient's fresh URL returns the exact saved recording", !!rGot && rGot.status === 200 && sha(rGot.bytes) === lastHash);
    const page = await loadActiveGreetingForRecipient(g);
    check("the recipient page itself still signs the same voice", page.content.some((c) => c.type === "audio" && c.signedUrl));
    check("once ACTIVE, the sender's edit token no longer re-signs (DRAFT only)", await throws(() => signDraftVoiceUrl(g, tok)));
    await admin`update qr_codes set status = 'BLOCKED' where id = ${qrId}`;
    check("QR BLOCKED: refused", await throws(() => signRecipientVoiceUrl(g)));
    await admin`update qr_codes set status = 'ACTIVE' where id = ${qrId}`;
    await admin`update greetings set activated_at = now() - interval '400 days' where id = ${g}`;
    check("availability ended: refused (no URL for an expired greeting)", await throws(() => signRecipientVoiceUrl(g)));
    check("an unknown greeting: refused", await throws(() => signRecipientVoiceUrl(crypto.randomUUID())));

    console.log("\n--- A greeting without a voice ---");
    const { greetingId: g2, qrId: q2 } = await newDraft();
    await admin`update greetings set status = 'ACTIVE', activated_at = now() where id = ${g2}`;
    await admin`update qr_codes set status = 'ACTIVE' where id = ${q2}`;
    check("no voice: the recipient re-sign returns null (nothing to show)", (await signRecipientVoiceUrl(g2)) === null);
  } finally {
    for (const id of greetingIds) {
      const keys = await admin`select storage_key from greeting_content where greeting_id = ${id} and storage_key is not null`;
      if (keys.length) await storage.storage.from(bucket).remove(keys.map((k) => k.storage_key as string));
      await admin`delete from analytics_events where greeting_id = ${id}`;
      await admin`delete from greeting_content where greeting_id = ${id}`;
      await admin`delete from greetings where id = ${id}`;
    }
    await admin`delete from analytics_events where partner_id = ${partnerId}`;
    await admin`delete from qr_codes where batch_id = ${batchId}`;
    await admin`delete from qr_batches where id = ${batchId}`;
    await admin`delete from partners where id = ${partnerId}`;
    await admin.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  // The app's own DB pool (src/db/client) keeps the process alive otherwise.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

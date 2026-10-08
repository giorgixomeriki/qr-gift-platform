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
 * Media replacement is transactional: a slot's committed item stays the
 * greeting's item — saved, signed, shown — until a replacement has been
 * uploaded, verified and committed; overlapping replacements resolve to the
 * most recently requested one; a stale (older, slower) upload can never
 * overwrite a newer committed one. Real Storage, real bytes, real RLS.
 */
const postgres = require("postgres") as typeof import("postgres");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { loadDraftForEdit, requestMediaUpload, finalizeMediaUpload, deleteContent } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "greeting-media";
const storage = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

// Minimal real JPEGs (SOI+APP0+EOI) — distinct bytes per photo so objects are distinguishable.
const jpeg = (tag: number) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, tag, 0xff, 0xd9]);

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
async function throws(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function objectExists(key: string) {
  const dir = key.split("/").slice(0, -1).join("/");
  const name = key.split("/").pop()!;
  const { data } = await storage.storage.from(bucket).list(dir, { search: name });
  return (data ?? []).some((f) => f.name === name);
}
async function put(key: string, bytes: Buffer) {
  const { error } = await storage.storage.from(bucket).upload(key, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
}

async function main() {
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"mr-" + partnerId.slice(0, 8)}, 'Media Replacement Partner', 3000, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'media-replacement', 5)`;
  const qrToken = generatePublicToken();
  await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${crypto.randomUUID()}, ${qrToken}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
  const { greetingId: g, editToken: tok } = await startGreeting(qrToken);

  const req = () => requestMediaUpload(g, tok, { type: "photo", slot: 0, mimeType: "image/jpeg", sizeBytes: jpeg(1).length });
  /** What a reload of the wizard shows for slot 0 — the only rows ever signed are READY ones. */
  async function shown() {
    const draft = await loadDraftForEdit(g, tok);
    const rows = draft.content.filter((c) => c.type === "photo" && c.slot === 0);
    return { signed: rows.filter((r) => r.signedUrl).map((r) => r.id), ready: rows.filter((r) => r.status === "READY").map((r) => r.id), all: rows.length };
  }

  try {
    console.log("\n--- Photo A committed ---");
    const A = await req();
    await put(A.storageKey, jpeg(0xa));
    await finalizeMediaUpload(g, tok, A.contentId);
    let s = await shown();
    check("A is the slot's one committed, signed item", s.signed.length === 1 && s.signed[0] === A.contentId);

    console.log("\n--- Replacement B requested: A untouched while B is pending ---");
    const B = await req();
    s = await shown();
    check("requesting B does not delete or hide A", s.signed.length === 1 && s.signed[0] === A.contentId);
    check("B's pending row is never signed (not visible to a reload or a recipient)", !s.signed.includes(B.contentId));
    check("A's file is still in Storage", await objectExists(A.storageKey));

    console.log("\n--- B fails (bytes never arrive / upload timed out) ---");
    check("finalizing B without its bytes fails", await throws(() => finalizeMediaUpload(g, tok, B.contentId)));
    s = await shown();
    check("after B's failure A is still the active photo", s.signed.length === 1 && s.signed[0] === A.contentId);
    check("A's file survives B's failure", await objectExists(A.storageKey));

    console.log("\n--- B rejected by content verification (server accepted bytes, refused to commit) ---");
    const Bbad = await req();
    await storage.storage.from(bucket).upload(Bbad.storageKey, Buffer.from("not a jpeg"), { contentType: "image/jpeg", upsert: true });
    check("finalizing mismatched bytes is refused", await throws(() => finalizeMediaUpload(g, tok, Bbad.contentId)));
    s = await shown();
    check("A still active after a rejected replacement", s.signed.length === 1 && s.signed[0] === A.contentId);
    check("the rejected object is removed from Storage", !(await objectExists(Bbad.storageKey)));

    console.log("\n--- B cancelled by the sender ---");
    const Bc = await req();
    await deleteContent(g, tok, Bc.contentId);
    s = await shown();
    check("cancelling B leaves A active", s.signed.length === 1 && s.signed[0] === A.contentId);

    console.log("\n--- Retry: B uploaded and committed ---");
    const B2 = await req();
    await put(B2.storageKey, jpeg(0xb));
    await finalizeMediaUpload(g, tok, B2.contentId);
    s = await shown();
    check("B is now the slot's only committed item", s.signed.length === 1 && s.signed[0] === B2.contentId && s.ready.length === 1);
    check("A's row is gone only after B committed", !s.ready.includes(A.contentId));
    check("A's file is cleaned up after the commit", !(await objectExists(A.storageKey)));
    check("stale pending rows for the slot were retired with the commit", s.all === 1, `rows=${s.all}`);
    check("finalizing B twice is refused (no duplicate commit)", await throws(() => finalizeMediaUpload(g, tok, B2.contentId)));
    s = await shown();
    check("a duplicate finalize changes nothing", s.signed.length === 1 && s.signed[0] === B2.contentId);

    console.log("\n--- C picked while D... : older upload finishes AFTER newer one committed ---");
    const C = await req(); // requested first
    const D = await req(); // requested second (the sender's latest choice)
    await put(C.storageKey, jpeg(0xc));
    await put(D.storageKey, jpeg(0xd));
    await finalizeMediaUpload(g, tok, D.contentId); // newer finishes first
    check("the older, slower C is rejected as stale", await throws(() => finalizeMediaUpload(g, tok, C.contentId)));
    s = await shown();
    check("D (the latest pick) stays active — C never overwrites it", s.signed.length === 1 && s.signed[0] === D.contentId);
    check("the stale C object is removed", !(await objectExists(C.storageKey)));
    check("B's file was cleaned up when D committed", !(await objectExists(B2.storageKey)));

    console.log("\n--- E then F: older finishes first, newer later ---");
    const E = await req();
    const F = await req();
    await put(E.storageKey, jpeg(0xe));
    await put(F.storageKey, jpeg(0xf));
    await finalizeMediaUpload(g, tok, E.contentId);
    s = await shown();
    check("E commits while F is still pending", s.signed.length === 1 && s.signed[0] === E.contentId);
    await finalizeMediaUpload(g, tok, F.contentId);
    s = await shown();
    check("F (requested last) then replaces E", s.signed.length === 1 && s.signed[0] === F.contentId && s.all === 1);

    console.log("\n--- Two replacements finalizing at the same moment ---");
    const G = await req();
    const H = await req();
    await put(G.storageKey, jpeg(0x1));
    await put(H.storageKey, jpeg(0x2));
    const results = await Promise.allSettled([finalizeMediaUpload(g, tok, G.contentId), finalizeMediaUpload(g, tok, H.contentId)]);
    s = await shown();
    check("exactly one committed item after overlapping finalizes", s.signed.length === 1 && s.ready.length === 1 && s.all === 1, JSON.stringify(s));
    check("the most recently requested (H) wins regardless of finishing order", s.signed[0] === H.contentId, results.map((r) => r.status).join(","));
    check("the loser's file does not linger", !(await objectExists(G.storageKey)));

    console.log("\n--- Other slots are never touched ---");
    const other = await requestMediaUpload(g, tok, { type: "photo", slot: 1, mimeType: "image/jpeg", sizeBytes: jpeg(3).length });
    await put(other.storageKey, jpeg(3));
    await finalizeMediaUpload(g, tok, other.contentId);
    const I = await req();
    await put(I.storageKey, jpeg(4));
    await finalizeMediaUpload(g, tok, I.contentId);
    const draft = await loadDraftForEdit(g, tok);
    check("replacing slot 0 leaves slot 1 intact", draft.content.some((c) => c.id === other.contentId && c.status === "READY"));
  } finally {
    const keys = await admin`select storage_key from greeting_content where greeting_id = ${g} and storage_key is not null`;
    if (keys.length) await storage.storage.from(bucket).remove(keys.map((k) => k.storage_key as string));
    await admin`delete from analytics_events where greeting_id = ${g}`;
    await admin`delete from greeting_content where greeting_id = ${g}`;
    await admin`delete from greetings where id = ${g}`;
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

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});

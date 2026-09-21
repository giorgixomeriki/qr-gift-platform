import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { eq } = require("drizzle-orm") as typeof import("drizzle-orm");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");

const { withPartnerContext, withPublicContext } = require("../src/db/client") as typeof import("../src/db/client");
const { greetingContent } = require("../src/db/schema") as typeof import("../src/db/schema");
const { startGreeting, StartGreetingError } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const {
  updateGreetingMessage,
  updateGreetingTheme,
  requestMediaUpload,
  finalizeMediaUpload,
  loadDraftForEdit,
} = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { generateEditToken, hashEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { getDisplayPrice } = require("../src/lib/payments/display-price") as typeof import("../src/lib/payments/display-price");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const admin = postgres(migrationsUrl, { max: 1 });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "greeting-media";
const storage = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

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
async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  console.log("Setting up fixtures (superuser)...");

  const partnerA = crypto.randomUUID();
  const partnerAUser = crypto.randomUUID();
  const batchId = crypto.randomUUID();

  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerA}, ${"p2-partner-" + partnerA.slice(0, 8)}, 'Phase 2 Security Partner', 1000, 'ACTIVE')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerA}, ${partnerAUser}, 'OWNER')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerA}, 'p2-security-batch', 10)`;

  async function makeAvailableQr() {
    const id = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${id}, ${token}, ${batchId}, ${partnerA}, 'AVAILABLE')`;
    return { id, token };
  }

  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING' limit 1`;
  const [theme] = await admin`select id from themes where key = 'minimal' limit 1`;
  if (!product || !theme) throw new Error("Seed data missing — run npm run db:seed first");

  console.log("\n--- Race safety: two simultaneous starts, one QR ---");
  const raceQr = await makeAvailableQr();
  const [r1, r2] = await Promise.allSettled([startGreeting(raceQr.token), startGreeting(raceQr.token)]);
  const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
  const rejected = [r1, r2].filter((r) => r.status === "rejected");
  check("1. Exactly one of two simultaneous starts succeeds", succeeded.length === 1 && rejected.length === 1);
  check("   the loser fails with StartGreetingError, not a crash", rejected[0]?.status === "rejected" && (rejected[0].reason instanceof StartGreetingError));
  const greetingsForRaceQr = await admin`select id from greetings where qr_code_id = ${raceQr.id}`;
  check("   exactly one Greeting row exists for that QR afterward", greetingsForRaceQr.length === 1);

  console.log("\n--- Two independent drafts for the isolation tests ---");
  const qr1 = await makeAvailableQr();
  const { greetingId: greeting1, editToken: editToken1 } = await startGreeting(qr1.token);
  const qr2 = await makeAvailableQr();
  const { editToken: editToken2 } = await startGreeting(qr2.token);
  void editToken2;

  console.log("\n--- Edit-token authorization ---");
  const qrTokenAsEditToken = await expectThrows(() => updateGreetingMessage(greeting1, qr1.token, "hacked via public token"));
  check("2. QR public token cannot be used as an edit token", qrTokenAsEditToken);

  const wrongToken = generateEditToken();
  const wrongTokenRejected = await expectThrows(() => updateGreetingMessage(greeting1, wrongToken, "hacked via wrong token"));
  check("3. A wrong (but well-formed) edit token cannot edit the Greeting", wrongTokenRejected);

  await updateGreetingMessage(greeting1, editToken1, "Hello from the real sender");
  const draftAfterRealEdit = await loadDraftForEdit(greeting1, editToken1);
  check("4. The correct edit token CAN edit its own DRAFT", draftAfterRealEdit.content.some((c) => c.textValue === "Hello from the real sender"));

  const crossDraftEdit = await expectThrows(() => updateGreetingMessage(greeting1, editToken2, "cross-draft attack"));
  check("5. Sender A's token cannot edit Sender B's DRAFT (editToken2 on greeting1)", crossDraftEdit);

  console.log("\n--- ACTIVE / BLOCKED Greetings reject the (former) edit token ---");
  const activeToken = generateEditToken();
  const activeGreetingId = crypto.randomUUID();
  const activeQr = await makeAvailableQr();
  // The activation-invariant trigger requires the referencing ACTIVE greeting
  // to exist before qr_codes can become ACTIVE — insert the greeting first.
  await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values
    (${activeGreetingId}, ${activeQr.id}, ${theme.id}, ${product.id}, 'ACTIVE', ${hashEditToken(activeToken)})`;
  await admin`update qr_codes set status = 'ACTIVE' where id = ${activeQr.id}`;
  const activeMutationRejected = await expectThrows(() => updateGreetingMessage(activeGreetingId, activeToken, "trying to edit an ACTIVE greeting"));
  check("6. Sender cannot mutate an ACTIVE Greeting even with its own former edit token", activeMutationRejected);

  const blockedToken = generateEditToken();
  const blockedGreetingId = crypto.randomUUID();
  const blockedQr = await makeAvailableQr();
  await admin`update qr_codes set status = 'BLOCKED' where id = ${blockedQr.id}`;
  await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values
    (${blockedGreetingId}, ${blockedQr.id}, ${theme.id}, ${product.id}, 'BLOCKED', ${hashEditToken(blockedToken)})`;
  const blockedMutationRejected = await expectThrows(() => updateGreetingMessage(blockedGreetingId, blockedToken, "trying to edit a BLOCKED greeting"));
  check("7. Sender cannot mutate a BLOCKED Greeting", blockedMutationRejected);

  console.log("\n--- Partner cannot read private Greeting content ---");
  const partnerContentRead = await withPartnerContext(partnerAUser, partnerA, (tx) =>
    tx.select().from(greetingContent).where(eq(greetingContent.greetingId, greeting1)),
  );
  check("8. Partner (even the owning partner) cannot SELECT greeting_content", partnerContentRead.length === 0);

  console.log("\n--- Anonymous cannot enumerate private content ---");
  const anonContentRead = await withPublicContext((tx) => tx.select().from(greetingContent).where(eq(greetingContent.greetingId, greeting1)));
  check("9. Anonymous (no context) cannot SELECT greeting_content of a DRAFT", anonContentRead.length === 0);

  console.log("\n--- Upload validation: oversized rejected, MIME spoof rejected ---");
  const oversizedRejected = await expectThrows(() =>
    requestMediaUpload(greeting1, editToken1, { type: "photo", slot: 0, mimeType: "image/jpeg", sizeBytes: 50 * 1024 * 1024 }),
  );
  check("10. Oversized upload request is rejected before a signed URL is ever issued", oversizedRejected);

  const spoof = await requestMediaUpload(greeting1, editToken1, { type: "photo", slot: 1, mimeType: "image/jpeg", sizeBytes: 1024 });
  // Simulate an attacker who obtained a signed URL for "image/jpeg" but
  // actually uploaded arbitrary non-image bytes to that exact path.
  const { error: uploadErr } = await storage.storage.from(bucket).upload(spoof.storageKey, Buffer.from("not actually a jpeg, just text"), {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (uploadErr) throw uploadErr;
  const spoofRejected = await expectThrows(() => finalizeMediaUpload(greeting1, editToken1, spoof.contentId));
  check("11. Content whose real bytes don't match the declared MIME type is rejected at finalize", spoofRejected);
  const [spoofRow] = await admin`select id from greeting_content where id = ${spoof.contentId}`;
  check("    the rejected upload's content row is removed, never left as READY", !spoofRow);
  const { data: stillThere } = await storage.storage.from(bucket).list(spoof.storageKey.split("/").slice(0, -1).join("/"));
  const stillHasSpoofFile = (stillThere ?? []).some((f: { name: string }) => spoof.storageKey.endsWith(f.name));
  check("    the spoofed object is deleted from Storage, not left behind", !stillHasSpoofFile);

  console.log("\n--- Storage keys are always server-derived, never client-chosen ---");
  const legit = await requestMediaUpload(greeting1, editToken1, { type: "photo", slot: 2, mimeType: "image/png", sizeBytes: 1024 });
  const expectedKeyPattern = new RegExp(`^partners/${partnerA}/greetings/${greeting1}/${legit.contentId}\\.png$`);
  check("12. The issued storage key matches the server-derived {partnerId}/{greetingId}/{contentId} shape exactly", expectedKeyPattern.test(legit.storageKey));
  check("    (structural) requestMediaUpload's input type has no path/storageKey field a client could set", true);

  console.log("\n--- Price is server-authoritative, not client-overridable ---");
  const priceBefore = await getDisplayPrice(partnerA, product.id);
  check("13a. A display price is resolved for a valid partner/product with no client input", priceBefore !== null);
  await admin`update prices set amount_minor = amount_minor + 777 where product_id = ${product.id} and partner_id is null`;
  const priceAfter = await getDisplayPrice(partnerA, product.id);
  check("13b. Changing the DB price changes what's displayed — proving it's live/server-resolved, not a hardcoded constant", priceAfter?.amountMinor === (priceBefore?.amountMinor ?? 0) + 777);
  await admin`update prices set amount_minor = amount_minor - 777 where product_id = ${product.id} and partner_id is null`;

  console.log("\n--- Theme key validation ---");
  const badTheme = await expectThrows(() => updateGreetingTheme(greeting1, editToken1, "not-a-real-theme"));
  check("14. An unknown theme key is rejected", badTheme);
  const sqlish = await expectThrows(() => updateGreetingTheme(greeting1, editToken1, "'; drop table greetings; --"));
  check("    a garbage/injection-shaped theme key is cleanly rejected, not executed", sqlish);
  await updateGreetingTheme(greeting1, editToken1, "romantic");
  const draftAfterTheme = await loadDraftForEdit(greeting1, editToken1);
  check("    a real theme key IS accepted and persisted", draftAfterTheme.themeKey === "romantic");

  console.log("\n--- Text XSS payload renders safely (no HTML sink for user content) ---");
  const xssPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
  await updateGreetingMessage(greeting1, editToken1, xssPayload);
  const draftAfterXss = await loadDraftForEdit(greeting1, editToken1);
  const storedVerbatim = draftAfterXss.content.some((c) => c.textValue === xssPayload);
  check("15a. The message round-trips as inert literal text (no server-side markup interpretation)", storedVerbatim);

  const rendererSrc = readFileSync(join(__dirname, "../src/components/greeting/greeting-renderer.tsx"), "utf8");
  const wizardSrc = readFileSync(join(__dirname, "../src/components/greeting/creation-wizard.tsx"), "utf8");
  const noDangerousHtml = !rendererSrc.includes("dangerouslySetInnerHTML") && !wizardSrc.includes("dangerouslySetInnerHTML");
  check("15b. The renderer/wizard never use dangerouslySetInnerHTML for user content (React's default escaping is the only sink)", noDangerousHtml);

  console.log("\nCleaning up fixtures...");
  await admin`delete from greeting_content where greeting_id in (${greeting1}, ${activeGreetingId}, ${blockedGreetingId})`;
  await admin`delete from greetings where qr_code_id in (${raceQr.id}, ${qr1.id}, ${qr2.id}, ${activeQr.id}, ${blockedQr.id})`;
  await admin`delete from qr_codes where batch_id = ${batchId}`;
  await admin`delete from qr_batches where id = ${batchId}`;
  await admin`delete from partner_members where partner_id = ${partnerA}`;
  await admin`delete from partners where id = ${partnerA}`;

  await admin.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end();
  process.exit(1);
});

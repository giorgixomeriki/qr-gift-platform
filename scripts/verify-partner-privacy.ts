import Module from "node:module";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

/**
 * QA-01 V1 privacy hardening — the parts below the UI: which credentials the
 * inventory shaping releases, what a partner database context can read, that
 * no partner-facing module touches greeting content or media, and that a
 * signed-in partner cannot reach private media in Storage. The HTTP surfaces
 * (dashboard, CSV, print, QR image, audit log) are covered by
 * e2e/partner-privacy.spec.ts. See docs/PRIVACY_MODEL.md.
 */
const postgres = require("postgres") as typeof import("postgres");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const { toInventoryRow, isCredentialReleasable } = require("../src/lib/qr/credential-access") as typeof import("../src/lib/qr/credential-access");
const { withPartnerContext, withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
const { greetings, greetingContent } = require("../src/db/schema") as typeof import("../src/db/schema");
const { eq } = require("drizzle-orm") as typeof import("drizzle-orm");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "greeting-media";
if (!migrationsUrl || !supabaseUrl || !anonKey || !serviceKey) throw new Error("MIGRATIONS_DATABASE_URL and Supabase env vars are required");
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

/** Partner-facing code must never read greeting content or issue media URLs. */
function partnerModulesTouchingContent(): string {
  const root = join(__dirname, "..");
  const partnerFacing = [
    "src/app/(partner)",
    "src/app/api/qr",
    "src/app/print",
    "src/components/qr",
    "src/components/partners",
    "src/lib/qr",
    "src/lib/partners",
    "src/lib/dashboard/partner-metrics.ts",
  ].map((p) => join(root, p));
  return execFileSync(
    "bash",
    ["-c", `grep -rlE 'greetingContent|greeting_content|createSignedReadUrl|lib/storage/media|loadActiveGreetingForRecipient|loadDraftForEdit' "$@" || true`, "_", ...partnerFacing],
    { encoding: "utf8" },
  ).trim();
}

async function main() {
  console.log("--- Credential release rule (lib/qr/credential-access.ts) ---");
  const qr = (status: string) => ({ id: "id", publicToken: "ABCDEFGHJKMNPQRSTVWXYZ12", status, distributionStatus: "DISTRIBUTED" });
  const available = toInventoryRow(qr("AVAILABLE"), "PARTNER");
  check("1. Partner gets the full token for an unclaimed card", available.credentialReleased && available.label === "ABCDEFGHJKMNPQRSTVWXYZ12" && available.status === "AVAILABLE");
  for (const status of ["DRAFT", "ACTIVE", "BLOCKED"]) {
    const row = toInventoryRow(qr(status), "PARTNER");
    check(`2. Partner gets a masked label and status USED for a ${status} card`, !row.credentialReleased && row.label === "••••YZ12" && row.status === "USED", JSON.stringify(row));
  }
  const adminRow = toInventoryRow(qr("ACTIVE"), "ADMIN");
  check("3. Admin keeps the full token and real status", adminRow.credentialReleased && adminRow.label === "ABCDEFGHJKMNPQRSTVWXYZ12" && adminRow.status === "ACTIVE");
  check("   isCredentialReleasable: partner only while AVAILABLE", isCredentialReleasable("PARTNER", "AVAILABLE") && !isCredentialReleasable("PARTNER", "DRAFT") && isCredentialReleasable("ADMIN", "BLOCKED"));

  console.log("\n--- Partner database context ---");
  const partnerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const adminUserId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const blockedQr = crypto.randomUUID();
  const draftQr = crypto.randomUUID();
  const blockedGreeting = crypto.randomUUID();
  const draftGreeting = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"privacy-" + partnerId.slice(0, 8)}, 'Privacy Verify Partner', 1000, 'ACTIVE')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerId}, ${memberId}, 'OWNER')`;
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'privacy-verify', 2)`;
  await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values
    (${blockedQr}, ${"PV" + blockedQr.replace(/-/g, "").slice(0, 20).toUpperCase()}, ${batchId}, ${partnerId}, 'BLOCKED'),
    (${draftQr}, ${"PV" + draftQr.replace(/-/g, "").slice(0, 20).toUpperCase()}, ${batchId}, ${partnerId}, 'DRAFT')`;
  const [theme] = await admin`select id from themes limit 1`;
  const [product] = await admin`select id from products limit 1`;
  await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values
    (${blockedGreeting}, ${blockedQr}, ${theme!.id}, ${product!.id}, 'BLOCKED', 'verify-hash'),
    (${draftGreeting}, ${draftQr}, ${theme!.id}, ${product!.id}, 'DRAFT', 'verify-hash')`;
  await admin`insert into greeting_content (greeting_id, type, slot, text_value, status) values
    (${blockedGreeting}, 'text', 0, 'blocked private text', 'READY'), (${draftGreeting}, 'text', 0, 'draft private text', 'READY')`;

  const partnerSeesBlocked = await withPartnerContext(memberId, partnerId, (tx) => tx.select({ id: greetings.id }).from(greetings).where(eq(greetings.id, blockedGreeting)));
  check("4. Partner membership no longer reveals its BLOCKED greetings (migrations/0012)", partnerSeesBlocked.length === 0);
  const adminSeesBlocked = await withAdminContext(adminUserId, (tx) => tx.select({ id: greetings.id }).from(greetings).where(eq(greetings.id, blockedGreeting)));
  check("   ...an admin still does (moderation)", adminSeesBlocked.length === 1);
  const partnerReadsContent = await withPartnerContext(memberId, partnerId, (tx) =>
    tx.select({ text: greetingContent.textValue }).from(greetingContent).where(eq(greetingContent.greetingId, draftGreeting)),
  );
  const partnerReadsBlockedContent = await withPartnerContext(memberId, partnerId, (tx) =>
    tx.select({ text: greetingContent.textValue }).from(greetingContent).where(eq(greetingContent.greetingId, blockedGreeting)),
  );
  check("5. Partner context cannot read greeting content (draft or blocked)", partnerReadsContent.length === 0 && partnerReadsBlockedContent.length === 0);

  console.log("\n--- Partner-facing code ---");
  const offenders = partnerModulesTouchingContent();
  check("6. No partner-facing module reads greeting content or issues media URLs", offenders.length === 0, offenders);

  console.log("\n--- Storage with a signed-in partner ---");
  const service = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });
  const email = `privacy-verify-${partnerId.slice(0, 8)}@dev.local`;
  const password = `pv-${crypto.randomUUID()}`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error("could not create verify user");
  const authUserId = created.user.id;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerId}, ${authUserId}, 'OWNER')`;
  const objectKey = `partners/${partnerId}/greetings/${draftGreeting}/${crypto.randomUUID()}.txt`;
  const { error: uploadError } = await service.storage.from(bucket).upload(objectKey, new Blob(["private media bytes"], { type: "text/plain" }));
  check("   (fixture) private object uploaded via the service role", !uploadError, uploadError?.message);

  const partnerClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
  const { error: signInError } = await partnerClient.auth.signInWithPassword({ email, password });
  check("   (fixture) partner member signed in to Supabase", !signInError, signInError?.message);
  const { data: listed } = await partnerClient.storage.from(bucket).list(`partners/${partnerId}/greetings/${draftGreeting}`);
  check("7. Signed-in partner cannot list its own partner's greeting media", (listed ?? []).length === 0, JSON.stringify(listed));
  const { data: downloaded } = await partnerClient.storage.from(bucket).download(objectKey);
  check("8. Signed-in partner cannot download greeting media by exact path", !downloaded);
  const { error: signError } = await partnerClient.storage.from(bucket).createSignedUrl(objectKey, 60);
  check("9. Signed-in partner cannot mint a signed URL for greeting media", !!signError);
  const { data: rows, error: restError } = await partnerClient.from("greeting_content").select("text_value").limit(1);
  check("10. Signed-in partner cannot read greeting_content through the Supabase API", !!restError || (rows ?? []).length === 0, restError?.message);

  console.log("\nCleaning up fixtures...");
  await service.storage.from(bucket).remove([objectKey]);
  await admin`delete from partner_members where partner_id = ${partnerId}`;
  await service.auth.admin.deleteUser(authUserId);
  await admin`delete from greeting_content where greeting_id in (${blockedGreeting}, ${draftGreeting})`;
  await admin`delete from greetings where id in (${blockedGreeting}, ${draftGreeting})`;
  await admin`delete from qr_codes where batch_id = ${batchId}`;
  await admin`delete from qr_batches where id = ${batchId}`;
  await admin`delete from admin_users where user_id = ${adminUserId}`;
  await admin`delete from partners where id = ${partnerId}`;
  await admin.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end();
  process.exit(1);
});

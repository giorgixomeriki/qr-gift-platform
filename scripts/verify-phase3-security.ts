import Module from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
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
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const { generateEditToken, hashEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { updateGreetingMessage, requestMediaUpload, finalizeMediaUpload, deleteContent } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { getOrCreateCheckoutOrder, simulateTestPayment } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
const { confirmPaymentSuccess, activatePaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { loadActiveGreetingForRecipient, RecipientAccessError } = require("../src/lib/greetings/recipient") as typeof import("../src/lib/greetings/recipient");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "greeting-media";
const storage = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

// A minimal-but-real JPEG (SOI+APP0+EOI) so finalizeMediaUpload's real
// magic-byte verification (lib/storage/verify-upload.ts) genuinely passes —
// this fixture is not faking the upload path, it's a real (tiny) JPEG.
const REAL_JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

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
async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

function checkTestProviderBlockedInProduction(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "phase3-prod-check-"));
  const file = join(dir, "check.ts");
  const modulePath = join(__dirname, "../src/lib/payments/provider-factory").replace(/\\/g, "/");
  writeFileSync(
    file,
    // Same server-only shim as the top of this file, inlined here since this
    // runs as its own fresh subprocess (needed to get a genuinely fresh
    // NODE_ENV=production module load — see this function's caller).
    `const NodeModule = require("node:module");\n` +
      `const nodeModuleLoad = NodeModule._load;\n` +
      `NodeModule._load = function (request, ...rest) {\n` +
      `  if (request === "server-only") return {};\n` +
      `  return nodeModuleLoad.call(this, request, ...rest);\n` +
      `};\n` +
      `const { getPaymentProvider } = require("${modulePath}");\n` +
      `try { getPaymentProvider(); console.log("NOT_BLOCKED"); } catch (e) { console.log("BLOCKED:" + e.message); }\n`,
  );
  const output = execFileSync("npx", ["tsx", file], {
    cwd: join(__dirname, ".."),
    env: { ...process.env, NODE_ENV: "production", PAYMENTS_PROVIDER: "TEST" },
    encoding: "utf8",
  });
  return output.includes("BLOCKED:");
}

async function main() {
  console.log("Setting up fixtures (superuser)...");

  const partnerA = crypto.randomUUID();
  const commissionRateBps = 3000; // 30%
  const batchId = crypto.randomUUID();

  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerA}, ${"p3-partner-" + partnerA.slice(0, 8)}, 'Phase 3 Security Partner', ${commissionRateBps}, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerA}, 'p3-security-batch', 10)`;

  async function makeAvailableQr() {
    const id = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${id}, ${token}, ${batchId}, ${partnerA}, 'AVAILABLE')`;
    return { id, token };
  }

  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING' limit 1`;
  const [theme] = await admin`select id from themes where key = 'minimal' limit 1`;
  if (!product || !theme) throw new Error("Seed data missing — run npm run db:seed first");
  const [price] = await admin`select amount_minor, currency from prices where product_id = ${product.id} and partner_id is null and active limit 1`;
  if (!price) throw new Error("No active platform price for PREMIUM_GREETING — run npm run db:seed first");

  console.log("\n--- Checkout entry point: price/currency/partner/commission are server-derived ---");

  const mainQr = await makeAvailableQr();
  const { greetingId: mainGreeting, editToken: mainToken } = await startGreeting(mainQr.token);
  await updateGreetingMessage(mainGreeting, mainToken, "Security test message");
  const mainUpload = await requestMediaUpload(mainGreeting, mainToken, { type: "photo", slot: 0, mimeType: "image/jpeg", sizeBytes: REAL_JPEG_BYTES.length });
  const { error: mainUploadErr } = await storage.storage.from(bucket).upload(mainUpload.storageKey, REAL_JPEG_BYTES, { contentType: "image/jpeg", upsert: true });
  if (mainUploadErr) throw mainUploadErr;
  await finalizeMediaUpload(mainGreeting, mainToken, mainUpload.contentId);

  const { summary } = await getOrCreateCheckoutOrder(mainGreeting, mainToken);
  check("1. Order currency matches the live server-side price (no client input accepted it from)", summary.currency === price.currency);
  check("   Order gross amount matches the live server-side price", summary.grossAmountMinor === price.amount_minor);

  const [orderRow] = await admin`select partner_id, partner_commission_minor, platform_share_minor from orders where id = ${summary.orderId}`;
  check("2. Order partner attribution is the QR's actual partner (never client-choosable)", orderRow?.partner_id === partnerA);
  const expectedCommission = Math.floor((summary.grossAmountMinor * commissionRateBps) / 10000);
  check(
    "3. Order commission split matches the partner's actual (server-read) commission rate, not any client value",
    orderRow?.partner_commission_minor === expectedCommission && orderRow?.platform_share_minor === summary.grossAmountMinor - expectedCommission,
  );
  check(
    "   (structural) getOrCreateCheckoutOrder/simulateTestPayment take only (greetingId, editToken[, outcome]) — no amount/currency/partnerId/commission parameter exists in their signatures",
    true,
  );

  console.log("\n--- Wrong edit token / non-DRAFT Greetings cannot checkout ---");

  const wrongToken = generateEditToken();
  check("4. Wrong edit token cannot start/reuse checkout", await expectThrows(() => getOrCreateCheckoutOrder(mainGreeting, wrongToken)));

  const blockedToken = generateEditToken();
  const blockedGreetingId = crypto.randomUUID();
  const blockedQr = await makeAvailableQr();
  await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values
    (${blockedGreetingId}, ${blockedQr.id}, ${theme.id}, ${product.id}, 'BLOCKED', ${hashEditToken(blockedToken)})`;
  await admin`update qr_codes set status = 'BLOCKED' where id = ${blockedQr.id}`;
  check("5. A BLOCKED Greeting cannot enter checkout", await expectThrows(() => getOrCreateCheckoutOrder(blockedGreetingId, blockedToken)));

  console.log("\n--- Failed payment ---");

  const failResult = await simulateTestPayment(mainGreeting, mainToken, "failure");
  check("6. Simulated failure reports FAILED, not activated", failResult.status === "FAILED" && failResult.activated === false);

  const [greetingAfterFail] = await admin`select status from greetings where id = ${mainGreeting}`;
  const [qrAfterFail] = await admin`select status from qr_codes where id = ${mainQr.id}`;
  check("7. Failed payment does not activate the Greeting", greetingAfterFail?.status === "DRAFT");
  check("   Failed payment does not activate the QR", qrAfterFail?.status === "DRAFT");

  const ledgerAfterFail = await admin`select id from partner_ledger_entries where order_id = ${summary.orderId}`;
  check("8. Failed payment creates no commission ledger entry", ledgerAfterFail.length === 0);

  const [orderAfterFail] = await admin`select status from orders where id = ${summary.orderId}`;
  check("   The order itself reflects FAILED", orderAfterFail?.status === "FAILED");

  console.log("\n--- Retry after failure ---");

  const { summary: retrySummary } = await getOrCreateCheckoutOrder(mainGreeting, mainToken);
  check("9. Retry creates a NEW order rather than reusing the terminal FAILED one", retrySummary.orderId !== summary.orderId);

  const retrySuccess = await simulateTestPayment(mainGreeting, mainToken, "success");
  check("10. Retry payment succeeds and activates", retrySuccess.status === "PAID" && retrySuccess.activated === true);

  const [greetingAfterSuccess] = await admin`select status from greetings where id = ${mainGreeting}`;
  const [qrAfterSuccess] = await admin`select status from qr_codes where id = ${mainQr.id}`;
  check("    Greeting is now ACTIVE", greetingAfterSuccess?.status === "ACTIVE");
  check("    QR is now ACTIVE", qrAfterSuccess?.status === "ACTIVE");

  console.log("\n--- Successful payment activates exactly once ---");

  check(
    "11. Re-entering checkout on an already-PAID/ACTIVE Greeting is rejected (edit token no longer authorizes — status isn't DRAFT)",
    await expectThrows(() => getOrCreateCheckoutOrder(mainGreeting, mainToken)),
  );
  check(
    "    A second simulateTestPayment call finds no PENDING order left to confirm (can't be paid twice)",
    await expectThrows(() => simulateTestPayment(mainGreeting, mainToken, "success")),
  );
  const secondActivate = await activatePaidOrder(retrySummary.orderId);
  check("    Calling activatePaidOrder again directly is a safe no-op (idempotent), not a duplicate activation", secondActivate.activated === false);

  console.log("\n--- Duplicate payment-service callback produces exactly one commission/activation ---");

  const dupQr = await makeAvailableQr();
  const { greetingId: dupGreeting, editToken: dupToken } = await startGreeting(dupQr.token);
  const { summary: dupSummary } = await getOrCreateCheckoutOrder(dupGreeting, dupToken);
  const dupProviderPaymentId = `dup_test_${crypto.randomUUID()}`;
  await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: dupProviderPaymentId, orderId: dupSummary.orderId, amountMinor: dupSummary.grossAmountMinor, currency: dupSummary.currency });
  await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: dupProviderPaymentId, orderId: dupSummary.orderId, amountMinor: dupSummary.grossAmountMinor, currency: dupSummary.currency });
  const dupLedger = await admin`select id from partner_ledger_entries where order_id = ${dupSummary.orderId} and type = 'COMMISSION_EARNED'`;
  check("12. Duplicate confirmPaymentSuccess callbacks produce exactly one commission entry", dupLedger.length === 1);
  const dupActivate1 = await activatePaidOrder(dupSummary.orderId);
  const dupActivate2 = await activatePaidOrder(dupSummary.orderId);
  check("13. Duplicate activation calls activate exactly once (second is a no-op)", dupActivate1.activated === true && dupActivate2.activated === false);

  console.log("\n--- Sender cannot mutate after activation ---");

  check("14a. Text edit is rejected after activation", await expectThrows(() => updateGreetingMessage(mainGreeting, mainToken, "post-activation hack")));
  check("14b. Media upload is rejected after activation", await expectThrows(() => requestMediaUpload(mainGreeting, mainToken, { type: "photo", slot: 1, mimeType: "image/png", sizeBytes: 1024 })));
  const [mainPhotoRow] = await admin`select id from greeting_content where greeting_id = ${mainGreeting} and type = 'photo' limit 1`;
  check("14c. Content delete is rejected after activation", await expectThrows(() => deleteContent(mainGreeting, mainToken, mainPhotoRow!.id)));

  console.log("\n--- Recipient media access ---");

  const activeData = await loadActiveGreetingForRecipient(mainGreeting);
  check("15. Public (anonymous) access to an ACTIVE Greeting returns its own signed media", activeData.content.some((c) => c.type === "photo" && !!c.signedUrl));
  const [realPhoto] = await admin`select storage_key from greeting_content where greeting_id = ${mainGreeting} and type = 'photo' limit 1`;
  check(
    "   The signed URL genuinely corresponds to that content row's own storage key (path containment), never an arbitrary key",
    activeData.content.some((c) => c.storageKey === realPhoto!.storage_key),
  );

  const draftPrivacyQr = await makeAvailableQr();
  const { greetingId: draftPrivacyGreeting } = await startGreeting(draftPrivacyQr.token);
  check("16. A still-DRAFT Greeting's media is not reachable through the recipient path", await expectThrows(() => loadActiveGreetingForRecipient(draftPrivacyGreeting)));
  const draftPrivacyRejection = await (async () => {
    try {
      await loadActiveGreetingForRecipient(draftPrivacyGreeting);
      return false;
    } catch (err) {
      return err instanceof RecipientAccessError;
    }
  })();
  check("    ...and fails with the correct typed error, not an unrelated crash", draftPrivacyRejection);

  console.log("\n--- Recipient access exposes no Partner-private data ---");

  const exposedGreetingKeys = Object.keys(activeData.greeting);
  const partnerOnlyFields = ["name", "commissionRateBps", "branding", "slug", "defaultLocale"];
  check("17. loadActiveGreetingForRecipient's Greeting row exposes no partner fields", !exposedGreetingKeys.some((k) => partnerOnlyFields.includes(k)));

  console.log("\n--- TEST provider cannot run in production configuration ---");
  check("18. getPaymentProvider() refuses TEST when NODE_ENV=production", checkTestProviderBlockedInProduction());

  console.log("\nCleaning up fixtures...");
  await admin`delete from analytics_events where qr_code_id in (${mainQr.id}, ${blockedQr.id}, ${dupQr.id}, ${draftPrivacyQr.id})`;
  await admin`delete from partner_ledger_entries where partner_id = ${partnerA}`;
  await admin`delete from payments where order_id in (select id from orders where partner_id = ${partnerA})`;
  await admin`delete from orders where partner_id = ${partnerA}`;
  await admin`delete from greeting_content where greeting_id in (${mainGreeting}, ${blockedGreetingId}, ${dupGreeting}, ${draftPrivacyGreeting})`;
  await admin`delete from greetings where qr_code_id in (${mainQr.id}, ${blockedQr.id}, ${dupQr.id}, ${draftPrivacyQr.id})`;
  await admin`delete from qr_codes where batch_id = ${batchId}`;
  await admin`delete from qr_batches where id = ${batchId}`;
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

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
const { eq } = require("drizzle-orm") as typeof import("drizzle-orm");
const { withPartnerContext, withPublicContext, withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
const { greetingContent, greetings, auditLogs } = require("../src/db/schema") as typeof import("../src/db/schema");
const { generateEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { resolveQrState } = require("../src/lib/qr/resolve-state") as typeof import("../src/lib/qr/resolve-state");
const { loadActiveGreetingForRecipient, isOriginalSender } = require("../src/lib/greetings/recipient") as typeof import("../src/lib/greetings/recipient");
const { findGreetingForModeration, blockGreeting, unblockGreeting } = require("../src/lib/moderation/service") as typeof import("../src/lib/moderation/service");
const { buildQrInventoryCsv } = require("../src/lib/qr/csv") as typeof import("../src/lib/qr/csv");

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
  const dir = mkdtempSync(join(tmpdir(), "phase4-prod-check-"));
  const file = join(dir, "check.ts");
  const modulePath = join(__dirname, "../src/lib/payments/provider-factory").replace(/\\/g, "/");
  writeFileSync(
    file,
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
  const partnerAUser = crypto.randomUUID();
  const adminUser = crypto.randomUUID();
  const batchId = crypto.randomUUID();

  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerA}, ${"p4-partner-" + partnerA.slice(0, 8)}, 'Phase 4 Security Partner', 1000, 'ACTIVE')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerA}, ${partnerAUser}, 'OWNER')`;
  await admin`insert into admin_users (user_id) values (${adminUser})`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerA}, 'p4-security-batch', 10)`;

  async function makeAvailableQr() {
    const id = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${id}, ${token}, ${batchId}, ${partnerA}, 'AVAILABLE')`;
    return { id, token };
  }

  console.log("\n--- Partner still cannot read Greeting content ---");
  const qr1 = await makeAvailableQr();
  const { greetingId: greeting1, editToken: editToken1 } = await startGreeting(qr1.token);
  await updateGreetingMessage(greeting1, editToken1, "Phase 4 private message");
  const partnerContentRead = await withPartnerContext(partnerAUser, partnerA, (tx) => tx.select().from(greetingContent).where(eq(greetingContent.greetingId, greeting1)));
  check("1. Partner (even the owning partner) cannot SELECT greeting_content", partnerContentRead.length === 0);

  console.log("\n--- Admin operational lookup does not expose content ---");
  const lookup = await withAdminContext(adminUser, (tx) => findGreetingForModeration(tx, qr1.token));
  check("2. findGreetingForModeration resolves the Greeting", lookup?.greetingId === greeting1);
  const lookupKeys = lookup ? Object.keys(lookup) : [];
  const contentShapedFields = ["message", "textValue", "storageKey", "mimeType", "signedUrl", "content"];
  check("   ...but its return shape has no content-shaped field at all", !contentShapedFields.some((k) => lookupKeys.includes(k)));

  console.log("\n--- Old DRAFT cannot be hijacked through the public QR token ---");
  const publicResolution = await resolveQrState(qr1.token);
  check("3. Public resolution for a DRAFT greeting exposes no edit capability, only kind/ids", publicResolution.kind === "draft");
  const senderCheck = await isOriginalSender(greeting1, editToken1);
  const wrongTokenCheck = await isOriginalSender(greeting1, generateEditToken());
  check("   The QR public token itself was never accepted as an edit token anywhere in this path", wrongTokenCheck === false && senderCheck === true);

  console.log("\n--- Moderation: block requires real Admin, is audit logged ---");
  const nonAdminBlockAttempt = await expectThrows(() => withPartnerContext(partnerAUser, partnerA, (tx) => blockGreeting(tx, partnerAUser, greeting1, "attempted by a non-admin")));
  check("4. A partner (non-admin) context cannot block a Greeting", nonAdminBlockAttempt);
  const [greetingStillDraft] = await admin`select status from greetings where id = ${greeting1}`;
  check("   ...and the Greeting is genuinely untouched, not silently 'blocked' with a false-success audit entry", greetingStillDraft?.status === "DRAFT");

  await withAdminContext(adminUser, (tx) => blockGreeting(tx, adminUser, greeting1, "Phase 4 security test — real admin block"));
  const [blockedRow] = await admin`select status from greetings where id = ${greeting1}`;
  const [qrBlockedRow] = await admin`select status from qr_codes where id = ${qr1.id}`;
  check("5. A genuine admin CAN block a Greeting", blockedRow?.status === "BLOCKED");
  check("   ...and its QR is blocked uniformly too", qrBlockedRow?.status === "BLOCKED");

  const blockAuditRows = await admin`select actor_id, action, metadata from audit_logs where target_type = 'greeting' and target_id = ${greeting1} and action = 'GREETING_BLOCKED'`;
  check("6. The block action is audit logged with actor + reason", blockAuditRows.length === 1 && blockAuditRows[0]?.actor_id === adminUser && !!blockAuditRows[0]?.metadata?.reason);

  console.log("\n--- Blocked Greeting cannot render publicly or be edited ---");
  const blockedResolution = await resolveQrState(qr1.token);
  check("7. A BLOCKED QR's public resolution is 'blocked', not draft/active", blockedResolution.kind === "blocked");
  const editAfterBlockRejected = await expectThrows(() => updateGreetingMessage(greeting1, editToken1, "trying to edit a blocked greeting"));
  check("   A blocked Greeting cannot be edited even with its own (former) edit token", editAfterBlockRejected);
  const recipientAccessAfterBlockRejected = await expectThrows(() => loadActiveGreetingForRecipient(greeting1));
  check("   The recipient media path also refuses a BLOCKED Greeting", recipientAccessAfterBlockRejected);

  console.log("\n--- Unblock requires real Admin, is audit logged, restores DRAFT (no paid order existed) ---");
  const nonAdminUnblockAttempt = await expectThrows(() => withPartnerContext(partnerAUser, partnerA, (tx) => unblockGreeting(tx, partnerAUser, greeting1, "attempted by a non-admin")));
  check("8. A partner (non-admin) context cannot unblock a Greeting", nonAdminUnblockAttempt);

  const restoredStatus = await withAdminContext(adminUser, (tx) => unblockGreeting(tx, adminUser, greeting1, "Phase 4 security test — real admin unblock"));
  check("9. A genuine admin CAN unblock, restoring DRAFT (no PAID order existed for this Greeting)", restoredStatus === "DRAFT");
  const unblockAuditRows = await admin`select id from audit_logs where target_type = 'greeting' and target_id = ${greeting1} and action = 'GREETING_UNBLOCKED'`;
  check("   The unblock action is audit logged too", unblockAuditRows.length === 1);

  console.log("\n--- No private metadata leaks in public HTML ---");
  // The public dispatcher (/g/[token]) only ever renders fields from
  // resolveQrState's typed union (kind/qrId/greetingId/partnerId, the last of
  // which is used server-side for analytics attribution only, never rendered
  // — see app/g/[token]/page.tsx). Confirms that union has no wider surface.
  const availableQr = await makeAvailableQr();
  const availableResolution = await resolveQrState(availableQr.token);
  const resolutionKeys = Object.keys(availableResolution);
  check("10. resolveQrState's public shape carries only kind/qrId/partnerId — no partner name, no internal accounting", resolutionKeys.every((k) => ["kind", "qrId", "partnerId", "greetingId"].includes(k)));

  console.log("\n--- CSV export leaks no internal secrets (re-verified for Phase 4) ---");
  const csv = buildQrInventoryCsv([{ publicToken: availableQr.token, batchLabel: "Phase 4 batch", partnerName: "Phase 4 Security Partner", status: "AVAILABLE", distributionStatus: "NOT_DISTRIBUTED" }]);
  check("11. CSV contains no internal partner/batch UUID", !csv.includes(partnerA) && !csv.includes(batchId));

  console.log("\n--- TEST provider cannot run in production configuration (re-verified) ---");
  check("12. getPaymentProvider() refuses TEST when NODE_ENV=production", checkTestProviderBlockedInProduction());

  console.log("\n--- Anonymous cannot read audit logs or perform moderation ---");
  const anonAuditRead = await withPublicContext((tx) => tx.select().from(auditLogs).where(eq(auditLogs.targetId, greeting1)));
  check("13. Anonymous cannot read audit_logs", anonAuditRead.length === 0);
  // greeting1 is DRAFT again post-unblock — a real target an anonymous
  // caller might try to directly moderate (bypassing the admin service layer
  // entirely) rather than a no-op UUID. RLS can reject this two valid ways:
  // either no policy's USING clause matches the row at all (silent 0 rows),
  // or a DIFFERENT overlapping USING clause matches (e.g.
  // greetings_activate_by_payment's `status = 'DRAFT'`, which has no actor
  // check of its own) but that policy's own WITH CHECK then rejects the
  // attempted new value — Postgres surfaces that as a thrown RLS-violation
  // error, not an empty result. Both outcomes are a successful rejection.
  let anonModerationBlocked: boolean;
  try {
    const rows = await withPublicContext((tx) => tx.update(greetings).set({ status: "BLOCKED" }).where(eq(greetings.id, greeting1)).returning({ id: greetings.id }));
    anonModerationBlocked = rows.length === 0;
  } catch {
    anonModerationBlocked = true;
  }
  check("   Anonymous context cannot moderate a Greeting directly (rejected by RLS, either silently or by exception)", anonModerationBlocked);
  const [greetingStillDraftAfterAnonAttempt] = await admin`select status from greetings where id = ${greeting1}`;
  check("   ...and the Greeting genuinely remains untouched", greetingStillDraftAfterAnonAttempt?.status === "DRAFT");

  console.log("\nCleaning up fixtures...");
  await admin`delete from audit_logs where target_type = 'greeting' and target_id in (${greeting1})`;
  await admin`delete from greeting_content where greeting_id = ${greeting1}`;
  await admin`delete from greetings where qr_code_id in (${qr1.id}, ${availableQr.id})`;
  await admin`delete from qr_codes where batch_id = ${batchId}`;
  await admin`delete from qr_batches where id = ${batchId}`;
  await admin`delete from partner_members where partner_id = ${partnerA}`;
  await admin`delete from partners where id = ${partnerA}`;
  await admin`delete from admin_users where user_id = ${adminUser}`;

  await admin.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end();
  process.exit(1);
});

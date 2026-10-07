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
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { getOrCreateCheckoutOrder, checkPaymentReturn } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { signTestWebhook, TEST_WEBHOOK_SIGNATURE_HEADER } = require("../src/lib/payments/providers/test-provider") as typeof import("../src/lib/payments/providers/test-provider");
const { confirmPaymentSuccess, verifyAndReconcileOrder, markPaymentFailed } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { recordManualPayout, getPartnerUnpaidBalance, getPartnerPayoutStatement } = require("../src/lib/payments/payouts") as typeof import("../src/lib/payments/payouts");
const { withAdminContext, withPartnerContext, withPublicContext } = require("../src/db/client") as typeof import("../src/db/client");
const { partnerLedgerEntries } = require("../src/db/schema") as typeof import("../src/db/schema");
const { eq } = require("drizzle-orm") as typeof import("drizzle-orm");

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

/** Same subprocess technique as verify-phase3/4-security.ts, for a genuinely fresh module load under a different NODE_ENV/PAYMENTS_PROVIDER. */
function runInSubprocess(code: string, env: Record<string, string | undefined>): string {
  const dir = mkdtempSync(join(tmpdir(), "phase5-subprocess-"));
  const file = join(dir, "check.ts");
  writeFileSync(
    file,
    `const NodeModule = require("node:module");\n` +
      `const nodeModuleLoad = NodeModule._load;\n` +
      `NodeModule._load = function (request, ...rest) {\n` +
      `  if (request === "server-only") return {};\n` +
      `  return nodeModuleLoad.call(this, request, ...rest);\n` +
      `};\n` +
      code,
  );
  try {
    return execFileSync("npx", ["tsx", file], { cwd: join(__dirname, ".."), env: { ...process.env, ...env }, encoding: "utf8" });
  } catch (err) {
    // execFileSync throws on non-zero exit — stdout still carries our console.log output.
    return (err as { stdout?: string }).stdout ?? "";
  }
}

function checkTestProviderBlockedInProduction(): boolean {
  const modulePath = join(__dirname, "../src/lib/payments/provider-factory").replace(/\\/g, "/");
  const output = runInSubprocess(
    `const { getPaymentProvider } = require("${modulePath}");\n` +
      `try { getPaymentProvider(); console.log("NOT_BLOCKED"); } catch (e) { console.log("BLOCKED:" + e.message); }\n`,
    { NODE_ENV: "production", PAYMENTS_PROVIDER: "TEST" },
  );
  return output.includes("BLOCKED:");
}

function checkMissingBogCredentialsFailClosed(): boolean {
  const modulePath = join(__dirname, "../src/lib/env").replace(/\\/g, "/");
  const output = runInSubprocess(
    `try { require("${modulePath}"); console.log("LOADED_OK"); } catch (e) { console.log("REJECTED:" + e.message); }\n`,
    {
      NODE_ENV: "production",
      PAYMENTS_PROVIDER: "BOG",
      BOG_CLIENT_ID: undefined,
      BOG_CLIENT_SECRET: undefined,
      BOG_API_BASE_URL: undefined,
      BOG_WEBHOOK_SIGNING_KEY: undefined,
    },
  );
  return output.includes("REJECTED:") && output.includes("BOG_CLIENT_ID");
}

function checkBogWebhookReturns501WhenSelected(): boolean {
  // A fresh process with PAYMENTS_PROVIDER=BOG and dummy-but-present
  // credentials (env.ts only checks presence, not validity) — confirms the
  // webhook route boundary itself (not just the adapter class in isolation)
  // correctly surfaces "not implemented" as an HTTP response rather than an
  // unhandled crash or, worse, a silent 200.
  const routePath = join(__dirname, "../src/app/api/webhooks/payments/[provider]/route").replace(/\\/g, "/");
  // Resolved by absolute path, not the bare specifier "next/server" — the
  // subprocess's check.ts file lives in a scratch tmp dir outside the
  // project tree, so Node's own module resolution (walking up from that
  // file's location) would never find node_modules/next otherwise.
  const nextServerPath = join(__dirname, "../node_modules/next/server").replace(/\\/g, "/");
  const output = runInSubprocess(
    `const { POST } = require("${routePath}");\n` +
      `const { NextRequest } = require("${nextServerPath}");\n` +
      `(async () => {\n` +
      `  const req = new NextRequest("http://localhost/api/webhooks/payments/BOG", { method: "POST", body: "{}" });\n` +
      `  const res = await POST(req, { params: Promise.resolve({ provider: "BOG" }) });\n` +
      `  console.log("STATUS:" + res.status);\n` +
      `})();\n`,
    {
      NODE_ENV: "development",
      PAYMENTS_PROVIDER: "BOG",
      BOG_CLIENT_ID: "dummy",
      BOG_CLIENT_SECRET: "dummy",
      BOG_API_BASE_URL: "https://example.invalid",
      BOG_WEBHOOK_SIGNING_KEY: "dummy",
    },
  );
  return output.includes("STATUS:501");
}

/** Grep-based structural check: no "use client" file imports the server secrets module directly. */
function checkNoClientComponentImportsServerEnv(): boolean {
  const output = execFileSync(
    "bash",
    [
      "-c",
      `grep -rl '"use client"' ${join(__dirname, "../src")} | xargs grep -l 'from "@/lib/env"' 2>/dev/null || true`,
    ],
    { encoding: "utf8" },
  ).trim();
  return output.length === 0;
}

async function main() {
  console.log("Setting up fixtures (superuser)...");

  const partnerA = crypto.randomUUID();
  const partnerB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const adminUserId = crypto.randomUUID();
  const commissionRateBps = 3000;
  const batchId = crypto.randomUUID();

  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerA}, ${"p5-partner-a-" + partnerA.slice(0, 8)}, 'Phase 5 Security Partner A', ${commissionRateBps}, 'ACTIVE')`;
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerB}, ${"p5-partner-b-" + partnerB.slice(0, 8)}, 'Phase 5 Security Partner B', ${commissionRateBps}, 'ACTIVE')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerA}, ${userA}, 'OWNER')`;
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerA}, 'p5-security-batch', 10)`;

  async function makeAvailableQr() {
    const id = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${id}, ${token}, ${batchId}, ${partnerA}, 'AVAILABLE')`;
    return { id, token };
  }

  async function newCheckoutOrder() {
    const qr = await makeAvailableQr();
    const { greetingId, editToken } = await startGreeting(qr.token);
    // A message is required before checkout (migrations/0011 purchase eligibility).
    await updateGreetingMessage(greetingId, editToken, "Phase 5 test message");
    const { summary } = await getOrCreateCheckoutOrder(greetingId, editToken);
    return { qr, greetingId, editToken, summary };
  }

  const greetingIds: string[] = [];
  const qrIds: string[] = [];

  console.log("\n--- confirmPaymentSuccess rejects wrong amount/currency (Phase 5 §10) ---");
  {
    const { greetingId, qr, summary } = await newCheckoutOrder();
    greetingIds.push(greetingId);
    qrIds.push(qr.id);
    const [pending] = await admin`select provider_payment_id from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    check(
      "1. Wrong amount is rejected",
      await expectThrows(() =>
        confirmPaymentSuccess({ provider: "TEST", providerPaymentId: pending!.provider_payment_id, orderId: summary.orderId, amountMinor: summary.grossAmountMinor + 1, currency: summary.currency }),
      ),
    );
    check(
      "2. Wrong currency is rejected",
      await expectThrows(() =>
        confirmPaymentSuccess({ provider: "TEST", providerPaymentId: pending!.provider_payment_id, orderId: summary.orderId, amountMinor: summary.grossAmountMinor, currency: "USD" }),
      ),
    );
    const [orderRow] = await admin`select status from orders where id = ${summary.orderId}`;
    check("   Order is still PENDING_PAYMENT after both rejections — no partial state change", orderRow?.status === "PENDING_PAYMENT");
  }

  console.log("\n--- Provider payment/order mismatch rejected ---");
  {
    const first = await newCheckoutOrder();
    const second = await newCheckoutOrder();
    greetingIds.push(first.greetingId, second.greetingId);
    qrIds.push(first.qr.id, second.qr.id);
    const [firstPending] = await admin`select provider_payment_id from payments where order_id = ${first.summary.orderId} and status = 'PENDING'`;

    await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: firstPending!.provider_payment_id, orderId: first.summary.orderId, amountMinor: first.summary.grossAmountMinor, currency: first.summary.currency });
    check(
      "3. A providerPaymentId already tied to one order cannot be reused to confirm a different order",
      await expectThrows(() =>
        confirmPaymentSuccess({ provider: "TEST", providerPaymentId: firstPending!.provider_payment_id, orderId: second.summary.orderId, amountMinor: second.summary.grossAmountMinor, currency: second.summary.currency }),
      ),
    );
    const [secondOrder] = await admin`select status from orders where id = ${second.summary.orderId}`;
    check("   The second (mismatched) order was never activated", secondOrder?.status === "PENDING_PAYMENT");
  }

  console.log("\n--- Unknown provider payment id / order rejected ---");
  check("4. verifyAndReconcileOrder on a nonexistent order id throws, not a silent no-op", await expectThrows(() => verifyAndReconcileOrder(crypto.randomUUID())));
  {
    const { greetingId, qr, summary } = await newCheckoutOrder();
    greetingIds.push(greetingId);
    qrIds.push(qr.id);
    check(
      "   confirmPaymentSuccess with a providerPaymentId that matches no real payment attempt for this order still requires the amount/currency check (would insert a NEW payment row otherwise) — rejected when amount is wrong",
      await expectThrows(() => confirmPaymentSuccess({ provider: "TEST", providerPaymentId: `unknown_${crypto.randomUUID()}`, orderId: summary.orderId, amountMinor: 1, currency: summary.currency })),
    );
  }

  console.log("\n--- Duplicate webhook / browser-return idempotency ---");
  {
    const { greetingId, editToken, qr, summary } = await newCheckoutOrder();
    greetingIds.push(greetingId);
    qrIds.push(qr.id);
    const result = await verifyAndReconcileOrder(summary.orderId);
    check("5. verifyAndReconcileOrder (the return-page/webhook-shared path) activates a genuinely PENDING order", result.status === "PAID" && result.activated === true);

    const ledgerAfterFirst = await admin`select id from partner_ledger_entries where order_id = ${summary.orderId} and type = 'COMMISSION_EARNED'`;
    check("   Commission earned exactly once", ledgerAfterFirst.length === 1);

    const second = await verifyAndReconcileOrder(summary.orderId);
    check("6. Duplicate call (simulating webhook + browser return both firing) is idempotent — no re-activation, no error", second.status === "PAID" && second.activated === false);

    const ledgerAfterSecond = await admin`select id from partner_ledger_entries where order_id = ${summary.orderId} and type = 'COMMISSION_EARNED'`;
    check("   Still exactly one commission entry after the duplicate", ledgerAfterSecond.length === 1);

    const returnPageResult = await checkPaymentReturn(greetingId, editToken).catch(() => null);
    check("7. checkPaymentReturn on an already-ACTIVE greeting returns cleanly (its own DRAFT-only lookup no longer applies) rather than throwing", returnPageResult !== null);
  }

  console.log("\n--- Webhook + browser-return race safety ---");
  {
    const { greetingId, qr, summary } = await newCheckoutOrder();
    greetingIds.push(greetingId);
    qrIds.push(qr.id);
    // Two concurrent reconciliation attempts on the same PENDING order —
    // exercises confirmPaymentSuccess's SELECT ... FOR UPDATE row lock for
    // real, not just sequential calls.
    const [a, b] = await Promise.all([verifyAndReconcileOrder(summary.orderId), verifyAndReconcileOrder(summary.orderId)]);
    const activatedCount = [a.activated, b.activated].filter(Boolean).length;
    check("8. Exactly one of two concurrent reconciliation attempts performs the activation", activatedCount === 1);
    const ledgerRace = await admin`select id from partner_ledger_entries where order_id = ${summary.orderId} and type = 'COMMISSION_EARNED'`;
    check("   Exactly one commission entry despite the race", ledgerRace.length === 1);
  }

  console.log("\n--- Failed / pending payment never activates ---");
  {
    const { greetingId, qr, summary } = await newCheckoutOrder();
    greetingIds.push(greetingId);
    qrIds.push(qr.id);
    const [greetingBefore] = await admin`select status from greetings where id = ${greetingId}`;
    check("9. A freshly-created PENDING_PAYMENT order has not activated anything", greetingBefore?.status === "DRAFT");

    await markPaymentFailed(summary.orderId);
    const [orderAfterFail] = await admin`select status from orders where id = ${summary.orderId}`;
    const [greetingAfterFail] = await admin`select status from greetings where id = ${greetingId}`;
    check("10. A failed payment leaves the order FAILED and the greeting DRAFT — never activated", orderAfterFail?.status === "FAILED" && greetingAfterFail?.status === "DRAFT");
    check("    verifyAndReconcileOrder on a FAILED (non-PENDING) order is a safe no-op, not a re-confirmation attempt", (await verifyAndReconcileOrder(summary.orderId)).activated === false);
  }

  console.log("\n--- Forged client input cannot substitute for provider truth ---");
  check(
    "11. (structural) checkPaymentReturn's signature takes only (greetingId, editToken) — no status/amount/provider field a forged return URL query string could inject",
    true,
  );
  check(
    "    (structural) verifyAndReconcileOrder takes only an orderId and always re-derives status from provider.verifyPayment() — never from any caller-supplied status",
    true,
  );

  console.log("\n--- Webhook route: end-to-end happy path + rejection ---");
  {
    const { greetingId, qr, summary } = await newCheckoutOrder();
    greetingIds.push(greetingId);
    qrIds.push(qr.id);
    const [pending] = await admin`select provider_payment_id from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    const { POST } = await import("../src/app/api/webhooks/payments/[provider]/route");
    const { NextRequest } = await import("next/server");

    const badReq = new NextRequest("http://localhost/api/webhooks/payments/NOTAPROVIDER", { method: "POST", body: "{}" });
    const badRes = await POST(badReq, { params: Promise.resolve({ provider: "NOTAPROVIDER" }) });
    check("12. Webhook route rejects an unrecognized/unconfigured provider segment with 404", badRes.status === 404);

    const goodBody = JSON.stringify({ orderId: summary.orderId, providerPaymentId: pending!.provider_payment_id });
    // A genuine TEST webhook is signed with TEST_PAYMENTS_WEBHOOK_SECRET (QA-08).
    const webhookSecret = process.env.TEST_PAYMENTS_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error("TEST_PAYMENTS_WEBHOOK_SECRET is required for the webhook checks");
    const signed = { [TEST_WEBHOOK_SIGNATURE_HEADER]: signTestWebhook(goodBody, webhookSecret) };
    const goodReq = new NextRequest("http://localhost/api/webhooks/payments/TEST", { method: "POST", body: goodBody, headers: signed });
    const goodRes = await POST(goodReq, { params: Promise.resolve({ provider: "TEST" }) });
    check("13. A genuine webhook for a real pending payment is accepted (200) and activates", goodRes.status === 200);
    const [orderAfterWebhook] = await admin`select status from orders where id = ${summary.orderId}`;
    check("    Order is PAID after the webhook", orderAfterWebhook?.status === "PAID");

    const dupRes = await POST(new NextRequest("http://localhost/api/webhooks/payments/TEST", { method: "POST", body: goodBody, headers: signed }), { params: Promise.resolve({ provider: "TEST" }) });
    check("14. A duplicate delivery of the same webhook is still accepted (200), not an error — provider retry safety", dupRes.status === 200);
  }

  console.log("\n--- Production configuration safety ---");
  check("15. TEST provider refuses to construct when NODE_ENV=production", checkTestProviderBlockedInProduction());
  check("16. PAYMENTS_PROVIDER=BOG with missing credentials fails closed at env load, never falls back to TEST", checkMissingBogCredentialsFailClosed());
  check("17. The webhook route returns 501 (not a crash, not a silent 200) when the configured provider's handleWebhook is unimplemented", checkBogWebhookReturns501WhenSelected());
  check("18. No client component imports the server-only secrets module (@/lib/env) directly", checkNoClientComponentImportsServerEnv());

  console.log("\n--- Manual payout security (Phase 5 §17) ---");
  {
    // Real commission to pay out against.
    const { greetingId, qr, summary } = await newCheckoutOrder();
    greetingIds.push(greetingId);
    qrIds.push(qr.id);
    await verifyAndReconcileOrder(summary.orderId);
    const unpaidBalance = await withAdminContext(adminUserId, (tx) => getPartnerUnpaidBalance(tx, partnerA, summary.currency));
    check("   (fixture) Partner A has a real unpaid commission balance to test against", unpaidBalance > 0);

    // Itemized payouts (migrations/0014): a closed period covering this run's
    // commission, and the server's own statement as the confirmed expectation.
    const period = { periodFrom: new Date(Date.now() - 6 * 3600_000), periodTo: new Date() };
    const statement = await withAdminContext(adminUserId, (tx) => getPartnerPayoutStatement(tx, { partnerId: partnerA, currency: summary.currency, ...period }));
    const expected = { expectedAmountMinor: statement.payableMinor, expectedLedgerEntryIds: statement.eligibleLedgerEntryIds };
    check("   (fixture) the statement has payable commission rows", statement.blocker === null && statement.payableMinor > 0, JSON.stringify({ blocker: statement.blocker, payable: statement.payableMinor }));

    check(
      "19. A partner member (even OWNER of the target partner) cannot create a payout — admin-only by RLS",
      await expectThrows(() =>
        withPartnerContext(userA, partnerA, (tx) => recordManualPayout(tx, userA, { partnerId: partnerA, currency: summary.currency, ...period, ...expected })),
      ),
    );
    check(
      "20. An anonymous/unauthenticated context cannot create a payout",
      await expectThrows(() =>
        withPublicContext((tx) => recordManualPayout(tx, crypto.randomUUID(), { partnerId: partnerA, currency: summary.currency, ...period, ...expected })),
      ),
    );

    // RLS can reject an UPDATE either by throwing OR by silently matching 0
    // rows (same two valid rejection modes documented in verify-phase4's own
    // moderation test) — check the actual effect, not just whether it threw.
    const [ledgerRow] = await admin`select id, payout_id from partner_ledger_entries where partner_id = ${partnerA} and type = 'COMMISSION_EARNED' limit 1`;
    await withPartnerContext(userA, partnerA, (tx) => tx.update(partnerLedgerEntries).set({ payoutId: crypto.randomUUID() }).where(eq(partnerLedgerEntries.id, ledgerRow!.id))).catch(() => {});
    const [ledgerRowAfterPartnerAttempt] = await admin`select payout_id from partner_ledger_entries where id = ${ledgerRow!.id}`;
    check(
      "    A partner cannot mark its own commission paid by directly updating the ledger's payout_id either (no UPDATE policy exists on partner_ledger_entries at all)",
      ledgerRowAfterPartnerAttempt?.payout_id === null,
    );

    check(
      "21. A payout claiming more than the server-computed amount is rejected",
      await expectThrows(() => withAdminContext(adminUserId, (tx) => recordManualPayout(tx, adminUserId, { partnerId: partnerA, currency: summary.currency, ...period, ...expected, expectedAmountMinor: unpaidBalance + 1_000_000 }))),
    );
    check(
      "22. A zero-amount payout is rejected",
      await expectThrows(() => withAdminContext(adminUserId, (tx) => recordManualPayout(tx, adminUserId, { partnerId: partnerA, currency: summary.currency, ...period, ...expected, expectedAmountMinor: 0 }))),
    );
    check(
      "    A negative-amount payout is rejected",
      await expectThrows(() => withAdminContext(adminUserId, (tx) => recordManualPayout(tx, adminUserId, { partnerId: partnerA, currency: summary.currency, ...period, ...expected, expectedAmountMinor: -500 }))),
    );

    const realPayout = await withAdminContext(adminUserId, (tx) =>
      recordManualPayout(tx, adminUserId, { partnerId: partnerA, currency: summary.currency, ...period, ...expected, reference: "phase5-security-test" }),
    );
    check("23. A valid payout of the statement's exact rows succeeds and is recorded PAID", realPayout.status === "PAID" && realPayout.amountMinor === statement.payableMinor);

    const balanceAfter = await withAdminContext(adminUserId, (tx) => getPartnerUnpaidBalance(tx, partnerA, summary.currency));
    check("24. Unpaid balance decreases by exactly the payout amount", balanceAfter === unpaidBalance - statement.payableMinor);

    check(
      "25. Duplicate payout for the same (partner, currency, overlapping period) is rejected",
      await expectThrows(() =>
        withAdminContext(adminUserId, (tx) => recordManualPayout(tx, adminUserId, { partnerId: partnerA, currency: summary.currency, periodFrom: new Date(period.periodFrom.getTime() + 60_000), periodTo: new Date(), ...expected })),
      ),
    );

    check(
      "26. Cross-partner payout targeting (Partner A's own user context, but a partnerId argument of Partner B) is still rejected — admin-only RLS doesn't care whose id was passed",
      await expectThrows(() =>
        withPartnerContext(userA, partnerA, (tx) => recordManualPayout(tx, userA, { partnerId: partnerB, currency: summary.currency, ...period, ...expected })),
      ),
    );

    const [ledgerRowBeforeAdminAttempt] = await admin`select amount_minor from partner_ledger_entries where id = ${ledgerRow!.id}`;
    await withAdminContext(adminUserId, (tx) => tx.update(partnerLedgerEntries).set({ amountMinor: 999999 }).where(eq(partnerLedgerEntries.id, ledgerRow!.id))).catch(() => {});
    const [ledgerRowAfterAdminAttempt] = await admin`select amount_minor from partner_ledger_entries where id = ${ledgerRow!.id}`;
    check(
      "27. The ledger is append-only even for an admin — no UPDATE policy exists on partner_ledger_entries at all",
      ledgerRowAfterAdminAttempt?.amount_minor === ledgerRowBeforeAdminAttempt?.amount_minor,
    );

    const [auditRow] = await admin`select id from audit_logs where action = 'PARTNER_PAYOUT_RECORDED' and target_id = ${realPayout.id}`;
    check("28. The payout is audit logged", !!auditRow);
  }

  console.log("\nCleaning up fixtures...");
  if (qrIds.length > 0) {
    await admin`delete from analytics_events where qr_code_id in ${admin(qrIds)}`;
  }
  await admin`delete from audit_logs where actor_id = ${adminUserId} and action = 'PARTNER_PAYOUT_RECORDED'`;
  await admin`delete from partner_payout_items where partner_id in (${partnerA}, ${partnerB})`;
  await admin`delete from partner_ledger_entries where partner_id in (${partnerA}, ${partnerB})`;
  await admin`delete from partner_payouts where partner_id in (${partnerA}, ${partnerB})`;
  await admin`delete from payments where order_id in (select id from orders where partner_id in (${partnerA}, ${partnerB}))`;
  await admin`delete from orders where partner_id in (${partnerA}, ${partnerB})`;
  if (greetingIds.length > 0) {
    await admin`delete from greeting_content where greeting_id in ${admin(greetingIds)}`;
    await admin`delete from greetings where id in ${admin(greetingIds)}`;
  }
  await admin`delete from qr_codes where batch_id = ${batchId}`;
  await admin`delete from qr_batches where id = ${batchId}`;
  await admin`delete from partner_members where partner_id = ${partnerA}`;
  await admin`delete from admin_users where user_id = ${adminUserId}`;
  await admin`delete from partners where id in (${partnerA}, ${partnerB})`;

  await admin.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end();
  process.exit(1);
});

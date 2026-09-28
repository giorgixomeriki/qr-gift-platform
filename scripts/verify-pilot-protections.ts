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

/**
 * Pilot QA fixes: QA-02 (empty greeting), QA-03 (payment for a blocked
 * greeting), QA-04 (suspended partner), QA-08 (TEST webhook) — plus the money
 * invariant 1 successful payment = 1 PAID order = 1 activation = 1 commission.
 * Each finding's original reproduction is re-run here against the service
 * layer and the real webhook route handler, on the local database.
 */
const postgres = require("postgres") as typeof import("postgres");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { getOrCreateCheckoutOrder, simulateTestPayment } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
const { startCheckout, confirmPaymentSuccess, refundIneligiblePayment } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { PurchaseNotAllowedError } = require("../src/lib/payments/eligibility") as typeof import("../src/lib/payments/eligibility");
const { resolveQrState } = require("../src/lib/qr/resolve-state") as typeof import("../src/lib/qr/resolve-state");
const { signTestWebhook, TEST_WEBHOOK_SIGNATURE_HEADER } = require("../src/lib/payments/providers/test-provider") as typeof import("../src/lib/payments/providers/test-provider");
const { withClaimableQr } = require("../src/db/client") as typeof import("../src/db/client");
const { qrCodes } = require("../src/db/schema") as typeof import("../src/db/schema");
const { and, eq } = require("drizzle-orm") as typeof import("drizzle-orm");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
const webhookSecret = process.env.TEST_PAYMENTS_WEBHOOK_SECRET;
if (!webhookSecret) throw new Error("TEST_PAYMENTS_WEBHOOK_SECRET is required (see .env.example)");
const admin = postgres(migrationsUrl, { max: 2 });

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
async function rejectionOf(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}
function isBlocker(err: unknown, reason: string): boolean {
  return err instanceof PurchaseNotAllowedError && err.reason === reason;
}

/** Fresh module load under a different environment (env.ts parses once per process). */
function runInSubprocess(code: string, env: Record<string, string | undefined>): string {
  const dir = mkdtempSync(join(tmpdir(), "pilot-protections-"));
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
  const childEnv: Record<string, string | undefined> = { ...process.env, ...env };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete childEnv[key];
  try {
    return execFileSync("npx", ["tsx", file], { cwd: join(__dirname, ".."), env: childEnv as NodeJS.ProcessEnv, encoding: "utf8" });
  } catch (err) {
    return (err as { stdout?: string }).stdout ?? "";
  }
}

const factoryPath = join(__dirname, "../src/lib/payments/provider-factory").replace(/\\/g, "/");
const routePath = join(__dirname, "../src/app/api/webhooks/payments/[provider]/route").replace(/\\/g, "/");

function providerOutcome(env: Record<string, string | undefined>): string {
  return runInSubprocess(
    `const { getPaymentProvider } = require("${factoryPath}");\n` +
      `try { getPaymentProvider(); console.log("CONSTRUCTED"); } catch (e) { console.log("REFUSED:" + e.message); }\n`,
    env,
  );
}
function testWebhookStatus(env: Record<string, string | undefined>): string {
  return runInSubprocess(
    `const { POST } = require("${routePath}");\n` +
      `const { NextRequest } = require("${require.resolve("next/server").replace(/\\/g, "/")}");\n` +
      `(async () => {\n` +
      `  const req = new NextRequest("http://localhost/api/webhooks/payments/TEST", { method: "POST", body: "{}" });\n` +
      `  const res = await POST(req, { params: Promise.resolve({ provider: "TEST" }) });\n` +
      `  console.log("STATUS:" + res.status);\n` +
      `})();\n`,
    env,
  );
}

async function main() {
  console.log("Setting up fixtures (superuser)...");
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values
    (${partnerId}, ${"pilot-" + partnerId.slice(0, 8)}, 'Pilot Protections Partner', 2500, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'pilot-protections', 20)`;

  const { POST } = await import("../src/app/api/webhooks/payments/[provider]/route");
  const { NextRequest } = await import("next/server");
  async function webhook(body: object, signature: string | null = "valid") {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (signature === "valid") headers[TEST_WEBHOOK_SIGNATURE_HEADER] = signTestWebhook(raw, webhookSecret!);
    else if (signature) headers[TEST_WEBHOOK_SIGNATURE_HEADER] = signature;
    const res = await POST(new NextRequest("http://localhost/api/webhooks/payments/TEST", { method: "POST", body: raw, headers }), {
      params: Promise.resolve({ provider: "TEST" }),
    });
    return res.status;
  }

  /** The same two updates, in the same order, as lib/moderation/service.ts blockGreeting. */
  async function blockLikeModeration(sql: import("postgres").Sql | import("postgres").TransactionSql, greetingId: string) {
    await sql`update greetings set status = 'BLOCKED' where id = ${greetingId}`;
    await sql`update qr_codes set status = 'BLOCKED' where id = (select qr_code_id from greetings where id = ${greetingId}) and status in ('ACTIVE', 'DRAFT')`;
  }

  async function newDraft(message: string | null) {
    const id = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${id}, ${token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    if (message !== null) await updateGreetingMessage(greetingId, editToken, message);
    return { qrId: id, token, greetingId, editToken };
  }
  async function pendingPaymentOf(orderId: string) {
    const [row] = await admin`select provider_payment_id from payments where order_id = ${orderId} and status = 'PENDING' order by created_at desc limit 1`;
    return row!.provider_payment_id as string;
  }
  async function state(greetingId: string) {
    const [g] = await admin`select g.status as greeting, q.status as qr from greetings g join qr_codes q on q.id = g.qr_code_id where g.id = ${greetingId}`;
    const ordersRows = await admin`select status from orders where greeting_id = ${greetingId}`;
    const [ledger] = await admin`select count(*)::int as n from partner_ledger_entries l join orders o on o.id = l.order_id where o.greeting_id = ${greetingId}`;
    const paymentsRows = await admin`select p.status from payments p join orders o on o.id = p.order_id where o.greeting_id = ${greetingId}`;
    return {
      greeting: g?.greeting as string,
      qr: g?.qr as string,
      orders: ordersRows.map((r) => r.status as string),
      ledger: ledger!.n as number,
      payments: paymentsRows.map((r) => r.status as string),
    };
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- QA-02: a greeting without a message cannot be bought ---");
  {
    const empty = await newDraft(null);
    const err = await rejectionOf(() => getOrCreateCheckoutOrder(empty.greetingId, empty.editToken));
    check("1. Checkout entry for a greeting with no message is refused (MISSING_MESSAGE)", isBlocker(err, "MISSING_MESSAGE"), String(err));
    check("   ...and no order was created", (await state(empty.greetingId)).orders.length === 0);

    const [product] = await admin`select product_id from greetings where id = ${empty.greetingId}`;
    const rlsErr = await rejectionOf(() => startCheckout({ greetingId: empty.greetingId, editToken: empty.editToken, productId: product!.product_id }));
    check("2. RLS backstop: even the lower-level startCheckout cannot insert an order for it", rlsErr !== null && (await state(empty.greetingId)).orders.length === 0);

    await admin`insert into greeting_content (greeting_id, type, slot, text_value, status) values (${empty.greetingId}, 'text', 0, '  \n\t ', 'READY')`;
    const wsErr = await rejectionOf(() => getOrCreateCheckoutOrder(empty.greetingId, empty.editToken));
    check("3. A whitespace-only message (written straight to the DB) still counts as no message", isBlocker(wsErr, "MISSING_MESSAGE"));

    // Message present at checkout, gone by the time payment arrives.
    const vanishing = await newDraft("Will be removed before payment");
    const { summary } = await getOrCreateCheckoutOrder(vanishing.greetingId, vanishing.editToken);
    await admin`delete from greeting_content where greeting_id = ${vanishing.greetingId}`;
    const simErr = await rejectionOf(() => simulateTestPayment(vanishing.greetingId, vanishing.editToken, "success"));
    check("4. TEST payment is refused before charging when the message is gone", isBlocker(simErr, "MISSING_MESSAGE"));
    const status = await webhook({ orderId: summary.orderId, providerPaymentId: await pendingPaymentOf(summary.orderId) });
    const after = await state(vanishing.greetingId);
    check("5. A payment that still arrives is refunded, not activated", status === 200 && after.orders.join() === "REFUNDED" && after.greeting === "DRAFT", JSON.stringify({ status, after }));
    check("   ...and books no commission", after.ledger === 0);
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- QA-03: payment for a greeting blocked while checkout was pending ---");
  {
    const g = await newDraft("Blocked while paying");
    const { summary } = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    const providerPaymentId = await pendingPaymentOf(summary.orderId);
    await blockLikeModeration(admin, g.greetingId);

    const reentry = await rejectionOf(() => getOrCreateCheckoutOrder(g.greetingId, g.editToken));
    check("6. A blocked greeting cannot re-enter checkout", reentry !== null);
    const sim = await rejectionOf(() => simulateTestPayment(g.greetingId, g.editToken, "success"));
    check("7. A blocked greeting cannot be paid through the TEST simulator", sim !== null);

    const status = await webhook({ orderId: summary.orderId, providerPaymentId });
    let s = await state(g.greetingId);
    check("8. Payment arriving afterwards: webhook acknowledged (200)", status === 200);
    check("   order ends REFUNDED (TEST refund), never PAID", s.orders.join() === "REFUNDED", s.orders.join());
    check("   the payment is recorded and then marked REFUNDED", s.payments.includes("REFUNDED") && !s.payments.includes("SUCCEEDED"), s.payments.join());
    check("   no commission booked; greeting and QR stay BLOCKED", s.ledger === 0 && s.greeting === "BLOCKED" && s.qr === "BLOCKED");

    const replay = await webhook({ orderId: summary.orderId, providerPaymentId });
    s = await state(g.greetingId);
    check("9. Replaying the webhook is a no-op (200, still one payment row, still no commission)", replay === 200 && s.payments.length === 1 && s.ledger === 0, JSON.stringify(s));

    // The race itself: moderation holds the greeting row mid-block while the payment is confirmed.
    const race = await newDraft("Race with moderation");
    const raceOrder = (await getOrCreateCheckoutOrder(race.greetingId, race.editToken)).summary;
    const racePaymentId = await pendingPaymentOf(raceOrder.orderId);
    let confirmResult: Awaited<ReturnType<typeof confirmPaymentSuccess>> | null = null;
    let confirmSettledBeforeCommit = false;
    await admin.begin(async (tx) => {
      await blockLikeModeration(tx, race.greetingId);
      const pending = confirmPaymentSuccess({
        provider: "TEST",
        providerPaymentId: racePaymentId,
        orderId: raceOrder.orderId,
        amountMinor: raceOrder.grossAmountMinor,
        currency: raceOrder.currency,
      }).then((r) => (confirmResult = r));
      await new Promise((resolve) => setTimeout(resolve, 500));
      confirmSettledBeforeCommit = confirmResult !== null;
      void pending;
    });
    while (!confirmResult) await new Promise((resolve) => setTimeout(resolve, 50));
    check("10. Race: payment confirmation waits for the in-flight moderation block (row lock)", !confirmSettledBeforeCommit);
    check("    ...then sees BLOCKED and routes to refund instead of PAID", (confirmResult as { outcome: string }).outcome === "REFUND_REQUIRED");
    check("    refundIneligiblePayment completes it", (await refundIneligiblePayment(raceOrder.orderId)).status === "REFUNDED");
    const raceState = await state(race.greetingId);
    check("    final: REFUNDED, no commission, not activated", raceState.orders.join() === "REFUNDED" && raceState.ledger === 0 && raceState.greeting === "BLOCKED");
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- QA-04: suspended partner ---");
  {
    const active = await newDraft("Paid before suspension");
    const activeOrder = (await getOrCreateCheckoutOrder(active.greetingId, active.editToken)).summary;
    await simulateTestPayment(active.greetingId, active.editToken, "success");
    const draft = await newDraft("Draft when suspended");
    const inFlight = await newDraft("Checkout open when suspended");
    const inFlightOrder = (await getOrCreateCheckoutOrder(inFlight.greetingId, inFlight.editToken)).summary;
    const availableId = crypto.randomUUID();
    const availableToken = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${availableId}, ${availableToken}, ${batchId}, ${partnerId}, 'AVAILABLE')`;

    await admin`update partners set status = 'SUSPENDED' where id = ${partnerId}`;

    check("11. New claim of an AVAILABLE card is refused", (await rejectionOf(() => startGreeting(availableToken))) !== null);
    const claimedViaRls = await withClaimableQr(availableId, (tx) =>
      tx.update(qrCodes).set({ status: "DRAFT" }).where(and(eq(qrCodes.id, availableId), eq(qrCodes.status, "AVAILABLE"))).returning({ id: qrCodes.id }),
    );
    check("    RLS backstop: the raw claim UPDATE matches no row", claimedViaRls.length === 0);
    check("12. The AVAILABLE card resolves as unavailable", (await resolveQrState(availableToken)).kind === "blocked");
    check("    An existing DRAFT resolves as unavailable", (await resolveQrState(draft.token)).kind === "blocked");
    check("13. Checkout for an existing draft is refused (PARTNER_SUSPENDED)", isBlocker(await rejectionOf(() => getOrCreateCheckoutOrder(draft.greetingId, draft.editToken)), "PARTNER_SUSPENDED"));
    check("    TEST payment of an already-open checkout is refused", isBlocker(await rejectionOf(() => simulateTestPayment(inFlight.greetingId, inFlight.editToken, "success")), "PARTNER_SUSPENDED"));
    const status = await webhook({ orderId: inFlightOrder.orderId, providerPaymentId: await pendingPaymentOf(inFlightOrder.orderId) });
    const inFlightState = await state(inFlight.greetingId);
    check("14. A payment that still arrives is refunded: no activation, no commission", status === 200 && inFlightState.orders.join() === "REFUNDED" && inFlightState.ledger === 0 && inFlightState.greeting === "DRAFT", JSON.stringify(inFlightState));
    check("15. An already-paid ACTIVE greeting stays readable by its recipient", (await resolveQrState(active.token)).kind === "active");
    const activeState = await state(active.greetingId);
    check("    ...and its order/commission are untouched", activeState.orders.join() === "PAID" && activeState.ledger === 1 && activeOrder.orderId.length > 0);

    await admin`update partners set status = 'ACTIVE' where id = ${partnerId}`;
    check("16. Reactivating the partner restores new claims", (await rejectionOf(() => startGreeting(availableToken))) === null);
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- QA-08: TEST webhook ---");
  {
    const g = await newDraft("Webhook forgery target");
    const { summary } = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    const forged = { orderId: summary.orderId, providerPaymentId: `test_${summary.grossAmountMinor}_${summary.currency}_00000000-0000-4000-8000-000000000001` };
    check("17. Unsigned webhook is rejected (400)", (await webhook(forged, null)) === 400);
    check("18. Wrongly-signed webhook is rejected (400)", (await webhook(forged, "0".repeat(64))) === 400);
    check("19. Signature over a different body is rejected (400)", (await webhook(forged, signTestWebhook("{}", webhookSecret!))) === 400);
    const s = await state(g.greetingId);
    check("    ...and the order is still PENDING_PAYMENT, nothing activated or booked", s.orders.join() === "PENDING_PAYMENT" && s.greeting === "DRAFT" && s.ledger === 0);

    const noSecret = testWebhookStatus({ NODE_ENV: "development", PAYMENTS_PROVIDER: "TEST", ALLOW_TEST_PAYMENTS: "true", TEST_PAYMENTS_WEBHOOK_SECRET: undefined });
    check("20. Without TEST_PAYMENTS_WEBHOOK_SECRET the TEST webhook does not exist (404)", noSecret.includes("STATUS:404"), noSecret);
    const notAllowed = testWebhookStatus({ NODE_ENV: "development", PAYMENTS_PROVIDER: "TEST", ALLOW_TEST_PAYMENTS: undefined });
    check("21. Without ALLOW_TEST_PAYMENTS=true the TEST webhook does not exist (404)", notAllowed.includes("STATUS:404"), notAllowed);
    const refused = providerOutcome({ NODE_ENV: "development", PAYMENTS_PROVIDER: "TEST", ALLOW_TEST_PAYMENTS: undefined });
    check("22. PAYMENTS_PROVIDER=TEST alone (no explicit opt-in) refuses to construct the provider", refused.includes("REFUSED:") && refused.includes("ALLOW_TEST_PAYMENTS"), refused);
    const prod = providerOutcome({ NODE_ENV: "production", PAYMENTS_PROVIDER: "TEST", ALLOW_TEST_PAYMENTS: "true" });
    check("23. ALLOW_TEST_PAYMENTS=true is still refused in production", prod.includes("REFUSED:"), prod);
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- Money integrity: 1 payment = 1 PAID order = 1 activation = 1 commission ---");
  {
    const g = await newDraft("Money integrity");
    const { summary } = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    const providerPaymentId = await pendingPaymentOf(summary.orderId);
    const statuses = await Promise.all([1, 2, 3].map(() => webhook({ orderId: summary.orderId, providerPaymentId })));
    const again = await webhook({ orderId: summary.orderId, providerPaymentId });
    const s = await state(g.greetingId);
    check("24. Three concurrent + one replayed signed webhooks all return 200", [...statuses, again].every((x) => x === 200), [...statuses, again].join());
    check("    exactly 1 PAID order, 1 SUCCEEDED payment, 1 commission, greeting + QR ACTIVE", s.orders.join() === "PAID" && s.payments.filter((p) => p === "SUCCEEDED").length === 1 && s.ledger === 1 && s.greeting === "ACTIVE" && s.qr === "ACTIVE", JSON.stringify(s));

    const [partnerTotals] = await admin`
      select
        (select count(*)::int from orders where partner_id = ${partnerId} and status = 'PAID') as paid,
        (select count(*)::int from payments p join orders o on o.id = p.order_id where o.partner_id = ${partnerId} and o.status = 'PAID' and p.status = 'SUCCEEDED') as succeeded,
        (select count(*)::int from partner_ledger_entries where partner_id = ${partnerId} and type = 'COMMISSION_EARNED') as ledger,
        (select count(*)::int from greetings g join qr_codes q on q.id = g.qr_code_id where q.partner_id = ${partnerId} and g.status = 'ACTIVE') as active,
        (select count(*)::int from orders o join partner_ledger_entries l on l.order_id = o.id where o.partner_id = ${partnerId} and o.status <> 'PAID') as ledger_on_unpaid`;
    check(
      "25. Across every order this run created: PAID = SUCCEEDED payments = commissions = ACTIVE greetings, and no commission on a non-PAID order",
      partnerTotals!.paid === partnerTotals!.succeeded && partnerTotals!.paid === partnerTotals!.ledger && partnerTotals!.paid === partnerTotals!.active && partnerTotals!.ledger_on_unpaid === 0,
      JSON.stringify(partnerTotals),
    );
  }

  console.log("\nCleaning up fixtures...");
  await admin`delete from analytics_events where qr_code_id in (select id from qr_codes where batch_id = ${batchId})`;
  await admin`delete from partner_ledger_entries where partner_id = ${partnerId}`;
  await admin`delete from payments where order_id in (select id from orders where partner_id = ${partnerId})`;
  await admin`delete from orders where partner_id = ${partnerId}`;
  await admin`delete from greeting_content where greeting_id in (select g.id from greetings g join qr_codes q on q.id = g.qr_code_id where q.batch_id = ${batchId})`;
  await admin`delete from greetings where qr_code_id in (select id from qr_codes where batch_id = ${batchId})`;
  await admin`delete from qr_codes where batch_id = ${batchId}`;
  await admin`delete from qr_batches where id = ${batchId}`;
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

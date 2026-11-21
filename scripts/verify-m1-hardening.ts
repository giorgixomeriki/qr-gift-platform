import Module from "node:module";
import type { AddressInfo } from "node:net";
import { sign } from "node:crypto";
import { execFileSync } from "node:child_process";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");

/**
 * M1 hardening (Render Free, before the first real BOG payment), against the
 * local database and the BOG simulator (scripts/lib-bog-simulator.ts):
 *
 *  A. Owner pilot gate (CHECKOUT_PILOT_QR_IDS): only the listed card can pay
 *     while CHECKOUT_ENABLED=false; never without the policies in force; the
 *     env value is validated.
 *  B. No second charge on a revisit: a sender who comes back without the
 *     bank's return link while a bank attempt is open is asked to wait (no
 *     Pay), and the server refuses a second attempt; a charged-but-unconfirmed
 *     payment (callback lost on a cold start) is recovered by the revisit.
 *  C. Missed callback, recovery without the customer: reconciliation finds a
 *     charged payment 30+ min old and settles it exactly once.
 *  D. Concurrency: callback + revisit + reconciliation at once = one PAID,
 *     one activation, one commission.
 *  E. Failure/expiry: card stays inactive, no commission, a new attempt is allowed.
 */
const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl || !/127\.0\.0\.1|localhost/.test(migrationsUrl)) throw new Error("local MIGRATIONS_DATABASE_URL required");
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
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string; name: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), name: e instanceof Error ? e.name : "" };
  }
}

const { bog, server, privateKey, complete, reject } = require("./lib-bog-simulator") as typeof import("./lib-bog-simulator");

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const pilotPlaceholder = "00000000-0000-4000-8000-000000000000";
  const ENV_PROBE = "const M=require('node:module');const l=M._load;M._load=function(r,...a){return r==='server-only'?{}:l.call(this,r,...a)};require('./src/lib/env')";

  Object.assign(process.env, {
    PAYMENTS_PROVIDER: "BOG",
    BOG_CLIENT_ID: "qa-client",
    BOG_CLIENT_SECRET: "qa-secret",
    BOG_API_BASE_URL: base,
    BOG_OAUTH_TOKEN_URL: `${base}/token`,
    BOG_WEBHOOK_SIGNING_KEY: (require("./lib-bog-simulator") as typeof import("./lib-bog-simulator")).publicKey.export({ type: "spki", format: "pem" }).toString(),
    CHECKOUT_ENABLED: "false", // production today
    CHECKOUT_PILOT_QR_IDS: pilotPlaceholder,
    BOG_REFUNDS_ENABLED: "false", // production today: a second charge would NOT be refunded automatically
    LEGAL_EFFECTIVE_DATE: "2026-01-01",
  });
  delete process.env.MERCHANT_PROFILE;
  delete process.env.ALLOW_TEST_PAYMENTS;
  delete process.env.VERCEL;

  const { env } = require("../src/lib/env") as typeof import("../src/lib/env");
  const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
  const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
  const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
  const { getOrCreateCheckoutOrder, acceptCheckoutTerms, checkPaymentReturn, PaymentInProgressError } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
  const { isCheckoutOpen, CheckoutUnavailableError } = require("../src/lib/payments/checkout-gate") as typeof import("../src/lib/payments/checkout-gate");
  const { handleProviderWebhook } = require("../src/lib/payments/webhook") as typeof import("../src/lib/payments/webhook");
  const { runPaymentReconciliation } = require("../src/lib/payments/reconcile") as typeof import("../src/lib/payments/reconcile");
  const { getReconcileHealth } = require("../src/lib/payments/reconcile-heartbeat") as typeof import("../src/lib/payments/reconcile-heartbeat");
  const { withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutableEnv = env as any;

  console.log("Setting up fixtures (superuser)...");
  const adminUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING'`;
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"m1-" + partnerId.slice(0, 8)}, 'M1 Hardening Partner', 3000, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'm1-hardening', 50)`;
  await admin`insert into prices (product_id, partner_id, currency, amount_minor, active) values (${product!.id}, ${partnerId}, 'GEL', 1000, true)`;

  async function newCard() {
    const qrId = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    await updateGreetingMessage(greetingId, editToken, "M1 hardening test message");
    return { qrId, greetingId, editToken };
  }
  const pilot = (...ids: string[]) => {
    mutableEnv.CHECKOUT_PILOT_QR_IDS = ids.map((id) => id.toLowerCase());
  };
  const bogCreates = () => bog.calls.filter((c) => c.path === "/ecommerce/orders").length;
  const orderCount = async (greetingId: string) => Number((await admin`select count(*)::int as n from orders where greeting_id = ${greetingId}`)[0]!.n);
  const paymentRows = async (greetingId: string) => admin`select p.status, p.provider_payment_id from payments p join orders o on o.id = p.order_id where o.greeting_id = ${greetingId} order by p.created_at`;
  const orderRows = async (greetingId: string) => (await admin`select id, status from orders where greeting_id = ${greetingId} order by created_at`).map((r) => r.status as string);
  const state = async (greetingId: string) => {
    const [r] = await admin`select g.status as g, q.status as q from greetings g join qr_codes q on q.id = g.qr_code_id where g.id = ${greetingId}`;
    return `${r!.g}/${r!.q}`;
  };
  const ledger = async (greetingId: string) =>
    (await admin`select l.type, l.amount_minor from partner_ledger_entries l join orders o on o.id = l.order_id where o.greeting_id = ${greetingId} order by l.created_at`).map((r) => `${r.type}:${r.amount_minor}`).join(",");
  /** Opens the order and the bank payment for a card (the customer pressed Pay). */
  async function payStarted(card: Awaited<ReturnType<typeof newCard>>) {
    const { summary } = await getOrCreateCheckoutOrder(card.greetingId, card.editToken);
    const { redirectUrl } = await acceptCheckoutTerms(card.greetingId, card.editToken, "ka");
    const [pay] = await admin`select provider_payment_id from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    return { orderId: summary.orderId, bogId: pay!.provider_payment_id as string, redirectUrl };
  }
  const callback = (bogId: string) => {
    const raw = JSON.stringify({ event: "order_payment", zoned_request_time: new Date().toISOString(), body: { order_id: bogId } });
    return handleProviderWebhook("BOG", raw, new Headers({ "Callback-Signature": sign("sha256", Buffer.from(raw, "utf8"), privateKey).toString("base64") }));
  };
  const ageAttempt = (orderId: string) => admin`update payments set created_at = now() - interval '45 minutes' where order_id = ${orderId} and status = 'PENDING'`;

  console.log("\n--- A. Owner pilot gate ---");
  {
    const other = await newCard();
    const card = await newCard();
    pilot();
    const before = bogCreates();
    const r = await attempt(() => getOrCreateCheckoutOrder(card.greetingId, card.editToken));
    check("A1. CHECKOUT_ENABLED=false, no pilot: closed, no order, nothing sent to BOG", !r.ok && r.name === "CheckoutUnavailableError" && (await orderCount(card.greetingId)) === 0 && bogCreates() === before);

    pilot(card.qrId.toUpperCase()); // case-insensitive
    const p = await attempt(() => payStarted(card));
    check("A2. Pilot card: order + consent + one BOG payment, 10.00 GEL", p.ok && p.value.redirectUrl?.startsWith("https://payment.bog.ge/") === true && bogCreates() === before + 1, p.ok ? "" : p.error);
    if (p.ok) {
      const create = bog.calls.filter((c) => c.path === "/ecommerce/orders").at(-1)?.body as { purchase_units: { total_amount: number; currency: string } } | undefined;
      check("A3. BOG asked for exactly 10 GEL", create?.purchase_units.total_amount === 10 && create.purchase_units.currency === "GEL", JSON.stringify(create?.purchase_units));
      reject(p.value.bogId);
      await checkPaymentReturn(card.greetingId, card.editToken);
    }
    const o = await attempt(() => getOrCreateCheckoutOrder(other.greetingId, other.editToken));
    check("A4. Any other card stays closed while the pilot is on", !o.ok && o.name === "CheckoutUnavailableError" && (await orderCount(other.greetingId)) === 0);

    process.env.LEGAL_EFFECTIVE_DATE = "";
    check("A5. Pilot never opens without the policies in force (LEGAL_EFFECTIVE_DATE unset)", !isCheckoutOpen(card.qrId));
    process.env.LEGAL_EFFECTIVE_DATE = "2999-01-01";
    check("A6. …nor before the effective date", !isCheckoutOpen(card.qrId));
    process.env.LEGAL_EFFECTIVE_DATE = "2026-01-01";
    check("A7. isCheckoutOpen() without a card id ignores the pilot list", !isCheckoutOpen() && isCheckoutOpen(card.qrId));

    mutableEnv.PAYMENTS_PROVIDER = "TEST";
    check("A8. TEST provider ignores the pilot (production refuses TEST anyway)", isCheckoutOpen(card.qrId) === (env.NODE_ENV !== "production"));
    mutableEnv.PAYMENTS_PROVIDER = "BOG";

    const health = await withAdminContext(adminUserId, (tx) => getReconcileHealth(tx));
    check("A9. Reconciliation counts as required while a pilot card is payable", health.required === true);
    pilot();
    const health2 = await withAdminContext(adminUserId, (tx) => getReconcileHealth(tx));
    check("A10. …and not required with checkout closed and no pilot", health2.required === false);

    const envCheck = (value: string) => {
      try {
        execFileSync(process.execPath, ["./node_modules/.bin/tsx", "-e", ENV_PROBE], {
          env: { ...process.env, CHECKOUT_PILOT_QR_IDS: value },
          stdio: "pipe",
        });
        return "accepted";
      } catch (e) {
        return String((e as { stderr?: Buffer }).stderr ?? "").includes("CHECKOUT_PILOT_QR_IDS") ? "rejected" : "other-error";
      }
    };
    check("A11. Env: a non-UUID pilot value is rejected at startup", envCheck("not-a-uuid") === "rejected");
    check("A12. Env: more than 3 pilot cards are rejected", envCheck([1, 2, 3, 4].map(() => crypto.randomUUID()).join(",")) === "rejected");
    check("A13. Env: one UUID is accepted", envCheck(crypto.randomUUID()) === "accepted");
  }

  // The rest runs as the pilot would in production: checkout closed, one card piloted.
  console.log("\n--- B. Revisit without the bank's return link: no second charge ---");
  {
    const card = await newCard();
    pilot(card.qrId);
    const p = await payStarted(card);
    const creates = bogCreates();
    // The customer is on BOG's page (status "created") and comes back to the card in another tab.
    const r = await getOrCreateCheckoutOrder(card.greetingId, card.editToken);
    check("B1. Revisit while the bank attempt is open → awaitingProvider, no Pay", r.awaitingProvider === true && r.recovered === false);
    const t = await attempt(() => acceptCheckoutTerms(card.greetingId, card.editToken, "ka"));
    check("B2. Server refuses a second bank payment (PaymentInProgressError)", !t.ok && t.name === new PaymentInProgressError().name);
    check("B3. …no new BOG order, still exactly one payment attempt", bogCreates() === creates && (await paymentRows(card.greetingId)).length === 1);

    // Paid at the bank; the callback is lost (cold start) and the browser never returns.
    complete(p.bogId);
    const v = await getOrCreateCheckoutOrder(card.greetingId, card.editToken);
    check("B4. Revisit after a lost callback → recovered: PAID, card ACTIVE, one 3.00 commission", v.recovered === true && (await orderRows(card.greetingId)).join() === "PAID" && (await state(card.greetingId)) === "ACTIVE/ACTIVE" && (await ledger(card.greetingId)) === "COMMISSION_EARNED:300", `${v.recovered} ${await orderRows(card.greetingId)} ${await state(card.greetingId)} ${await ledger(card.greetingId)}`);
    const late = await callback(p.bogId);
    const again = await checkPaymentReturn(card.greetingId, card.editToken);
    check("B5. Late callback + return check afterwards change nothing", late.status === 200 && again.status === "PAID" && (await ledger(card.greetingId)) === "COMMISSION_EARNED:300" && (await paymentRows(card.greetingId)).length === 1);
    check("B6. Still exactly one BOG order for this card", bogCreates() === creates);
  }
  {
    const card = await newCard();
    pilot(card.qrId);
    const p = await payStarted(card);
    bog.receiptFailure = "503";
    const r = await attempt(() => getOrCreateCheckoutOrder(card.greetingId, card.editToken));
    check("B7. BOG unreachable on revisit → awaitingProvider (unknown is never 'pay again')", r.ok && r.value.awaitingProvider === true);
    const t = await attempt(() => acceptCheckoutTerms(card.greetingId, card.editToken, "ka"));
    check("B8. …and no second bank payment", !t.ok && t.name === "PaymentInProgressError" && (await paymentRows(card.greetingId)).length === 1);
    bog.receiptFailure = null;
    // Checkout closes entirely (pilot removed) while the customer had paid.
    complete(p.bogId);
    pilot();
    const v = await attempt(() => getOrCreateCheckoutOrder(card.greetingId, card.editToken));
    check("B9. A charged payment is recovered on revisit even after checkout closed", v.ok && v.value.recovered === true && (await state(card.greetingId)) === "ACTIVE/ACTIVE" && (await ledger(card.greetingId)) === "COMMISSION_EARNED:300", v.ok ? "" : v.error);
  }

  console.log("\n--- C. Missed callback, customer never returns: reconciliation ---");
  {
    const card = await newCard();
    pilot(card.qrId);
    const p = await payStarted(card);
    complete(p.bogId); // charged; no callback, no return, no revisit
    const early = await runPaymentReconciliation(adminUserId, { apply: true });
    check("C1. Inside the 30-min window the run leaves it alone (PENDING_PAYMENT)", (await orderRows(card.greetingId)).join() === "PENDING_PAYMENT" && !early.actions.some((a) => a.orderId === p.orderId));
    await ageAttempt(p.orderId);
    const t0 = Date.now();
    const run = await runPaymentReconciliation(adminUserId, { apply: true });
    const act = run.actions.find((a) => a.orderId === p.orderId);
    check("C2. After 30 min: STALE_PENDING → asks BOG → PAID + activated", act?.kind === "STALE_PENDING" && act.ok && (await orderRows(card.greetingId)).join() === "PAID" && (await state(card.greetingId)) === "ACTIVE/ACTIVE", JSON.stringify(act));
    check("C3. Exactly one commission (3.00 GEL of 10.00)", (await ledger(card.greetingId)) === "COMMISSION_EARNED:300");
    const second = await runPaymentReconciliation(adminUserId, { apply: true });
    check("C4. A second run changes nothing for this order", !second.actions.some((a) => a.orderId === p.orderId) && (await ledger(card.greetingId)) === "COMMISSION_EARNED:300");
    console.log(`      (settling run took ${Date.now() - t0} ms against the simulator)`);
  }

  console.log("\n--- D. Callback + revisit + reconciliation at the same moment ---");
  {
    const card = await newCard();
    pilot(card.qrId);
    const p = await payStarted(card);
    complete(p.bogId);
    await ageAttempt(p.orderId);
    const results = await Promise.allSettled([
      callback(p.bogId),
      callback(p.bogId),
      getOrCreateCheckoutOrder(card.greetingId, card.editToken),
      checkPaymentReturn(card.greetingId, card.editToken),
      runPaymentReconciliation(adminUserId, { apply: true }),
    ]);
    const succeededPayments = (await paymentRows(card.greetingId)).filter((r) => r.status === "SUCCEEDED").length;
    check("D1. One PAID order, one SUCCEEDED payment, card ACTIVE", (await orderRows(card.greetingId)).join() === "PAID" && succeededPayments === 1 && (await state(card.greetingId)) === "ACTIVE/ACTIVE", results.map((r) => r.status).join());
    check("D2. Exactly one commission", (await ledger(card.greetingId)) === "COMMISSION_EARNED:300", await ledger(card.greetingId));
    const anomalies = (await runPaymentReconciliation(adminUserId, { apply: false })).anomalies.filter((a) => a.orderId === p.orderId);
    check("D3. Reconciliation sees no anomaly for it afterwards", anomalies.length === 0, JSON.stringify(anomalies));
  }

  console.log("\n--- E. Failed / expired / cancelled at the bank ---");
  {
    const card = await newCard();
    pilot(card.qrId);
    const p = await payStarted(card);
    reject(p.bogId); // BOG: rejected (declined, cancelled on BOG's page, or the 30-min order TTL ran out)
    const r = await getOrCreateCheckoutOrder(card.greetingId, card.editToken);
    check("E1. Revisit after a rejected attempt: no wait, a fresh order is offered", !r.awaitingProvider && !r.recovered && r.summary.status === "PENDING_PAYMENT" && (await orderRows(card.greetingId)).join() === "FAILED,PENDING_PAYMENT");
    check("E2. Card stays DRAFT/inactive, no commission", (await state(card.greetingId)).startsWith("DRAFT/") && (await ledger(card.greetingId)) === "");
    const again = await attempt(() => acceptCheckoutTerms(card.greetingId, card.editToken, "ka"));
    check("E3. A new bank payment can be started for the new order", again.ok && again.value.redirectUrl?.startsWith("https://payment.bog.ge/") === true, again.ok ? "" : again.error);
  }
  {
    // Wrong amount at the bank: never activates.
    const card = await newCard();
    pilot(card.qrId);
    const p = await payStarted(card);
    bog.transferOverride.set(p.bogId, 1);
    complete(p.bogId);
    const cb = await callback(p.bogId);
    check("E4. Bank reports 0.01 GEL for a 10.00 order → not PAID, card not active, no commission", (await orderRows(card.greetingId)).join() !== "PAID" && !(await state(card.greetingId)).startsWith("ACTIVE") && (await ledger(card.greetingId)) === "", `${cb.status} ${await orderRows(card.greetingId)} ${await state(card.greetingId)}`);
    bog.transferOverride.delete(p.bogId);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  await admin.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Suite aborted:", err);
  console.log(`\n${passed} passed, ${failed + 1} failed`);
  server.close();
  await admin.end().catch(() => {});
  process.exit(1);
});

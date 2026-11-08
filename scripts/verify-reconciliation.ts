import Module from "node:module";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sign } from "node:crypto";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { bog, server, privateKey, complete, reject, settleRefund } = require("./lib-bog-simulator") as typeof import("./lib-bog-simulator");

/**
 * Payment reconciliation, database-backed. The real BOG adapter, webhook
 * handler, reconciliation and alerting run against a local database and the
 * BOG simulator: success, failure, timeout, retry, duplicate and refund, plus
 * detection of every paid-but-not-live state and alert sanitization.
 */
const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!migrationsUrl) throw new Error("MIGRATIONS_DATABASE_URL is required");
if (!/127\.0\.0\.1|localhost/.test(migrationsUrl)) throw new Error("verify:reconciliation runs against a local database only");
const pg = postgres(migrationsUrl, { max: 1 });

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

const SECRET_MESSAGE = "PRIVATE-GREETING-TEXT-must-never-appear";
const received: string[] = [];
let alertStatus = 200;
const alertSink: Server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  received.push(Buffer.concat(chunks).toString("utf8"));
  res.writeHead(alertStatus).end();
});

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => alertSink.listen(0, "127.0.0.1", r));
  const { publicKey } = require("./lib-bog-simulator") as typeof import("./lib-bog-simulator");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  Object.assign(process.env, {
    PAYMENTS_PROVIDER: "BOG",
    BOG_CLIENT_ID: "qa-client",
    BOG_CLIENT_SECRET: "qa-secret",
    BOG_API_BASE_URL: base,
    BOG_OAUTH_TOKEN_URL: `${base}/token`,
    BOG_WEBHOOK_SIGNING_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    CHECKOUT_ENABLED: "true",
    BOG_REFUNDS_ENABLED: "true",
  });
  delete process.env.ALLOW_TEST_PAYMENTS;
  delete process.env.VERCEL;

  const { env } = require("../src/lib/env") as typeof import("../src/lib/env");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutableEnv = env as any;
  const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
  const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
  const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
  const { getOrCreateCheckoutOrder } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
  const { refundPaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
  const { handleProviderWebhook } = require("../src/lib/payments/webhook") as typeof import("../src/lib/payments/webhook");
  const { runPaymentReconciliation, ReconcileIdentityError } = require("../src/lib/payments/reconcile") as typeof import("../src/lib/payments/reconcile");
  const { buildReconcileAlert, formatAlertText } = require("../src/lib/payments/reconcile-alerts") as typeof import("../src/lib/payments/reconcile-alerts");
  const { GET: cronRoute } = require("../src/app/api/cron/payments-reconcile/route") as typeof import("../src/app/api/cron/payments-reconcile/route");

  const adminUserId = crypto.randomUUID();
  await pg`insert into admin_users (user_id) values (${adminUserId})`;
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const [product] = await pg`select id from products where key = 'PREMIUM_GREETING'`;
  await pg`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"rec-" + partnerId.slice(0, 8)}, 'Reconcile Partner', 3000, 'ACTIVE')`;
  await pg`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'reconcile', 50)`;
  await pg`insert into prices (product_id, partner_id, currency, amount_minor, active) values (${product!.id}, ${partnerId}, 'GEL', 1000, true)`;

  async function newOrder() {
    const qrId = crypto.randomUUID();
    const token = generatePublicToken();
    await pg`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    await updateGreetingMessage(greetingId, editToken, SECRET_MESSAGE);
    const { summary } = await getOrCreateCheckoutOrder(greetingId, editToken);
    const [pay] = await pg`select id, provider_payment_id from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    return { qrId, token, greetingId, editToken, orderId: summary.orderId, paymentId: pay!.id as string, bogId: pay!.provider_payment_id as string };
  }
  type O = Awaited<ReturnType<typeof newOrder>>;

  const callbackRaw = (bogId: string) => JSON.stringify({ event: "order_payment", zoned_request_time: new Date().toISOString(), body: { order_id: bogId } });
  const callback = (bogId: string) => {
    const raw = callbackRaw(bogId);
    return handleProviderWebhook("BOG", raw, new Headers({ "Callback-Signature": sign("sha256", Buffer.from(raw, "utf8"), privateKey).toString("base64") }));
  };
  const makeStale = (o: O) => pg`update payments set created_at = now() - interval '1 hour' where id = ${o.paymentId}`;
  const state = async (o: O) => {
    const [row] = await pg`
      select ord.status as order_status, g.status as greeting_status, q.status as qr_status,
             (select count(*)::int from partner_ledger_entries l where l.order_id = ord.id and l.type = 'COMMISSION_EARNED') as earned,
             (select count(*)::int from partner_ledger_entries l where l.order_id = ord.id and l.type = 'COMMISSION_REVERSAL') as reversed
        from orders ord join greetings g on g.id = ord.greeting_id join qr_codes q on q.id = ord.qr_code_id where ord.id = ${o.orderId}`;
    return row as unknown as { order_status: string; greeting_status: string; qr_status: string; earned: number; reversed: number };
  };
  const activated = async (o: O) => {
    const s = await state(o);
    return s.order_status === "PAID" && s.greeting_status === "ACTIVE" && s.qr_status === "ACTIVE" && s.earned === 1;
  };
  const run = (apply = true) => runPaymentReconciliation(adminUserId, { apply });
  const kindsFor = (r: Awaited<ReturnType<typeof run>>["remaining"], id: string) => r.filter((a) => a.orderId === id).map((a) => a.kind);
  /** Bypasses triggers: damage only a bug or manual SQL could cause. */
  const force = async (fn: (tx: typeof pg) => Promise<unknown>) =>
    pg.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await fn(tx as unknown as typeof pg);
    });

  console.log("\n--- 1. Success ---");
  const paid = await newOrder();
  complete(paid.bogId);
  check("1a. signed success callback → 200", (await callback(paid.bogId)).status === 200);
  check("1b. PAID, greeting and QR ACTIVE, one commission", await activated(paid), await state(paid));
  check("1c. a settled order is not an anomaly", kindsFor((await run(false)).remaining, paid.orderId).length === 0);

  console.log("\n--- 2. Duplicate webhooks and repeated runs ---");
  const repeats = await Promise.all(Array.from({ length: 6 }, () => callback(paid.bogId)));
  check("2a. six concurrent duplicates all answer 200", repeats.every((r) => r.status === 200));
  check("2b. …still exactly one commission", (await state(paid)).earned === 1);
  const raced = await newOrder();
  complete(raced.bogId);
  await makeStale(raced);
  const [, racedRuns] = await Promise.all([callback(raced.bogId), Promise.all([run(), run(), run()])]);
  check("2c. webhook racing three reconcile runs activates once", (await activated(raced)) && racedRuns.length === 3, await state(raced));
  const [{ n: paidEvents }] = await pg`select count(*)::int as n from analytics_events where metadata->>'orderId' = ${raced.orderId} and event_type = 'PAYMENT_SUCCEEDED'` as unknown as [{ n: number }];
  check("2d. one PAYMENT_SUCCEEDED analytics event", paidEvents === 1, paidEvents);
  await run();
  await run();
  check("2e. two more runs change nothing", (await activated(raced)) && (await state(raced)).earned === 1);

  console.log("\n--- 3. Failure ---");
  const declined = await newOrder();
  reject(declined.bogId);
  await callback(declined.bogId);
  const ds = await state(declined);
  check("3a. rejected: order FAILED, no commission, greeting and QR not live", ds.order_status === "FAILED" && ds.earned === 0 && ds.greeting_status === "DRAFT" && ds.qr_status !== "ACTIVE", ds);
  check("3b. nothing reported for it", kindsFor((await run(false)).remaining, declined.orderId).length === 0);

  console.log("\n--- 4. Missed webhook, timeout and retry ---");
  const missed = await newOrder();
  await makeStale(missed);
  check("4a. still at the bank → stale, untouched", kindsFor((await run()).remaining, missed.orderId).join() === "STALE_PENDING" && (await state(missed)).order_status === "PENDING_PAYMENT");
  complete(missed.bogId);
  bog.receiptFailure = "drop";
  const timedOut = await run();
  const timeoutAction = timedOut.actions.find((a) => a.orderId === missed.orderId);
  check("4b. bank connection cut: repair recorded as failed, order untouched", timeoutAction?.ok === false && (await state(missed)).order_status === "PENDING_PAYMENT", timeoutAction);
  bog.receiptFailure = "503";
  const outage = await run();
  check("4c. bank 503: same", outage.actions.find((a) => a.orderId === missed.orderId)?.ok === false && (await state(missed)).order_status === "PENDING_PAYMENT");
  bog.receiptFailure = null;
  const retried = await run();
  check("4d. retry after recovery: PAID and live, once", retried.actions.find((a) => a.orderId === missed.orderId)?.ok === true && (await activated(missed)), await state(missed));
  check("4e. …and no longer listed", kindsFor(retried.remaining, missed.orderId).length === 0);
  const expired = await newOrder();
  await makeStale(expired);
  reject(expired.bogId);
  await run();
  check("4f. a stale attempt the bank declined closes as FAILED", (await state(expired)).order_status === "FAILED");

  console.log("\n--- 5. Paid but not activated ---");
  const stuck = await newOrder();
  complete(stuck.bogId);
  await callback(stuck.bogId);
  await force((tx) => tx`update greetings set status = 'DRAFT', activated_at = null where id = ${stuck.greetingId}`.then(() => tx`update qr_codes set status = 'DRAFT', activated_at = null where id = ${stuck.qrId}`));
  check("5a. PAID + DRAFT greeting detected", kindsFor((await run(false)).remaining, stuck.orderId).includes("PAID_NOT_ACTIVATED"));
  await run();
  check("5b. repaired: live, still one commission", await activated(stuck), await state(stuck));
  const halfway = await newOrder();
  complete(halfway.bogId);
  await callback(halfway.bogId);
  await force((tx) => tx`update qr_codes set status = 'DRAFT', activated_at = null where id = ${halfway.qrId}`);
  check("5c. PAID + ACTIVE greeting + DRAFT QR detected (previously invisible)", kindsFor((await run(false)).remaining, halfway.orderId).includes("PAID_QR_NOT_ACTIVATED"));
  await run();
  check("5d. repaired", (await state(halfway)).qr_status === "ACTIVE");
  const available = await newOrder();
  complete(available.bogId);
  await callback(available.bogId);
  await force((tx) => tx`update qr_codes set status = 'AVAILABLE', activated_at = null where id = ${available.qrId}`);
  const afterAvailable = await run();
  check("5e. an AVAILABLE QR stays reported for a person (never forced ACTIVE)", kindsFor(afterAvailable.remaining, available.orderId).includes("PAID_QR_NOT_ACTIVATED") && (await state(available)).qr_status === "AVAILABLE");
  await force((tx) => tx`update qr_codes set status = 'ACTIVE' where id = ${available.qrId}`);

  console.log("\n--- 6. Status and reference mismatches ---");
  const noRef = await newOrder();
  await force((tx) => tx`update payments set provider_payment_id = null where id = ${noRef.paymentId}`);
  check("6a. pending charge without a provider reference", kindsFor((await run(false)).remaining, noRef.orderId).includes("MISSING_PROVIDER_REFERENCE"));
  await force((tx) => tx`update orders set status = 'CANCELED' where id = ${noRef.orderId}`.then(() => tx`update payments set status = 'FAILED' where id = ${noRef.paymentId}`));
  const noAttempt = await newOrder();
  await pg`delete from payments where id = ${noAttempt.paymentId}`;
  await force((tx) => tx`update orders set created_at = now() - interval '1 hour' where id = ${noAttempt.orderId}`);
  check("6b. old pending order with no attempt at all", kindsFor((await run(false)).remaining, noAttempt.orderId).includes("MISSING_PROVIDER_REFERENCE"));
  await force((tx) => tx`update orders set status = 'CANCELED' where id = ${noAttempt.orderId}`);
  const m1 = await newOrder();
  complete(m1.bogId);
  await callback(m1.bogId);
  await force((tx) => tx`update payments set status = 'REFUNDED' where id = ${m1.paymentId}`);
  check("6c. PAID order whose only charge is REFUNDED", kindsFor((await run(false)).remaining, m1.orderId).includes("STATUS_MISMATCH"));
  await force((tx) => tx`update payments set status = 'SUCCEEDED' where id = ${m1.paymentId}`);
  await force((tx) => tx`update orders set status = 'REFUNDED' where id = ${m1.orderId}`);
  check("6d. REFUNDED order with no refunded charge", kindsFor((await run(false)).remaining, m1.orderId).includes("STATUS_MISMATCH"));
  await force((tx) => tx`update orders set status = 'PAID' where id = ${m1.orderId}`.then(() => tx`update payments set confirmed_at = null where id = ${m1.paymentId}`));
  check("6e. SUCCEEDED charge with no confirmation time", kindsFor((await run(false)).remaining, m1.orderId).includes("STATUS_MISMATCH"));
  await force((tx) => tx`update payments set confirmed_at = now() where id = ${m1.paymentId}`);
  const ghost = await newOrder();
  await force((tx) => tx`update greetings set status = 'ACTIVE', activated_at = now() where id = ${ghost.greetingId}`.then(() => tx`update orders set status = 'CANCELED' where id = ${ghost.orderId}`));
  check("6f. live greeting no captured order explains", kindsFor((await run(false)).remaining, ghost.greetingId).includes("ACTIVE_WITHOUT_PAYMENT"));
  await force((tx) => tx`update greetings set status = 'DRAFT', activated_at = null where id = ${ghost.greetingId}`);
  check("6g. a legitimately paid greeting is not flagged", !kindsFor((await run(false)).remaining, paid.greetingId).includes("ACTIVE_WITHOUT_PAYMENT"));

  console.log("\n--- 7. Refunds ---");
  const refunded = await newOrder();
  complete(refunded.bogId);
  await callback(refunded.bogId);
  await refundPaidOrder(adminUserId, refunded.orderId);
  const inFlight = await state(refunded);
  check("7a. requested: still PAID, no reversal yet", inFlight.order_status === "PAID" && inFlight.reversed === 0, inFlight);
  await force((tx) => tx`update payment_refunds set requested_at = now() - interval '2 hours' where order_id = ${refunded.orderId}`);
  check("7b. unconfirmed refund is reported", kindsFor((await run(false)).remaining, refunded.orderId).includes("REFUND_AWAITING_PROVIDER"));
  settleRefund(refunded.bogId, "completed");
  await run();
  const doneRefund = await state(refunded);
  check("7c. reconciliation completes it once the bank confirms", doneRefund.order_status === "REFUNDED" && doneRefund.reversed === 1, doneRefund);
  await run();
  await callback(refunded.bogId);
  check("7d. repeated runs and callbacks reverse commission once", (await state(refunded)).reversed === 1);
  const refundCalls = bog.calls.filter((c) => c.path === `/payment/refund/${refunded.bogId}`).length;
  check("7e. the bank was asked to refund it exactly once", refundCalls === 1, refundCalls);

  console.log("\n--- 8. A reconcile identity that isn't an admin ---");
  const stranger = await runPaymentReconciliation(crypto.randomUUID(), { apply: true }).catch((e: unknown) => e);
  check("8a. refused, not a falsely clean report", stranger instanceof ReconcileIdentityError, stranger);

  console.log("\n--- 9. Alert content ---");
  const report = await run(false);
  const alert = buildReconcileAlert({ ...report, actions: [{ orderId: paid.orderId, kind: "STALE_PENDING", ok: false, outcome: `not repaired — ${paid.bogId} ${SECRET_MESSAGE}` }] });
  const payload = JSON.stringify({ text: formatAlertText(alert), alert });
  const tokens = (await pg`select public_token from qr_codes where batch_id = ${batchId}`).map((r) => r.public_token as string);
  const forbidden = [SECRET_MESSAGE, paid.editToken, paid.bogId, "qa-secret", "548888", ...tokens];
  const leaks = forbidden.filter((f) => payload.includes(f));
  check("9a. no greeting text, QR/edit tokens, provider ids, card data or secrets", leaks.length === 0, leaks);
  check("9b. refs are shortened ids, capped", alert.refs.every((r) => r.length === 8) && alert.refs.length <= 20);
  check("9c. only anomaly kinds, counts and refs leave the system", Object.keys(alert).sort().join() === "actionable,byKind,fingerprint,refs,repairs,severity,total");
  const onlyStale = buildReconcileAlert({ anomalies: [], actions: [], remaining: [{ kind: "STALE_PENDING", orderId: paid.orderId, detail: "x" }] });
  check("9d. an abandoned checkout alone does not page anyone", !onlyStale.actionable && onlyStale.severity === "info");

  console.log("\n--- 10. Scheduled endpoint and delivery ---");
  const cron = async (auth?: string) => {
    const r = await cronRoute(new Request("http://localhost/api/cron/payments-reconcile", { headers: auth ? { Authorization: auth } : {} }));
    return { status: r.status, body: r.status === 200 ? ((await r.json()) as Record<string, number | boolean>) : null };
  };
  check("10a. not configured → 404", (await cron("Bearer x")).status === 404);
  const secret = "reconciliation-suite-cron-secret-value";
  mutableEnv.CRON_SECRET = secret;
  mutableEnv.RECONCILE_ADMIN_USER_ID = crypto.randomUUID();
  check("10b. wrong secret → 401", (await cron(`Bearer ${secret}x`)).status === 401);
  check("10c. non-admin identity → 500 (the scheduler sees a failure)", (await cron(`Bearer ${secret}`)).status === 500);
  mutableEnv.RECONCILE_ADMIN_USER_ID = adminUserId;
  mutableEnv.PAYMENT_ALERT_WEBHOOK_URL = `http://127.0.0.1:${(alertSink.address() as AddressInfo).port}/hook`;
  await pg`delete from audit_logs where action = 'PAYMENT_RECONCILE_ALERT'`;

  const open = await newOrder();
  complete(open.bogId);
  await callback(open.bogId);
  await force((tx) => tx`update payments set status = 'REFUNDED' where id = ${open.paymentId}`);
  const first = await cron(`Bearer ${secret}`);
  check("10d. first run alerts", first.status === 200 && first.body?.alerted === true && received.length === 1, first);
  check("10e. delivered payload is sanitized", ![SECRET_MESSAGE, open.editToken, open.bogId, open.token].some((f) => received[0]!.includes(f)));
  const second = await cron(`Bearer ${secret}`);
  check("10f. the same open set is not re-sent", second.body?.alerted === false && received.length === 1, second);
  const newlyBroken = await newOrder();
  complete(newlyBroken.bogId);
  await callback(newlyBroken.bogId);
  await force((tx) => tx`update payments set status = 'REFUNDED' where id = ${newlyBroken.paymentId}`);
  const third = await cron(`Bearer ${secret}`);
  check("10g. a new problem alerts again", third.body?.alerted === true && received.length === 2, third);
  alertStatus = 500;
  const brokenChannel = await newOrder();
  complete(brokenChannel.bogId);
  await callback(brokenChannel.bogId);
  await force((tx) => tx`update payments set status = 'REFUNDED' where id = ${brokenChannel.paymentId}`);
  const fourth = await cron(`Bearer ${secret}`);
  check("10h. a broken alert channel doesn't fail the run", fourth.status === 200 && fourth.body?.alerted === false, fourth);
  alertStatus = 200;
  const fifth = await cron(`Bearer ${secret}`);
  check("10i. an undelivered alert is retried next run", fifth.body?.alerted === true, fifth);
  for (const o of [open, newlyBroken, brokenChannel]) await force((tx) => tx`update payments set status = 'SUCCEEDED' where id = ${o.paymentId}`);
  const { dispatchReconcileAlert } = require("../src/lib/payments/reconcile-alerts") as typeof import("../src/lib/payments/reconcile-alerts");
  const before = received.length;
  check("10j. nothing actionable: no alert", (await dispatchReconcileAlert(adminUserId, onlyStale)) === false && received.length === before);
}

main()
  .catch((err) => {
    failed++;
    console.error("Suite aborted:", err);
  })
  .finally(async () => {
    server.close();
    alertSink.close();
    await pg.end();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });

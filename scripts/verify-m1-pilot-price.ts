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
 * M1 pilot at 1.00 GEL (CHECKOUT_PILOT_PRICE_MINOR=100), against the local
 * database and the BOG simulator (scripts/lib-bog-simulator.ts). Production
 * settings otherwise: PAYMENTS_PROVIDER=BOG, CHECKOUT_ENABLED=false,
 * BOG_REFUNDS_ENABLED=false, platform default price 10.00 GEL, 30% partner.
 *
 *  P. Configuration is validated at startup (fail closed).
 *  Q. One amount everywhere: display, order snapshot (100/30/70), checkout
 *     summary, BOG create body, payments row, receipt check, ledger.
 *  R. Isolation: no other card, no public price, no prices row changes; no
 *     browser-controlled input; withdrawing the override stops a 1.00 order.
 *  S. Idempotency, duplicate payments, callbacks, amount mismatch.
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

const sim = require("./lib-bog-simulator") as typeof import("./lib-bog-simulator");
const { bog, server, privateKey, forger, complete, reject } = sim;

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const placeholder = "00000000-0000-4000-8000-000000000000";
  const ENV_PROBE = "const M=require('node:module');const l=M._load;M._load=function(r,...a){return r==='server-only'?{}:l.call(this,r,...a)};require('./src/lib/env')";

  Object.assign(process.env, {
    PAYMENTS_PROVIDER: "BOG",
    BOG_CLIENT_ID: "qa-client",
    BOG_CLIENT_SECRET: "qa-secret",
    BOG_API_BASE_URL: base,
    BOG_OAUTH_TOKEN_URL: `${base}/token`,
    BOG_WEBHOOK_SIGNING_KEY: sim.publicKey.export({ type: "spki", format: "pem" }).toString(),
    CHECKOUT_ENABLED: "false",
    CHECKOUT_PILOT_QR_IDS: placeholder,
    CHECKOUT_PILOT_PRICE_MINOR: "100",
    BOG_REFUNDS_ENABLED: "false",
    LEGAL_EFFECTIVE_DATE: "2026-01-01",
  });
  // The real policy copy still carries lawyer/owner notes, so the legal-readiness
  // gate keeps real checkout closed; these suites test the money path, so they
  // use the same copy with the notes removed (refused in production).
  {
    const L = require("../src/lib/site/legal-readiness") as typeof import("../src/lib/site/legal-readiness");
    L.setLegalCopyForTesting(L.finalizedCopyForTesting());
    // …and every merchant detail the policies name (test values, never real ones).
    const merchantTest: Record<string, string> = {
      MERCHANT_LEGAL_NAME_KA: "ი/მ ტესტი", MERCHANT_LEGAL_NAME_EN: "IE Test", MERCHANT_ENTITY_TYPE: "IE",
      MERCHANT_ID_CODE: "01234567890", MERCHANT_PUBLISH_ID_CODE: "owner-approved",
      MERCHANT_LEGAL_ADDRESS_KA: "თბილისი, ტესტის ქ. 1", MERCHANT_LEGAL_ADDRESS_EN: "1 Test St, Tbilisi", MERCHANT_PUBLISH_LEGAL_ADDRESS: "owner-approved",
      MERCHANT_ACTUAL_ADDRESS_KA: "თბილისი, ტესტის ქ. 2", MERCHANT_ACTUAL_ADDRESS_EN: "2 Test St, Tbilisi",
      MERCHANT_SUPPORT_EMAIL: "support@verify.test", MERCHANT_PHONE: "+995555000000",
      MERCHANT_SUPPORT_HOURS_KA: "ორშ–პარ, 10:00–18:00", MERCHANT_SUPPORT_HOURS_EN: "Mon–Fri, 10:00–18:00",
    };
    for (const [k, v] of Object.entries(merchantTest)) process.env[k] ??= v;
  }
  delete process.env.MERCHANT_PROFILE;
  delete process.env.ALLOW_TEST_PAYMENTS;
  delete process.env.VERCEL;

  console.log("\n--- P. Configuration (startup validation) ---");
  {
    const probe = (vars: Record<string, string>) => {
      try {
        execFileSync(process.execPath, ["./node_modules/.bin/tsx", "-e", ENV_PROBE], { env: { ...process.env, ...vars }, stdio: "pipe" });
        return "accepted";
      } catch (e) {
        return String((e as { stderr?: Buffer }).stderr ?? "").includes("CHECKOUT_PILOT_PRICE_MINOR") ? "rejected" : "other-error";
      }
    };
    const one = crypto.randomUUID();
    check("P1. 100 tetri + exactly one pilot card + checkout closed: accepted", probe({ CHECKOUT_PILOT_PRICE_MINOR: "100", CHECKOUT_PILOT_QR_IDS: one }) === "accepted");
    for (const bad of ["99", "0", "1.00", "1", "-100", "abc", "100000001", " 1e2"]) {
      check(`P2. Rejected value ${JSON.stringify(bad)}`, probe({ CHECKOUT_PILOT_PRICE_MINOR: bad, CHECKOUT_PILOT_QR_IDS: one }) === "rejected");
    }
    check("P3. Rejected without a pilot card", probe({ CHECKOUT_PILOT_PRICE_MINOR: "100", CHECKOUT_PILOT_QR_IDS: "" }) === "rejected");
    check("P4. Rejected with two pilot cards", probe({ CHECKOUT_PILOT_PRICE_MINOR: "100", CHECKOUT_PILOT_QR_IDS: `${one},${crypto.randomUUID()}` }) === "rejected");
    check("P5. Rejected together with CHECKOUT_ENABLED=true", probe({ CHECKOUT_PILOT_PRICE_MINOR: "100", CHECKOUT_PILOT_QR_IDS: one, CHECKOUT_ENABLED: "true" }) === "rejected");
    check("P6. Unset / empty is accepted (no override)", probe({ CHECKOUT_PILOT_PRICE_MINOR: "", CHECKOUT_PILOT_QR_IDS: "" }) === "accepted");
  }

  const { env } = require("../src/lib/env") as typeof import("../src/lib/env");
  const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
  const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
  const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
  const { getOrCreateCheckoutOrder, acceptCheckoutTerms, checkPaymentReturn } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
  const { startCheckout } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
  const { pilotPriceOverrideMinor } = require("../src/lib/payments/pilot-price") as typeof import("../src/lib/payments/pilot-price");
  const { getDefaultProductPrice } = require("../src/lib/payments/display-price") as typeof import("../src/lib/payments/display-price");
  const { handleProviderWebhook } = require("../src/lib/payments/webhook") as typeof import("../src/lib/payments/webhook");
  const { runPaymentReconciliation } = require("../src/lib/payments/reconcile") as typeof import("../src/lib/payments/reconcile");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutableEnv = env as any;

  console.log("\nSetting up fixtures (superuser)...");
  const adminUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING'`;
  const [defaultPrice] = await admin`select id, amount_minor from prices where product_id = ${product!.id} and partner_id is null and active`;
  // Like demo-flowers in production: 30%, no partner price → platform default 10.00 GEL.
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"p1g-" + partnerId.slice(0, 8)}, 'Pilot 1 GEL Partner', 3000, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'pilot-1gel', 50)`;
  const pricesFingerprint = async () => (await admin`select md5(string_agg(id::text || amount_minor || active || coalesce(partner_id::text,'-'), ',' order by id)) as h, count(*)::int as n from prices`)[0]!;
  const pricesBefore = await pricesFingerprint();

  async function newCard() {
    const qrId = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    await updateGreetingMessage(greetingId, editToken, "M1 pilot 1 GEL test message");
    return { qrId, token, greetingId, editToken };
  }
  const setPilot = (qrId: string | null, price: number | null) => {
    mutableEnv.CHECKOUT_PILOT_QR_IDS = qrId ? [qrId.toLowerCase()] : [];
    mutableEnv.CHECKOUT_PILOT_PRICE_MINOR = price;
  };
  const bogCreates = () => bog.calls.filter((c) => c.path === "/ecommerce/orders");
  const lastCreate = () => bogCreates().at(-1)?.body as { external_order_id: string; purchase_units: { total_amount: number; currency: string; basket: { unit_price: number; quantity: number }[] } } | undefined;
  const ordersOf = async (greetingId: string) =>
    admin`select id, status, gross_amount_minor, partner_commission_minor, platform_share_minor, commission_rate_bps, price_id, currency from orders where greeting_id = ${greetingId} order by created_at`;
  const paymentsOf = async (greetingId: string) =>
    admin`select p.status, p.amount_minor, p.currency, p.provider_payment_id from payments p join orders o on o.id = p.order_id where o.greeting_id = ${greetingId} order by p.created_at`;
  const ledgerOf = async (greetingId: string) =>
    (await admin`select l.type, l.amount_minor from partner_ledger_entries l join orders o on o.id = l.order_id where o.greeting_id = ${greetingId} order by l.created_at`).map((r) => `${r.type}:${r.amount_minor}`).join(",");
  const state = async (greetingId: string) => {
    const [r] = await admin`select g.status as g, q.status as q from greetings g join qr_codes q on q.id = g.qr_code_id where g.id = ${greetingId}`;
    return `${r!.g}/${r!.q}`;
  };
  const callback = (bogId: string, key = privateKey) => {
    const raw = JSON.stringify({ event: "order_payment", zoned_request_time: new Date().toISOString(), body: { order_id: bogId } });
    return handleProviderWebhook("BOG", raw, new Headers({ "Callback-Signature": sign("sha256", Buffer.from(raw, "utf8"), key).toString("base64") }));
  };
  async function payStarted(card: Awaited<ReturnType<typeof newCard>>) {
    const { summary } = await getOrCreateCheckoutOrder(card.greetingId, card.editToken);
    const { redirectUrl } = await acceptCheckoutTerms(card.greetingId, card.editToken, "ka");
    const [pay] = await admin`select provider_payment_id from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    return { summary, orderId: summary.orderId, bogId: pay!.provider_payment_id as string, redirectUrl };
  }

  console.log("\n--- Q. One amount everywhere: 1.00 GEL = 100 tetri (30 / 70) ---");
  const pilotCard = await newCard();
  const otherCard = await newCard();
  setPilot(pilotCard.qrId, 100);
  {
    check("Q0. Platform default price is 10.00 GEL (as in production)", defaultPrice!.amount_minor === 1000);
    check("Q1. Override applies to the pilot card only", pilotPriceOverrideMinor(pilotCard.qrId) === 100 && pilotPriceOverrideMinor(pilotCard.qrId.toUpperCase()) === 100 && pilotPriceOverrideMinor(otherCard.qrId) === null && pilotPriceOverrideMinor(undefined) === null);
    const dPilot = await getDefaultProductPrice(partnerId, pilotCard.qrId);
    const dOther = await getDefaultProductPrice(partnerId, otherCard.qrId);
    const dNone = await getDefaultProductPrice(partnerId);
    check("Q2. Display: pilot card 1.00 GEL; other card and partner price 10.00 GEL", dPilot?.amountMinor === 100 && dPilot.currency === "GEL" && dOther?.amountMinor === 1000 && dNone?.amountMinor === 1000, JSON.stringify([dPilot, dOther, dNone]));

    const creates = bogCreates().length;
    const p = await payStarted(pilotCard);
    check("Q3. Checkout summary (what the UI shows) is 100 GEL-tetri", p.summary.grossAmountMinor === 100 && p.summary.currency === "GEL");
    const [o] = await ordersOf(pilotCard.greetingId);
    check(
      "Q4. Order snapshot: gross 100, partner 30, platform 70, rate 3000, GEL",
      o!.gross_amount_minor === 100 && o!.partner_commission_minor === 30 && o!.platform_share_minor === 70 && o!.commission_rate_bps === 3000 && o!.currency === "GEL",
      JSON.stringify(o),
    );
    check("Q5. Order is marked as not priced by a prices row (price_id null)", o!.price_id === null);
    const [audit] = await admin`select metadata from audit_logs where action = 'PRICING_PILOT_PRICE_APPLIED' and target_id = ${o!.id}`;
    const m = audit?.metadata as Record<string, unknown> | undefined;
    check("Q6. Audit row PRICING_PILOT_PRICE_APPLIED (100, standard 1000, standard price id)", m?.grossAmountMinor === 100 && m?.standardAmountMinor === 1000 && m?.standardPriceId === defaultPrice!.id && m?.qrCodeId === pilotCard.qrId, JSON.stringify(m));
    const body = lastCreate();
    check("Q7. Exactly one BOG order created", bogCreates().length === creates + 1);
    check(
      "Q8. BOG create body: total_amount 1, unit_price 1 × 1, GEL, external_order_id = order",
      body?.purchase_units.total_amount === 1 && body.purchase_units.currency === "GEL" && body.purchase_units.basket.length === 1 && body.purchase_units.basket[0]!.unit_price === 1 && body.purchase_units.basket[0]!.quantity === 1 && body.external_order_id === o!.id,
      JSON.stringify(body?.purchase_units),
    );
    const [pay] = await paymentsOf(pilotCard.greetingId);
    check("Q9. Payment row PENDING 100 GEL", pay!.status === "PENDING" && pay!.amount_minor === 100 && pay!.currency === "GEL");

    complete(p.bogId);
    const cb = await callback(p.bogId);
    check("Q10. Signed callback → 200, order PAID, card ACTIVE", cb.status === 200 && (await ordersOf(pilotCard.greetingId))[0]!.status === "PAID" && (await state(pilotCard.greetingId)) === "ACTIVE/ACTIVE", `${cb.status} ${await state(pilotCard.greetingId)}`);
    const pays = await paymentsOf(pilotCard.greetingId);
    check("Q11. One payment SUCCEEDED, 100", pays.length === 1 && pays[0]!.status === "SUCCEEDED" && pays[0]!.amount_minor === 100);
    check("Q12. Ledger: exactly one COMMISSION_EARNED of 30 (0.30 GEL)", (await ledgerOf(pilotCard.greetingId)) === "COMMISSION_EARNED:30");

    console.log("  -- duplicates after success --");
    const results = await Promise.all([callback(p.bogId), callback(p.bogId), callback(p.bogId)]);
    const ret = await checkPaymentReturn(pilotCard.greetingId, pilotCard.editToken);
    const revisit = await attempt(() => getOrCreateCheckoutOrder(pilotCard.greetingId, pilotCard.editToken));
    check("S1. 3 replayed callbacks + return check + revisit (edit link closed once ACTIVE): no second payment/commission", results.every((r) => r.status === 200) && ret.status === "PAID" && !revisit.ok && revisit.name === "InvalidEditTokenError" && (await paymentsOf(pilotCard.greetingId)).length === 1 && (await ledgerOf(pilotCard.greetingId)) === "COMMISSION_EARNED:30" && (await ordersOf(pilotCard.greetingId)).length === 1);
    const t = await attempt(() => acceptCheckoutTerms(pilotCard.greetingId, pilotCard.editToken, "ka"));
    check("S2. Pay again on a PAID card is refused, no new BOG order", !t.ok && bogCreates().length === creates + 1);
    const run = await runPaymentReconciliation(adminUserId, { apply: true });
    check("S3. Reconciliation: no anomaly, no action for the 1.00 order", !run.anomalies.some((a) => a.orderId === o!.id) && !run.actions.some((a) => a.orderId === o!.id), JSON.stringify(run.anomalies.filter((a) => a.orderId === o!.id)));
    setPilot(null, null);
    const runAfter = await runPaymentReconciliation(adminUserId, { apply: true });
    check("S4. …still clean after the override is withdrawn (a paid 1.00 order is final)", !runAfter.anomalies.some((a) => a.orderId === o!.id) && (await ledgerOf(pilotCard.greetingId)) === "COMMISSION_EARNED:30");
  }

  console.log("\n--- R. Isolation and manipulation ---");
  {
    setPilot(pilotCard.qrId, 100);
    const r = await attempt(() => getOrCreateCheckoutOrder(otherCard.greetingId, otherCard.editToken));
    check("R1. Another card (same partner) stays closed: no order, no BOG call", !r.ok && r.name === "CheckoutUnavailableError" && (await ordersOf(otherCard.greetingId)).length === 0);

    // The browser can only name its greeting; the price inputs are not parameters.
    const forged = await newCard();
    setPilot(forged.qrId, null); // pilot-gated so an order can be opened, no price override
    const f = await attempt(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      startCheckout({ greetingId: forged.greetingId, editToken: forged.editToken, productId: product!.id, createAttempt: false, amountMinor: 100, grossAmountMinor: 100, qrCodeId: pilotCard.qrId, priceMinor: 100 } as any),
    );
    check("R2. Injected amount/qrCodeId fields are ignored: order at 10.00 GEL", f.ok && f.value.order.grossAmountMinor === 1000 && f.value.order.partnerCommissionMinor === 300 && f.value.order.priceId === defaultPrice!.id, f.ok ? JSON.stringify(f.value.order.grossAmountMinor) : f.error);
    const actionsSrc = require("node:fs").readFileSync("src/lib/payments/actions.ts", "utf8") as string;
    check("R3. Server actions take no amount/price/qr input (static check)", !/Action\([^)]*(amount|price|qrCode)/i.test(actionsSrc));

    // A card with a 10.00 order opened BEFORE it became the 1.00 pilot: refused, not silently re-priced.
    setPilot(forged.qrId, 100);
    const before = bogCreates().length;
    const x = await attempt(() => acceptCheckoutTerms(forged.greetingId, forged.editToken, "ka"));
    check("R4. 10.00 order on a card later priced 1.00 → refused (PilotPriceMismatchError), no BOG call", !x.ok && x.name === "PilotPriceMismatchError" && bogCreates().length === before, x.ok ? "accepted" : x.name);

    // Override withdrawn while a 1.00 order is open (pilot card itself still listed).
    const card = await newCard();
    setPilot(card.qrId, 100);
    const { summary } = await getOrCreateCheckoutOrder(card.greetingId, card.editToken);
    check("R5. Open 1.00 order created", summary.grossAmountMinor === 100);
    setPilot(card.qrId, null);
    const b2 = bogCreates().length;
    const y = await attempt(() => acceptCheckoutTerms(card.greetingId, card.editToken, "ka"));
    check("R6. Override withdrawn → the open 1.00 order can no longer reach BOG", !y.ok && y.name === "PilotPriceMismatchError" && bogCreates().length === b2, y.ok ? "accepted" : y.name);
    // The pilot list moves to another card: the old 1.00 order is closed too.
    setPilot(otherCard.qrId, 100);
    const z = await attempt(() => acceptCheckoutTerms(card.greetingId, card.editToken, "ka"));
    check("R7. Pilot moved to another card → old card closed, no BOG call", !z.ok && z.name === "CheckoutUnavailableError" && bogCreates().length === b2);

    // Public checkout opened at runtime (startup validation forbids it; defense in depth).
    setPilot(card.qrId, 100);
    mutableEnv.CHECKOUT_ENABLED = true;
    check("R8. CHECKOUT_ENABLED=true → no override for anyone", pilotPriceOverrideMinor(card.qrId) === null && (await getDefaultProductPrice(partnerId, card.qrId))?.amountMinor === 1000);
    const w = await attempt(() => acceptCheckoutTerms(card.greetingId, card.editToken, "ka"));
    check("R9. …and the open 1.00 order is refused then too", !w.ok && w.name === "PilotPriceMismatchError" && bogCreates().length === b2);
    mutableEnv.CHECKOUT_ENABLED = false;

    process.env.LEGAL_EFFECTIVE_DATE = "";
    check("R10. No override while the policies are not in force", pilotPriceOverrideMinor(card.qrId) === null);
    process.env.LEGAL_EFFECTIVE_DATE = "2026-01-01";
    mutableEnv.PAYMENTS_PROVIDER = "TEST";
    check("R11. No override with the TEST provider in production builds", env.NODE_ENV !== "production" || pilotPriceOverrideMinor(card.qrId) === null);
    mutableEnv.PAYMENTS_PROVIDER = "BOG";

    const after = await pricesFingerprint();
    check("R12. prices table byte-for-byte unchanged (public price stays 10.00 GEL)", after.h === pricesBefore.h && after.n === pricesBefore.n);
  }

  console.log("\n--- S. Double tap, open attempts, forged callbacks, amount mismatch ---");
  {
    const card = await newCard();
    setPilot(card.qrId, 100);
    const taps = await Promise.allSettled([getOrCreateCheckoutOrder(card.greetingId, card.editToken), getOrCreateCheckoutOrder(card.greetingId, card.editToken), getOrCreateCheckoutOrder(card.greetingId, card.editToken)]);
    const ids = new Set(taps.filter((t) => t.status === "fulfilled").map((t) => (t as PromiseFulfilledResult<{ summary: { orderId: string } }>).value.summary.orderId));
    check("S5. Triple tap on checkout → one 1.00 order", ids.size === 1 && (await ordersOf(card.greetingId)).length === 1, taps.map((t) => t.status).join());

    const before = bogCreates().length;
    const pays = await Promise.allSettled([acceptCheckoutTerms(card.greetingId, card.editToken, "ka"), acceptCheckoutTerms(card.greetingId, card.editToken, "ka")]);
    const createdNow = bogCreates().length - before;
    const pending = (await paymentsOf(card.greetingId)).filter((p) => p.status === "PENDING").length;
    const losers = pays.filter((r) => r.status === "rejected" && (r.reason as Error).name === "PaymentInProgressError").length;
    check("S6. Two simultaneous Pay presses → exactly one BOG order; the other is told 'in progress'", pending === 1 && createdNow === 1 && losers === 1, `bog creates ${createdNow}, pending rows ${pending}, ${pays.map((p) => p.status).join()}`);

    const [open] = await admin`select provider_payment_id from payments p join orders o on o.id = p.order_id where o.greeting_id = ${card.greetingId} and p.status = 'PENDING'`;
    const bogId = open?.provider_payment_id as string;
    const revisit = await getOrCreateCheckoutOrder(card.greetingId, card.editToken);
    const again = await attempt(() => acceptCheckoutTerms(card.greetingId, card.editToken, "ka"));
    check("S7. Revisit while BOG attempt is open: wait screen, second Pay refused", revisit.awaitingProvider === true && !again.ok && again.name === "PaymentInProgressError");

    const forgedCb = await callback(bogId, forger.privateKey);
    const unsigned = await handleProviderWebhook("BOG", JSON.stringify({ event: "order_payment", body: { order_id: bogId } }), new Headers());
    complete(bogId);
    const unknown = await callback("bog-does-not-exist");
    check("S8. Forged-signature and unsigned callbacks → 400, nothing changes", forgedCb.status === 400 && unsigned.status === 400 && (await ordersOf(card.greetingId))[0]!.status === "PENDING_PAYMENT", `${forgedCb.status} ${unsigned.status}`);
    check("S9. Callback for an unknown BOG order changes nothing here", unknown.status !== 500 && (await ordersOf(card.greetingId))[0]!.status === "PENDING_PAYMENT", String(unknown.status));
    const both = await Promise.all([callback(bogId), callback(bogId), checkPaymentReturn(card.greetingId, card.editToken)]);
    check("S10. Concurrent callbacks + return → one PAID, one commission of 30", both[0].status === 200 && (await ledgerOf(card.greetingId)) === "COMMISSION_EARNED:30" && (await paymentsOf(card.greetingId)).filter((p) => p.status === "SUCCEEDED").length === 1);
  }
  for (const [label, reported] of [["10.00 GEL (the public price)", 10], ["0.99 GEL", 0.99], ["1.01 GEL", 1.01]] as const) {
    const card = await newCard();
    setPilot(card.qrId, 100);
    const p = await payStarted(card);
    complete(p.bogId);
    bog.transferOverride.set(p.bogId, reported);
    await callback(p.bogId);
    await checkPaymentReturn(card.greetingId, card.editToken).catch(() => null);
    const [mm] = await admin`select count(*)::int as n from audit_logs where action = 'PAYMENT_AMOUNT_MISMATCH' and target_id = ${p.orderId}`;
    check(`S11. BOG reports ${label} for a 1.00 order → not PAID, not active, no commission, mismatch audited`, (await ordersOf(card.greetingId))[0]!.status !== "PAID" && !(await state(card.greetingId)).startsWith("ACTIVE") && (await ledgerOf(card.greetingId)) === "" && mm!.n >= 1, `${(await ordersOf(card.greetingId))[0]!.status} ${mm!.n}`);
    bog.transferOverride.delete(p.bogId);
  }
  {
    // Rejected at the bank → new attempt at the same 1.00.
    const card = await newCard();
    setPilot(card.qrId, 100);
    const p = await payStarted(card);
    reject(p.bogId);
    const r = await getOrCreateCheckoutOrder(card.greetingId, card.editToken);
    const again = await attempt(() => acceptCheckoutTerms(card.greetingId, card.editToken, "ka"));
    check("S12. Declined → fresh order, again 1.00 GEL at BOG", r.summary.grossAmountMinor === 100 && again.ok && lastCreate()?.purchase_units.total_amount === 1 && (await ledgerOf(card.greetingId)) === "");
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

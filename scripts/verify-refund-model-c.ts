import Module from "node:module";

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
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { getOrCreateCheckoutOrder } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
const { confirmPaymentSuccess, settleConfirmedPayment } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { recordChargeback } = require("../src/lib/payments/refunds") as typeof import("../src/lib/payments/refunds");
const { resolveQrState } = require("../src/lib/qr/resolve-state") as typeof import("../src/lib/qr/resolve-state");
const { loadActiveGreetingForRecipient, signRecipientVoiceUrl, RecipientAccessError } = require("../src/lib/greetings/recipient") as typeof import("../src/lib/greetings/recipient");
const { withPublicContext, withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
const { greetingContent } = require("../src/db/schema") as typeof import("../src/db/schema");

/**
 * verify:refund-model-c — Refund Model C (migrations/0029).
 *
 *  A. A paid greeting is public (baseline, and the RLS public branch still works).
 *  B. Confirmed full return (recorded chargeback → order REFUNDED): the QR
 *     resolves "suspended"; the recipient loader and the voice-URL signer
 *     refuse; greeting_content is unreadable in the public context (RLS).
 *  C. Nothing is deleted: QR token + status, greeting, content, payment,
 *     refund row and the partner ledger (earned + reversal) are all kept;
 *     admins can still read the content.
 *  D. Not suspended: a duplicate-charge refund (order stays PAID), a partial
 *     refund (PARTIALLY_REFUNDED), and a REFUNDED order next to a PAID one.
 *  E. Suspension wins over the 12-month expiry (no "expired" leak either way).
 *  F. app_greeting_refund_suspended: app_runtime may execute it; anon /
 *     authenticated / PUBLIC may not.
 */

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
async function refused(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof RecipientAccessError;
  }
}
const MESSAGE = `Model C suite message ${crypto.randomUUID()}`;

async function main() {
  console.log("Setting up fixtures (superuser)...");
  const adminUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING'`;
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"mc-" + partnerId.slice(0, 8)}, 'Model C Partner', 3000, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'model-c', 50)`;
  await admin`insert into prices (product_id, partner_id, currency, amount_minor, active) values (${product!.id}, ${partnerId}, 'GEL', 1000, true)`;

  /** A paid, activated sale through the TEST provider. */
  async function sale() {
    const qrId = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    await updateGreetingMessage(greetingId, editToken, MESSAGE);
    const { summary } = await getOrCreateCheckoutOrder(greetingId, editToken);
    const [pay] = await admin`select provider_payment_id, amount_minor, currency from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    await settleConfirmedPayment(
      await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: pay!.provider_payment_id, orderId: summary.orderId, amountMinor: pay!.amount_minor, currency: pay!.currency }),
    );
    return { orderId: summary.orderId, greetingId, qrId, token };
  }
  const publicContentRows = (greetingId: string) =>
    withPublicContext((tx) => tx.select({ id: greetingContent.id }).from(greetingContent).where(eq(greetingContent.greetingId, greetingId)));
  const ledger = async (orderId: string) =>
    (await admin`select type, amount_minor from partner_ledger_entries where order_id = ${orderId} order by created_at`).map((r) => `${r.type}:${r.amount_minor}`).join(",");
  const suspendedFn = async (greetingId: string) => (await admin`select app_greeting_refund_suspended(${greetingId}::uuid) as s`)[0]!.s as boolean;

  console.log("\n--- A. A paid greeting is public ---");
  const a = await sale();
  {
    check("A1. resolveQrState → active", (await resolveQrState(a.token)).kind === "active");
    const data = await loadActiveGreetingForRecipient(a.greetingId);
    check("A2. Recipient loader returns the message", data.content.some((c) => c.type === "text" && c.textValue === MESSAGE));
    check("A3. Voice signer answers (no audio → null), not refused", (await signRecipientVoiceUrl(a.greetingId)) === null);
    check("A4. Public context can read its content rows (RLS public branch)", (await publicContentRows(a.greetingId)).length > 0);
    check("A5. app_greeting_refund_suspended = false", (await suspendedFn(a.greetingId)) === false);
  }

  console.log("\n--- B. Confirmed full return → public access suspended ---");
  const b = await sale();
  const before = {
    token: (await admin`select public_token from qr_codes where id = ${b.qrId}`)[0]!.public_token as string,
    content: (await admin`select id, type, text_value, storage_key from greeting_content where greeting_id = ${b.greetingId} order by id`).map((r) => JSON.stringify(r)).join("|"),
  };
  await recordChargeback(adminUserId, b.orderId, { reference: `CB-${crypto.randomUUID().slice(0, 8)}`, disputedOn: new Date().toISOString().slice(0, 10) });
  {
    check("B1. Order REFUNDED (precondition)", (await admin`select status from orders where id = ${b.orderId}`)[0]!.status === "REFUNDED");
    const r = await resolveQrState(b.token);
    check("B2. resolveQrState → suspended (was: active — the 19f defect)", r.kind === "suspended", r.kind);
    check("B3. …carries no content, only ids for server-side use", Object.keys(r).every((k) => ["kind", "qrId", "greetingId", "partnerId"].includes(k)));
    check("B4. Recipient loader refuses (no signed media URL issued)", await refused(() => loadActiveGreetingForRecipient(b.greetingId)));
    check("B5. Voice-URL signer refuses", await refused(() => signRecipientVoiceUrl(b.greetingId)));
    check("B6. Public context reads 0 content rows (RLS backstop)", (await publicContentRows(b.greetingId)).length === 0);
    check("B7. app_greeting_refund_suspended = true", (await suspendedFn(b.greetingId)) === true);
  }

  console.log("\n--- C. Nothing is deleted ---");
  {
    const [q] = await admin`select public_token, status from qr_codes where id = ${b.qrId}`;
    check("C1. QR token unchanged and QR still ACTIVE", q!.public_token === before.token && q!.status === "ACTIVE");
    check("C2. Greeting still ACTIVE", (await admin`select status from greetings where id = ${b.greetingId}`)[0]!.status === "ACTIVE");
    const after = (await admin`select id, type, text_value, storage_key from greeting_content where greeting_id = ${b.greetingId} order by id`).map((r) => JSON.stringify(r)).join("|");
    check("C3. Content rows identical (message + storage keys kept)", after === before.content && after.includes(MESSAGE));
    check("C4. Partner ledger keeps earned + reversal", (await ledger(b.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300", await ledger(b.orderId));
    const [rf] = await admin`select reason, status from payment_refunds where order_id = ${b.orderId}`;
    check("C5. Refund row kept (CHARGEBACK, COMPLETED) and charge REFUNDED", rf?.reason === "CHARGEBACK" && rf.status === "COMPLETED" && (await admin`select count(*)::int as n from payments where order_id = ${b.orderId} and status = 'REFUNDED'`)[0]!.n === 1);
    const adminRows = await withAdminContext(adminUserId, (tx) => tx.select({ id: greetingContent.id }).from(greetingContent).where(eq(greetingContent.greetingId, b.greetingId)));
    check("C6. An admin can still read the retained content (support / legal)", adminRows.length > 0);
  }

  console.log("\n--- D. What must NOT suspend ---");
  {
    // Duplicate charge refunded: the extra charge is REFUNDED, the order stays PAID (refunds.ts DUPLICATE_CAPTURE).
    const d = await sale();
    await admin`insert into payments (id, order_id, provider, provider_payment_id, amount_minor, currency, status, created_at, confirmed_at)
                values (${crypto.randomUUID()}, ${d.orderId}, 'TEST', ${"dup-" + crypto.randomUUID()}, 1000, 'GEL', 'REFUNDED', now(), now())`;
    check("D1. Duplicate charge refunded, order PAID → still active", (await resolveQrState(d.token)).kind === "active" && (await publicContentRows(d.greetingId)).length > 0);

    const p = await sale();
    await admin`update orders set status = 'PARTIALLY_REFUNDED' where id = ${p.orderId}`;
    check("D2. Partial refund (PARTIALLY_REFUNDED) → still active", (await resolveQrState(p.token)).kind === "active" && !(await refused(() => loadActiveGreetingForRecipient(p.greetingId))));

    // A REFUNDED order next to a PAID one for the same greeting (e.g. an ineligible capture refunded, the real one paid).
    const m = await sale();
    let mixedOk = true;
    try {
      await admin`insert into orders select (jsonb_populate_record(null::orders, to_jsonb(o) || jsonb_build_object('id', gen_random_uuid(), 'status', 'REFUNDED'))).* from orders o where o.id = ${m.orderId}`;
    } catch (e) {
      mixedOk = false;
      console.log(`  (could not build a second order: ${(e as Error).message.slice(0, 120)})`);
    }
    check("D3. REFUNDED order + PAID order on the same greeting → still active", mixedOk && (await resolveQrState(m.token)).kind === "active" && (await suspendedFn(m.greetingId)) === false);
  }

  console.log("\n--- E. Suspension wins over expiry ---");
  {
    await admin`update greetings set activated_at = now() - interval '13 months' where id = ${b.greetingId}`;
    check("E1. Refunded and past 12 months → suspended (not expired)", (await resolveQrState(b.token)).kind === "suspended");
    await admin`update greetings set activated_at = now() - interval '13 months' where id = ${a.greetingId}`;
    check("E2. Paid and past 12 months → expired (unchanged behaviour)", (await resolveQrState(a.token)).kind === "expired");
  }

  console.log("\n--- F. Function privileges ---");
  {
    const priv = async (role: string) => {
      const exists = (await admin`select 1 from pg_roles where rolname = ${role}`).length > 0;
      if (!exists) return null;
      return (await admin`select has_function_privilege(${role}, 'app_greeting_refund_suspended(uuid)', 'execute') as p`)[0]!.p as boolean;
    };
    check("F1. app_runtime can execute it", (await priv("app_runtime")) === true);
    const anon = await priv("anon");
    const authd = await priv("authenticated");
    check("F2. anon / authenticated cannot (Data API stays locked)", anon !== true && authd !== true, JSON.stringify({ anon, authd }));
    const secdef = (await admin`select prosecdef as secdef from pg_proc where proname = 'app_greeting_refund_suspended'`)[0]?.secdef;
    check("F3. SECURITY DEFINER with a fixed search_path", secdef === true && (await admin`select proconfig from pg_proc where proname = 'app_greeting_refund_suspended'`)[0]!.proconfig?.some((c: string) => c.startsWith("search_path=")));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await admin.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await admin.end();
  process.exit(1);
});

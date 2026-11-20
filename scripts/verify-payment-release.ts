import Module from "node:module";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

// The scheduled endpoint reads these when lib/env is first loaded (section 7).
const CRON_SECRET = `verify-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const RECONCILE_ADMIN = crypto.randomUUID();
process.env.CRON_SECRET = CRON_SECRET;
process.env.RECONCILE_ADMIN_USER_ID = RECONCILE_ADMIN;

const postgres = require("postgres") as typeof import("postgres");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { verifyGreetingEditAccess } = require("../src/lib/greetings/access") as typeof import("../src/lib/greetings/access");
const { releaseAbandonedDraft, DraftReleaseError, DRAFT_RELEASE_MIN_IDLE_HOURS } = require("../src/lib/greetings/release") as typeof import("../src/lib/greetings/release");
const { getOrCreateCheckoutOrder } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
const { confirmPaymentSuccess, settleConfirmedPayment, refundPaidOrder, RefundError, findPaymentAnomalies } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { completeRefund, reconcileOrderRefunds } = require("../src/lib/payments/refunds") as typeof import("../src/lib/payments/refunds");
const { TestPaymentProvider } = require("../src/lib/payments/providers/test-provider") as typeof import("../src/lib/payments/providers/test-provider");
const { classifyReconcileHealth, getReconcileHealth, RECONCILE_STALE_AFTER_MS } = require("../src/lib/payments/reconcile-heartbeat") as typeof import("../src/lib/payments/reconcile-heartbeat");
const { withAdminContext, withPaymentActivation } = require("../src/db/client") as typeof import("../src/db/client");
const { partnerLedgerEntries } = require("../src/db/schema") as typeof import("../src/db/schema");

/**
 * BOG release safety (docs/bog-release/BOG_RELEASE_2026-11-21.md), against the
 * local database with the TEST provider. No network, no real money.
 *
 * FA-02 refunds and revoked admins
 *  1. An ADMIN refund still REQUESTED when its requester is removed completes
 *     on the provider's confirmation: order + charge REFUNDED, commission
 *     reversed once, audited as SYSTEM with the requester kept.
 *  2. The payment-service context alone cannot book a COMMISSION_REVERSAL
 *     (no COMPLETED refund) — the new ledger policy is narrow.
 *  3. A revoked / non-admin user id cannot start a refund (refundPaidOrder).
 *  4. Reconciliation does not re-send an unacknowledged ADMIN refund for a
 *     revoked requester (REQUESTER_REVOKED, provider never called), but does
 *     for a current admin.
 * FA-01 abandoned drafts
 *  5. Release: content erased, old link dead, card AVAILABLE, audited; the
 *     next sender re-claims the same row with a fresh token; two senders at
 *     once → exactly one wins. Refused: recent edits, a PENDING/PAID order, a
 *     short reason, a non-admin, an ACTIVE card.
 *  6. Card status guard (trigger): partner staff cannot push a DRAFT card to
 *     AVAILABLE or block a card; an admin cannot skip the release; staff can
 *     still mark cards distributed; claim and activation still work.
 * FA-03 reconciliation
 *  7. /api/cron/payments-reconcile: 401 on a wrong secret; 200 + heartbeat;
 *     two calls at once → one runs, one 409; the dashboard health reads it.
 *  8. Health classification: NEVER / OK / ATTENTION / FAILING / STALE.
 */

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
const runtimeUrl = process.env.DATABASE_URL;
if (!migrationsUrl || !runtimeUrl) throw new Error("MIGRATIONS_DATABASE_URL and DATABASE_URL are required");
const admin = postgres(migrationsUrl, { max: 1 });
const runtime = postgres(runtimeUrl, { max: 2 });

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
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e };
  }
}
/** The error and its cause chain (drizzle wraps the Postgres error). */
const errText = (r: { ok: boolean; error?: unknown }) => {
  if (r.ok) return "succeeded";
  const parts: string[] = [];
  let e: unknown = (r as { error: unknown }).error;
  for (let i = 0; e && i < 4; i++) {
    parts.push(e instanceof Error ? e.message : String(e));
    e = e instanceof Error ? (e as Error & { cause?: unknown }).cause : undefined;
  }
  return parts.join(" <- ");
};
const MESSAGE = `Release suite message ${crypto.randomUUID()}`;

/** Runs SQL as app_runtime with the given transaction-local settings; returns the error text or null. */
async function asRuntime(settings: Record<string, string>, fn: (sql: postgres.TransactionSql) => Promise<unknown>): Promise<string | null> {
  try {
    await runtime.begin(async (sql) => {
      for (const [k, v] of Object.entries(settings)) await sql`select set_config(${k}, ${v}, true)`;
      await fn(sql);
    });
    return null;
  } catch (e) {
    return String(e instanceof Error ? e.message : e);
  }
}

async function main() {
  console.log("Setting up fixtures (superuser)...");
  const adminUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId}), (${RECONCILE_ADMIN})`;
  const [product] = await admin`select id from products where key = 'PREMIUM_GREETING'`;
  const partnerId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${partnerId}, ${"rel-" + partnerId.slice(0, 8)}, 'Release Partner', 3000, 'ACTIVE')`;
  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerId}, 'release', 50)`;
  await admin`insert into prices (product_id, partner_id, currency, amount_minor, active) values (${product!.id}, ${partnerId}, 'GEL', 1000, true)`;
  const staffUserId = crypto.randomUUID();
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerId}, ${staffUserId}, 'STAFF')`;

  async function card() {
    const qrId = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${batchId}, ${partnerId}, 'AVAILABLE')`;
    return { qrId, token };
  }
  async function draft() {
    const c = await card();
    const g = await startGreeting(c.token);
    await updateGreetingMessage(g.greetingId, g.editToken, MESSAGE);
    return { ...c, ...g };
  }
  async function sale() {
    const d = await draft();
    const { summary } = await getOrCreateCheckoutOrder(d.greetingId, d.editToken);
    const [pay] = await admin`select provider_payment_id, amount_minor, currency from payments where order_id = ${summary.orderId} and status = 'PENDING'`;
    await settleConfirmedPayment(
      await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: pay!.provider_payment_id, orderId: summary.orderId, amountMinor: pay!.amount_minor, currency: pay!.currency }),
    );
    return { ...d, orderId: summary.orderId };
  }
  /** Ages a draft (greeting + content) by `hours`, as if nobody had touched it. */
  async function age(greetingId: string, hours: number) {
    await admin`update greetings set updated_at = now() - make_interval(hours => ${hours}) where id = ${greetingId}`;
    await admin`update greeting_content set updated_at = now() - make_interval(hours => ${hours}) where greeting_id = ${greetingId}`;
  }
  const ledger = async (orderId: string) =>
    (await admin`select type, amount_minor from partner_ledger_entries where order_id = ${orderId} order by created_at`).map((r) => `${r.type}:${r.amount_minor}`).join(",");
  const status = async (table: "orders" | "qr_codes" | "greetings", id: string) => (await admin`select status from ${admin(table)} where id = ${id}`)[0]?.status as string;
  async function openRefund(orderId: string, requestedBy: string) {
    const [pay] = await admin`select id, amount_minor, currency from payments where order_id = ${orderId} and status = 'SUCCEEDED'`;
    const [r] = await admin`insert into payment_refunds (payment_id, order_id, amount_minor, currency, reason, requested_by) values (${pay!.id}, ${orderId}, ${pay!.amount_minor}, ${pay!.currency}, 'ADMIN', ${requestedBy}) returning id`;
    return r!.id as string;
  }

  console.log("\n--- 1. FA-02: refund completes after the requesting admin is removed ---");
  {
    const s = await sale();
    const leaver = crypto.randomUUID();
    await admin`insert into admin_users (user_id) values (${leaver})`;
    const refundId = await openRefund(s.orderId, leaver);
    await admin`delete from admin_users where user_id = ${leaver}`;
    const r = await attempt(() => completeRefund(refundId, s.orderId));
    const [rf] = await admin`select status from payment_refunds where id = ${refundId}`;
    const [pay] = await admin`select status from payments where order_id = ${s.orderId}`;
    check("1a. completeRefund succeeds although the requester is no longer an admin", r.ok, errText(r));
    check("1b. Refund COMPLETED, order and charge REFUNDED", rf?.status === "COMPLETED" && (await status("orders", s.orderId)) === "REFUNDED" && pay?.status === "REFUNDED");
    check("1c. Commission reversed exactly once (+300, −300)", (await ledger(s.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300", await ledger(s.orderId));
    const [audit] = await admin`select actor_type, actor_id, metadata from audit_logs where target_id = ${s.orderId} and action = 'ORDER_REFUNDED'`;
    check("1d. Booked as SYSTEM; the requester is kept in the audit metadata", audit?.actor_type === "SYSTEM" && audit.actor_id === null && (audit.metadata as { requestedBy?: string }).requestedBy === leaver, JSON.stringify(audit));
    const again = await attempt(() => completeRefund(refundId, s.orderId));
    check("1e. A repeated completion (late callback) changes nothing", again.ok && (await ledger(s.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300");
    const anomalies = await findPaymentAnomalies(adminUserId);
    check("1f. No anomaly left for the order", !anomalies.some((a) => a.orderId === s.orderId), JSON.stringify(anomalies.filter((a) => a.orderId === s.orderId)));
  }

  console.log("\n--- 2. FA-02: the new ledger policy is narrow ---");
  {
    const s = await sale();
    await admin`update orders set status = 'REFUNDED' where id = ${s.orderId}`; // the trigger's precondition, so only RLS can refuse
    const r = await attempt(() =>
      withPaymentActivation(s.orderId, (tx) =>
        tx.insert(partnerLedgerEntries).values({ partnerId, orderId: s.orderId, type: "COMMISSION_REVERSAL", amountMinor: -300, currency: "GEL" }),
      ),
    );
    check("2a. Payment context without a COMPLETED refund cannot book a reversal (RLS)", !r.ok && /row-level security/i.test(errText(r)), errText(r));
    const adj = await asRuntime({ "app.payment_activation_order_id": s.orderId }, (sql) => sql`insert into partner_ledger_entries (partner_id, order_id, type, amount_minor, currency) values (${partnerId}, ${s.orderId}, 'ADJUSTMENT', 500, 'GEL')`);
    check("2b. …nor any other ledger type (ADJUSTMENT stays admin-only)", !!adj && /row-level security/i.test(adj), adj ?? "inserted");
    check("2c. Ledger unchanged", (await ledger(s.orderId)) === "COMMISSION_EARNED:300");
  }

  console.log("\n--- 3. FA-02: only a current admin can start a refund ---");
  {
    const s = await sale();
    const stranger = await attempt(() => refundPaidOrder(crypto.randomUUID(), s.orderId));
    check("3a. A non-admin user id is refused; order stays PAID, no refund row", !stranger.ok && stranger.error instanceof RefundError && (await status("orders", s.orderId)) === "PAID" && (await admin`select 1 from payment_refunds where order_id = ${s.orderId}`).length === 0, errText(stranger));
    const revoked = crypto.randomUUID();
    await admin`insert into admin_users (user_id) values (${revoked})`;
    await admin`delete from admin_users where user_id = ${revoked}`;
    const r = await attempt(() => refundPaidOrder(revoked, s.orderId));
    check("3b. A revoked admin is refused", !r.ok && r.error instanceof RefundError, errText(r));
    const ok = await attempt(() => refundPaidOrder(adminUserId, s.orderId));
    check("3c. A current admin can refund (TEST completes at once)", ok.ok && (await status("orders", s.orderId)) === "REFUNDED" && (await ledger(s.orderId)) === "COMMISSION_EARNED:300,COMMISSION_REVERSAL:-300", errText(ok));
  }

  console.log("\n--- 4. FA-02: reconciliation never re-sends money for a revoked requester ---");
  {
    const proto = TestPaymentProvider.prototype as unknown as { verifyPayment: (id: string) => Promise<unknown>; refundPayment: (...a: unknown[]) => Promise<unknown> };
    const origVerify = proto.verifyPayment;
    const origRefund = proto.refundPayment;
    let sent = 0;
    proto.verifyPayment = async function (id: string) {
      const base = (await origVerify.call(this, id)) as object;
      return { ...base, refund: { status: "NONE", refundedAmountMinor: 0, rejectedActionIds: [] } };
    };
    proto.refundPayment = async function (...a: unknown[]) {
      sent++;
      return origRefund.apply(this, a);
    };
    try {
      const s = await sale();
      const leaver = crypto.randomUUID();
      const refundId = await openRefund(s.orderId, leaver); // never an admin
      const r = await reconcileOrderRefunds(s.orderId);
      const [rf] = await admin`select status, provider_code from payment_refunds where id = ${refundId}`;
      check("4a. Not re-sent: provider never called, refund REJECTED (REQUESTER_REVOKED)", sent === 0 && r.rejected === 1 && rf?.status === "REJECTED" && rf.provider_code === "REQUESTER_REVOKED", JSON.stringify({ sent, r, rf }));
      check("4b. Order stays PAID with its commission (a current admin decides again)", (await status("orders", s.orderId)) === "PAID" && (await ledger(s.orderId)) === "COMMISSION_EARNED:300");
      const [aud] = await admin`select 1 from audit_logs where target_id = ${s.orderId} and action = 'PAYMENT_REFUND_REJECTED' and metadata->>'code' = 'REQUESTER_REVOKED'`;
      check("4c. Audited", !!aud);

      const s2 = await sale();
      await openRefund(s2.orderId, adminUserId);
      const r2 = await reconcileOrderRefunds(s2.orderId);
      check("4d. For a current admin's refund it is re-sent once and completes", sent === 1 && r2.completed === 1 && (await status("orders", s2.orderId)) === "REFUNDED", JSON.stringify({ sent, r2 }));
    } finally {
      proto.verifyPayment = origVerify;
      proto.refundPayment = origRefund;
    }
  }

  console.log("\n--- 5. FA-01: releasing an abandoned draft ---");
  const asAdmin = <T>(fn: Parameters<typeof withAdminContext<T>>[1], who = adminUserId) => withAdminContext(who, fn);
  {
    const d = await draft();
    await admin`insert into greeting_content (greeting_id, type, slot, storage_key, mime_type, size_bytes, status) values (${d.greetingId}, 'photo', 1, ${"test/" + d.greetingId + "/p1.jpg"}, 'image/jpeg', 10, 'READY')`;
    const fresh = await attempt(() => asAdmin((tx) => releaseAbandonedDraft(tx, adminUserId, d.qrId, "shop test card")));
    check("5a. Refused while recently edited (RECENTLY_ACTIVE); nothing changed", !fresh.ok && fresh.error instanceof DraftReleaseError && fresh.error.code === "RECENTLY_ACTIVE" && (await status("qr_codes", d.qrId)) === "DRAFT", errText(fresh));
    await age(d.greetingId, DRAFT_RELEASE_MIN_IDLE_HOURS + 1);
    const short = await attempt(() => asAdmin((tx) => releaseAbandonedDraft(tx, adminUserId, d.qrId, "x")));
    check("5b. Refused without a real reason", !short.ok && short.error instanceof DraftReleaseError && short.error.code === "REASON_REQUIRED");
    const stranger = crypto.randomUUID();
    const notAdmin = await attempt(() => withAdminContext(stranger, (tx) => releaseAbandonedDraft(tx, stranger, d.qrId, "not my card")));
    check("5c. Refused for a non-admin (RLS/trigger); nothing changed", !notAdmin.ok && (await status("qr_codes", d.qrId)) === "DRAFT" && (await admin`select count(*)::int n from greeting_content where greeting_id = ${d.greetingId}`)[0]!.n === 2, errText(notAdmin));

    const r = await asAdmin((tx) => releaseAbandonedDraft(tx, adminUserId, d.qrId, "shop staff tested the card"));
    const [g] = await admin`select status, edit_token_hash from greetings where id = ${d.greetingId}`;
    const [{ n }] = (await admin`select count(*)::int n from greeting_content where greeting_id = ${d.greetingId}`) as unknown as [{ n: number }];
    check("5d. Released: card AVAILABLE, greeting DRAFT without token, content erased", (await status("qr_codes", d.qrId)) === "AVAILABLE" && g?.status === "DRAFT" && g.edit_token_hash === null && n === 0 && r.removedContent === 2);
    check("5e. Media keys handed back for deletion after commit", r.storageKeys.length === 1 && r.storageKeys[0]!.endsWith("/p1.jpg"));
    const [audit] = await admin`select actor_type, actor_id, metadata from audit_logs where target_id = ${d.qrId} and action = 'QR_DRAFT_RELEASED'`;
    check("5f. Audited with the admin, reason and greeting", audit?.actor_type === "ADMIN" && audit.actor_id === adminUserId && (audit.metadata as { reason?: string }).reason === "shop staff tested the card");
    const oldLink = await attempt(() => verifyGreetingEditAccess(d.greetingId, d.editToken));
    check("5g. The abandoned sender's link no longer opens the draft", !oldLink.ok);

    const both = await Promise.all([attempt(() => startGreeting(d.token)), attempt(() => startGreeting(d.token))]);
    const winners = both.filter((b) => b.ok) as { ok: true; value: { greetingId: string; editToken: string } }[];
    check("5h. Two senders start it at once → exactly one wins", winners.length === 1, both.map(errText).join(" | "));
    const w = winners[0]!.value;
    check("5i. The winner re-claims the same greeting row; card DRAFT", w.greetingId === d.greetingId && (await status("qr_codes", d.qrId)) === "DRAFT");
    const access = await attempt(() => verifyGreetingEditAccess(w.greetingId, w.editToken));
    const oldAgain = await attempt(() => verifyGreetingEditAccess(d.greetingId, d.editToken));
    check("5j. The new sender's token works; the old one still does not", access.ok && !oldAgain.ok);
    const write = await attempt(() => updateGreetingMessage(w.greetingId, w.editToken, "a new sender's words"));
    check("5k. The new sender can write and continue to checkout", write.ok && (await attempt(() => getOrCreateCheckoutOrder(w.greetingId, w.editToken))).ok, errText(write));

    const pending = await attempt(async () => {
      await age(w.greetingId, DRAFT_RELEASE_MIN_IDLE_HOURS + 1);
      return asAdmin((tx) => releaseAbandonedDraft(tx, adminUserId, d.qrId, "abandoned at the bank page"));
    });
    check("5l. Refused with a PENDING_PAYMENT order (LIVE_ORDER)", !pending.ok && pending.error instanceof DraftReleaseError && pending.error.code === "LIVE_ORDER", errText(pending));

    const failedOrder = await draft();
    const { summary } = await getOrCreateCheckoutOrder(failedOrder.greetingId, failedOrder.editToken);
    await admin`update orders set status = 'FAILED' where id = ${summary.orderId}`;
    await admin`update payments set status = 'FAILED' where order_id = ${summary.orderId}`;
    await age(failedOrder.greetingId, DRAFT_RELEASE_MIN_IDLE_HOURS + 1);
    const okFailed = await attempt(() => asAdmin((tx) => releaseAbandonedDraft(tx, adminUserId, failedOrder.qrId, "payment failed, customer left")));
    check("5m. Allowed when the only order FAILED; that order is kept", okFailed.ok && (await status("qr_codes", failedOrder.qrId)) === "AVAILABLE" && (await status("orders", summary.orderId)) === "FAILED", errText(okFailed));

    const paid = await sale();
    const active = await attempt(() => asAdmin((tx) => releaseAbandonedDraft(tx, adminUserId, paid.qrId, "trying to recycle a sold card")));
    check("5n. A sold (ACTIVE) card can never be released", !active.ok && active.error instanceof DraftReleaseError && active.error.code === "NOT_DRAFT" && (await status("qr_codes", paid.qrId)) === "ACTIVE");
  }

  console.log("\n--- 6. Card status guard (trigger, app_runtime) ---");
  {
    const d = await draft();
    const staffCtx = { "app.user_id": staffUserId, "app.partner_id": partnerId };
    const e1 = await asRuntime(staffCtx, (sql) => sql`update qr_codes set status = 'AVAILABLE' where id = ${d.qrId}`);
    check("6a. Partner staff cannot push a customer's DRAFT card back to AVAILABLE", !!e1 && /admin draft release/.test(e1) && (await status("qr_codes", d.qrId)) === "DRAFT", e1 ?? "allowed");
    const e2 = await asRuntime(staffCtx, (sql) => sql`update qr_codes set status = 'BLOCKED' where id = ${d.qrId}`);
    check("6b. Partner staff cannot block a card either", !!e2 && /not permitted/.test(e2), e2 ?? "allowed");
    const e3 = await asRuntime(staffCtx, (sql) => sql`update qr_codes set distribution_status = 'DISTRIBUTED', distributed_at = now() where id = ${d.qrId}`);
    const [dist] = await admin`select distribution_status from qr_codes where id = ${d.qrId}`;
    check("6c. Partner staff can still mark cards distributed", e3 === null && dist?.distribution_status === "DISTRIBUTED", e3 ?? "");
    const e4 = await asRuntime({ "app.user_id": adminUserId }, (sql) => sql`update qr_codes set status = 'AVAILABLE' where id = ${d.qrId}`);
    check("6d. Even an admin cannot skip the release flow (no release flag)", !!e4 && /admin draft release/.test(e4), e4 ?? "allowed");
    const e5 = await asRuntime({ "app.user_id": adminUserId, "app.draft_release_qr_id": d.qrId }, (sql) => sql`update qr_codes set status = 'AVAILABLE' where id = ${d.qrId}`);
    check("6e. …nor release with the flag while the greeting still holds a token", !!e5 && /reset DRAFT/.test(e5), e5 ?? "allowed");
    const e6 = await asRuntime({ "app.user_id": adminUserId }, (sql) => sql`update qr_codes set status = 'BLOCKED' where id = ${d.qrId}`);
    check("6f. An admin can still block (moderation)", e6 === null && (await status("qr_codes", d.qrId)) === "BLOCKED", e6 ?? "");
    const d2 = await draft();
    const e7 = await asRuntime({ "app.claimable_qr_id": d2.qrId }, (sql) => sql`update qr_codes set status = 'AVAILABLE' where id = ${d2.qrId}`);
    check("6g. The claim context cannot move a DRAFT card backwards (stays DRAFT)", (await status("qr_codes", d2.qrId)) === "DRAFT", e7 ?? "no error, unchanged");
    const e8 = await asRuntime({ "app.user_id": crypto.randomUUID(), "app.draft_release_qr_id": d2.qrId }, (sql) => sql`update qr_codes set status = 'AVAILABLE' where id = ${d2.qrId}`);
    check("6g2. A stranger with a forged release flag changes nothing", (await status("qr_codes", d2.qrId)) === "DRAFT", e8 ?? "no error, unchanged");
    const s = await sale();
    check("6h. Normal claim → payment → activation still works", (await status("qr_codes", s.qrId)) === "ACTIVE" && (await status("greetings", s.greetingId)) === "ACTIVE");
    const [{ n }] = (await admin`select count(*)::int n from pg_trigger where tgname = 'trg_qr_codes_status_transition'`) as unknown as [{ n: number }];
    const ops = await attempt(() => admin`update qr_codes set status = 'AVAILABLE' where id = ${s.qrId} and false`);
    check("6i. Trigger installed; operator/migration roles are not restricted", n === 1 && ops.ok);
  }

  console.log("\n--- 7. FA-03: scheduled endpoint ---");
  {
    const { GET } = require("../src/app/api/cron/payments-reconcile/route") as typeof import("../src/app/api/cron/payments-reconcile/route");
    const call = (secret: string) => GET(new Request("http://127.0.0.1/api/cron/payments-reconcile", { headers: { authorization: `Bearer ${secret}` } }));
    const bad = await call("wrong-secret-wrong-secret-wrong-secret");
    check("7a. A wrong secret is refused (401)", bad.status === 401);
    const before = (await admin`select count(*)::int n from audit_logs where action = 'PAYMENT_RECONCILE_RUN'`)[0]!.n as number;
    const [a, b] = await Promise.all([call(CRON_SECRET), call(CRON_SECRET)]);
    const codes = [a.status, b.status].sort().join(",");
    check("7b. Two calls at once: one runs (200), the other is told it is running (409)", codes === "200,409", codes);
    const body = (await (a.status === 200 ? a : b).json()) as Record<string, unknown>;
    check("7c. The response carries counts only", ["anomalies", "repaired", "repairFailures", "remaining", "alerted"].every((k) => k in body) && Object.keys(body).length === 5, JSON.stringify(body));
    const runs = await admin`select actor_type, metadata from audit_logs where action = 'PAYMENT_RECONCILE_RUN' order by created_at desc`;
    check("7d. Exactly one heartbeat for the run (SYSTEM, ok, counts)", runs.length === before + 1 && runs[0]!.actor_type === "SYSTEM" && (runs[0]!.metadata as { ok?: boolean }).ok === true);
    const again = await call(CRON_SECRET);
    check("7e. After the run, the next call runs again (200)", again.status === 200);
    const health = await withAdminContext(adminUserId, (tx) => getReconcileHealth(tx));
    check("7f. Dashboard health sees the recent run and the configured schedule", health.lastSuccessAt !== null && health.scheduleConfigured && ["OK", "ATTENTION"].includes(health.status), JSON.stringify(health));
  }

  console.log("\n--- 8. FA-03: health classification ---");
  {
    const now = new Date("2026-11-30T12:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    check("8a. No runs → NEVER", classifyReconcileHealth([], now).status === "NEVER");
    check("8b. Recent clean run → OK", classifyReconcileHealth([{ createdAt: ago(60_000), ok: true, remaining: 0 }], now).status === "OK");
    check("8c. Recent run with open items → ATTENTION", classifyReconcileHealth([{ createdAt: ago(60_000), ok: true, remaining: 2 }], now).status === "ATTENTION");
    check("8d. Last run failed, earlier success recent → FAILING", classifyReconcileHealth([{ createdAt: ago(60_000), ok: false, remaining: 0 }, { createdAt: ago(3_600_000), ok: true, remaining: 0 }], now).status === "FAILING");
    check("8e. Last success older than the stale window → STALE", classifyReconcileHealth([{ createdAt: ago(RECONCILE_STALE_AFTER_MS + 60_000), ok: true, remaining: 0 }], now).status === "STALE");
    check("8f. Only failures → STALE", classifyReconcileHealth([{ createdAt: ago(60_000), ok: false, remaining: 0 }], now).status === "STALE");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await admin.end();
  await runtime.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await admin.end().catch(() => {});
  await runtime.end().catch(() => {});
  process.exit(1);
});

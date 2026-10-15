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
const { sql: dsql, eq } = require("drizzle-orm") as typeof import("drizzle-orm");
const { withAdminContext, withPartnerContext, withPublicContext, withUserContext } = require("../src/db/client") as typeof import("../src/db/client");
const schema = require("../src/db/schema") as typeof import("../src/db/schema");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startGreeting } = require("../src/lib/greetings/start") as typeof import("../src/lib/greetings/start");
const { updateGreetingMessage } = require("../src/lib/greetings/content") as typeof import("../src/lib/greetings/content");
const { getOrCreateCheckoutOrder } = require("../src/lib/payments/checkout") as typeof import("../src/lib/payments/checkout");
const { getDefaultProductPrice } = require("../src/lib/payments/display-price") as typeof import("../src/lib/payments/display-price");
const { confirmPaymentSuccess, settleConfirmedPayment, refundPaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const pricingAdmin = require("../src/lib/payments/pricing-admin") as typeof import("../src/lib/payments/pricing-admin");
const split = require("../src/lib/payments/split") as typeof import("../src/lib/payments/split");
const validation = require("../src/lib/validation/pricing") as typeof import("../src/lib/validation/pricing");
const { updatePartnerSchema } = require("../src/lib/validation/partners") as typeof import("../src/lib/validation/partners");

/**
 * Super Admin partner pricing (migrations/0019, lib/payments/pricing-admin.ts):
 *
 *  1. Global default: a partner with no custom price checks out at the
 *     platform default; changing the default reprices new checkouts only.
 *  2. Custom partner price: wins over the default for that partner only;
 *     display price == checkout price; clearing it falls back to the default.
 *  3. Commission per partner: snapshotted into the order with the split.
 *  4. Snapshots: an open (unpaid) order, and a paid one, keep their price,
 *     rate and split after the admin changes pricing — including when the
 *     open order is re-entered and then paid.
 *  5. Refunds reverse exactly the snapshotted commission, never the live rate.
 *  6. Authorization: a partner OWNER, a plain signed-in user and the public
 *     context can't change price or commission — not through the service, not
 *     through raw SQL (RLS + 0018 trigger); the partner can still edit its
 *     own name; the generic partner-update schema drops commission.
 *  7. Concurrency: simultaneous edits from the same starting value → exactly
 *     one wins, the rest are refused as stale; one active price row per
 *     scope even under a race; one audit row per actual change.
 *  8. Audit: actor, old value, new value, timestamp for every change.
 *  9. Validation + rounding: integer tetri/bps only, bounds enforced,
 *     exact decimal parsing, floor-to-partner rounding that always sums to
 *     gross; the DB refuses non-positive prices and in-place price edits.
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
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return { ok: false, error: [err.message, err.cause?.message].filter(Boolean).join(" | ") || String(e) };
  }
}

async function main() {
  console.log("Setting up fixtures (superuser)...");
  const adminUserId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  const plainUserId = crypto.randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;

  async function newPartner(label: string, bps = 3000) {
    const id = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    await admin`insert into partners (id, slug, name, commission_rate_bps, status) values (${id}, ${`pp-${label}-${id.slice(0, 8)}`}, ${`Pricing ${label}`}, ${bps}, 'ACTIVE')`;
    await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${id}, ${`pricing-${label}`}, 50)`;
    return { id, batchId };
  }
  async function newGreeting(p: { id: string; batchId: string }) {
    const qrId = crypto.randomUUID();
    const token = generatePublicToken();
    await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values (${qrId}, ${token}, ${p.batchId}, ${p.id}, 'AVAILABLE')`;
    const { greetingId, editToken } = await startGreeting(token);
    await updateGreetingMessage(greetingId, editToken, "Partner pricing test message");
    return { greetingId, editToken };
  }
  async function checkout(p: { id: string; batchId: string }) {
    const g = await newGreeting(p);
    const { summary } = await getOrCreateCheckoutOrder(g.greetingId, g.editToken);
    return { ...g, orderId: summary.orderId, summary };
  }
  const orderRow = async (orderId: string) =>
    (await admin`select gross_amount_minor, partner_commission_minor, platform_share_minor, commission_rate_bps, price_id, status from orders where id = ${orderId}`)[0]!;
  async function pay(orderId: string) {
    const [o] = await admin`select gross_amount_minor, currency from orders where id = ${orderId}`;
    const [p] = await admin`select provider_payment_id from payments where order_id = ${orderId} and status = 'PENDING' order by created_at desc limit 1`;
    return settleConfirmedPayment(
      await confirmPaymentSuccess({ provider: "TEST", providerPaymentId: p!.provider_payment_id, orderId, amountMinor: o!.gross_amount_minor, currency: o!.currency }),
    );
  }
  const asAdmin = <T>(fn: (tx: import("../src/db/client").Tx) => Promise<T>) => withAdminContext(adminUserId, fn);
  const pricingOf = (partnerId: string) => asAdmin((tx) => pricingAdmin.getPartnerPricing(tx, partnerId));

  const original = await asAdmin((tx) => pricingAdmin.getDefaultPricing(tx));
  if (original.amountMinor === null) throw new Error("No active default price — run db:seed first");
  const originalDefault = original.amountMinor;
  // A known, distinctive default for the duration of the suite (restored at the end).
  const TEST_DEFAULT = 1000;
  let currentDefault = originalDefault;
  async function setDefault(amountMinor: number) {
    await asAdmin((tx) => pricingAdmin.setDefaultPrice(tx, adminUserId, { amountMinor, expectedAmountMinor: currentDefault }));
    currentDefault = amountMinor;
  }

  try {
    await setDefault(TEST_DEFAULT);

    const A = await newPartner("a", 3000);
    const B = await newPartner("b", 3000);
    await admin`insert into partner_members (partner_id, user_id, role) values (${A.id}, ${ownerUserId}, 'OWNER')`;

    console.log("\n--- 1. Global default price ---");
    let a1: Awaited<ReturnType<typeof checkout>>;
    {
      const pricing = await pricingOf(A.id);
      check("1a. No custom price → source DEFAULT at 10.00 GEL", pricing.source === "DEFAULT" && pricing.effectivePriceMinor === 1000, JSON.stringify(pricing));
      check("1b. Preview split at 30%: 3.00 partner / 7.00 platform", pricing.partnerAmountMinor === 300 && pricing.platformAmountMinor === 700);
      a1 = await checkout(A);
      const o = await orderRow(a1.orderId);
      check("1c. Checkout snapshots 1000 / 300 / 700 at 3000 bps", o.gross_amount_minor === 1000 && o.partner_commission_minor === 300 && o.platform_share_minor === 700 && o.commission_rate_bps === 3000, JSON.stringify(o));
      const [pr] = await admin`select partner_id, amount_minor from prices where id = ${o.price_id}`;
      check("1d. order.price_id is the platform-default row", pr?.partner_id === null && pr?.amount_minor === 1000);

      await setDefault(1200);
      const b1 = await checkout(B);
      check("1e. After a default change, a new checkout uses the new default", (await orderRow(b1.orderId)).gross_amount_minor === 1200);
      check("1f. …and the earlier open order still carries 1000", (await orderRow(a1.orderId)).gross_amount_minor === 1000);
      const [{ n }] = (await admin`select count(*)::int as n from prices p join products pr on pr.id = p.product_id where pr.key = 'PREMIUM_GREETING' and p.partner_id is null and p.active`) as unknown as [{ n: number }];
      check("1g. Exactly one active default price row", n === 1, `n=${n}`);
      await setDefault(TEST_DEFAULT);
    }

    console.log("\n--- 2. Custom partner price ---");
    let a2: Awaited<ReturnType<typeof checkout>>;
    {
      const r = await asAdmin((tx) => pricingAdmin.setPartnerPrice(tx, adminUserId, A.id, { amountMinor: 1500, expectedAmountMinor: null }));
      check("2a. Admin sets a 15.00 GEL custom price", r.changed);
      const pricing = await pricingOf(A.id);
      check("2b. Source PARTNER at 1500, split 450 / 1050", pricing.source === "PARTNER" && pricing.effectivePriceMinor === 1500 && pricing.partnerAmountMinor === 450 && pricing.platformAmountMinor === 1050, JSON.stringify(pricing));
      const display = await getDefaultProductPrice(A.id);
      check("2c. Customer-facing display price is 1500", display?.amountMinor === 1500);
      a2 = await checkout(A);
      const o = await orderRow(a2.orderId);
      check("2d. Checkout charges and snapshots the custom price", o.gross_amount_minor === 1500 && o.partner_commission_minor === 450 && o.platform_share_minor === 1050);
      check("2e. Customer-visible summary amount == snapshot", a2.summary.grossAmountMinor === 1500);
      const [pr] = await admin`select partner_id from prices where id = ${o.price_id}`;
      check("2f. order.price_id is A's override row", pr?.partner_id === A.id);
      check("2g. Partner B (no override) is unaffected", (await getDefaultProductPrice(B.id))?.amountMinor === 1000 && (await pricingOf(B.id)).source === "DEFAULT");

      await asAdmin((tx) => pricingAdmin.setPartnerPrice(tx, adminUserId, A.id, { amountMinor: 1800, expectedAmountMinor: 1500 }));
      const rows = await admin`select amount_minor, active from prices where partner_id = ${A.id} order by created_at`;
      check("2h. A price change deactivates the old row and inserts a new one (history kept)", rows.length === 2 && rows[0]!.active === false && rows[0]!.amount_minor === 1500 && rows[1]!.active === true && rows[1]!.amount_minor === 1800, JSON.stringify(rows));
      check("2i. …and the 1500 order still points at the (now inactive) 1500 row", (await admin`select amount_minor from prices where id = ${o.price_id}`)[0]?.amount_minor === 1500);

      const cleared = await asAdmin((tx) => pricingAdmin.setPartnerPrice(tx, adminUserId, A.id, { amountMinor: null, expectedAmountMinor: 1800 }));
      check("2j. Clearing the override returns A to the default", cleared.changed && (await pricingOf(A.id)).source === "DEFAULT" && (await getDefaultProductPrice(A.id))?.amountMinor === 1000);
      const same = await asAdmin((tx) => pricingAdmin.setPartnerPrice(tx, adminUserId, A.id, { amountMinor: null, expectedAmountMinor: null }));
      check("2k. Re-saving the same value is a no-op (no audit noise)", !same.changed);
    }

    console.log("\n--- 3. Commission per partner ---");
    {
      await asAdmin((tx) => pricingAdmin.setPartnerCommission(tx, adminUserId, B.id, { commissionRateBps: 2550, expectedCommissionRateBps: 3000 }));
      await asAdmin((tx) => pricingAdmin.setPartnerPrice(tx, adminUserId, B.id, { amountMinor: 999, expectedAmountMinor: null }));
      const b = await checkout(B);
      const o = await orderRow(b.orderId);
      // 999 × 2550 / 10000 = 254.745 → floor 254; platform gets 745.
      check("3a. Odd price × fractional rate rounds the partner share down (254 / 745)", o.partner_commission_minor === 254 && o.platform_share_minor === 745 && o.commission_rate_bps === 2550, JSON.stringify(o));
      check("3b. Partner A's rate is independent (still 3000)", (await pricingOf(A.id)).commissionRateBps === 3000);
    }

    console.log("\n--- 4. Snapshots survive pricing changes ---");
    {
      // a2: open 1500 order on A. a1: open 1000 order on A (default). Pay a1 now.
      const settled = await pay(a1.orderId);
      check("4a. Paying the original default order succeeds", settled.status === "PAID");
      const before = { a1: await orderRow(a1.orderId), a2: await orderRow(a2.orderId) };

      await asAdmin((tx) => pricingAdmin.setPartnerCommission(tx, adminUserId, A.id, { commissionRateBps: 5000, expectedCommissionRateBps: 3000 }));
      await asAdmin((tx) => pricingAdmin.setPartnerPrice(tx, adminUserId, A.id, { amountMinor: 2500, expectedAmountMinor: null }));
      await setDefault(1300);

      const after = { a1: await orderRow(a1.orderId), a2: await orderRow(a2.orderId) };
      check("4b. PAID order snapshot unchanged", JSON.stringify(before.a1) === JSON.stringify(after.a1), JSON.stringify(after.a1));
      check("4c. Open (unpaid) order snapshot unchanged", JSON.stringify(before.a2) === JSON.stringify(after.a2), JSON.stringify(after.a2));
      const reentry = await getOrCreateCheckoutOrder(a2.greetingId, a2.editToken);
      check("4d. Re-entering checkout reuses the open order at its snapshot price", reentry.summary.orderId === a2.orderId && reentry.summary.grossAmountMinor === 1500);
      const paid = await pay(a2.orderId);
      const [ledger] = await admin`select amount_minor from partner_ledger_entries where order_id = ${a2.orderId} and type = 'COMMISSION_EARNED'`;
      check("4e. Paid at 1500 with the snapshotted 450 commission (not 50% of 2500)", paid.status === "PAID" && ledger?.amount_minor === 450, `ledger=${ledger?.amount_minor}`);
      const fresh = await checkout(A);
      const fo = await orderRow(fresh.orderId);
      check("4f. A new checkout uses the new price and rate (2500 / 1250 / 1250 @ 5000)", fo.gross_amount_minor === 2500 && fo.partner_commission_minor === 1250 && fo.commission_rate_bps === 5000, JSON.stringify(fo));
      const tamper = await attempt(() => admin`update orders set gross_amount_minor = 2500 where id = ${a2.orderId}`);
      check("4g. Even the superuser can't rewrite an order snapshot (0013)", !tamper.ok);
      await setDefault(TEST_DEFAULT);
    }

    console.log("\n--- 5. Refunds reverse the snapshot ---");
    {
      await refundPaidOrder(adminUserId, a1.orderId);
      const [rev] = await admin`select amount_minor from partner_ledger_entries where order_id = ${a1.orderId} and type = 'COMMISSION_REVERSAL'`;
      check("5a. Refund of the 1000 @ 30% order reverses −300 (A is now at 50%)", rev?.amount_minor === -300, `reversal=${rev?.amount_minor}`);
      await refundPaidOrder(adminUserId, a2.orderId);
      const [rev2] = await admin`select amount_minor from partner_ledger_entries where order_id = ${a2.orderId} and type = 'COMMISSION_REVERSAL'`;
      check("5b. Refund of the 1500 order reverses −450", rev2?.amount_minor === -450);
      const [bal] = await admin`select coalesce(sum(amount_minor), 0)::int as s from partner_ledger_entries where partner_id = ${A.id}`;
      check("5c. A's net ledger after earn + reverse is 0", bal?.s === 0, `sum=${bal?.s}`);
    }

    console.log("\n--- 6. Authorization ---");
    {
      const svc = await attempt(() => withPartnerContext(ownerUserId, A.id, (tx) => pricingAdmin.setPartnerCommission(tx, ownerUserId, A.id, { commissionRateBps: 9000, expectedCommissionRateBps: 5000 })));
      check("6a. Partner OWNER can't set its commission via the service", !svc.ok && svc.error.includes("platform admin"), svc.ok ? "succeeded" : svc.error);
      const svcPrice = await attempt(() => withPartnerContext(ownerUserId, A.id, (tx) => pricingAdmin.setPartnerPrice(tx, ownerUserId, A.id, { amountMinor: 100, expectedAmountMinor: 2500 })));
      check("6b. Partner OWNER can't set its price via the service", !svcPrice.ok);
      const plain = await attempt(() => withUserContext(plainUserId, (tx) => pricingAdmin.setDefaultPrice(tx, plainUserId, { amountMinor: 100, expectedAmountMinor: TEST_DEFAULT })));
      check("6c. A signed-in non-admin can't set the default price", !plain.ok);
      const readOverview = await attempt(() => withPartnerContext(ownerUserId, A.id, (tx) => pricingAdmin.getPartnerPricing(tx, A.id)));
      check("6d. Pricing management reads are admin-only too", !readOverview.ok);

      const rawCommission = await attempt(() =>
        withPartnerContext(ownerUserId, A.id, (tx) => tx.update(schema.partners).set({ commissionRateBps: 10000 }).where(eq(schema.partners.id, A.id))),
      );
      check("6e. Raw SQL: OWNER updating its own commission_rate_bps is refused (0018 trigger)", !rawCommission.ok && rawCommission.error.includes("platform admin"), rawCommission.ok ? "succeeded" : rawCommission.error);
      const rename = await attempt(() =>
        withPartnerContext(ownerUserId, A.id, (tx) => tx.update(schema.partners).set({ name: "Renamed by owner" }).where(eq(schema.partners.id, A.id)).returning({ id: schema.partners.id })),
      );
      check("6f. …while the OWNER can still edit its own name", rename.ok && rename.value.length === 1);
      const [{ commission_rate_bps: bpsNow }] = (await admin`select commission_rate_bps from partners where id = ${A.id}`) as unknown as [{ commission_rate_bps: number }];
      check("6g. Commission still 5000", bpsNow === 5000);

      const [product] = await admin`select id from products where key = 'PREMIUM_GREETING'`;
      const rawPrice = await attempt(() =>
        withPartnerContext(ownerUserId, A.id, (tx) => tx.insert(schema.prices).values({ productId: product!.id, partnerId: A.id, currency: "GEL", amountMinor: 100, active: false })),
      );
      check("6h. Raw SQL: OWNER inserting a price row is refused (RLS)", !rawPrice.ok);
      const rawDeactivate = await attempt(() =>
        withPartnerContext(ownerUserId, A.id, (tx) => tx.update(schema.prices).set({ active: false }).where(eq(schema.prices.partnerId, A.id)).returning({ id: schema.prices.id })),
      );
      check("6i. Raw SQL: OWNER deactivating its price row changes nothing (RLS)", !rawDeactivate.ok || rawDeactivate.value.length === 0);
      const publicPrice = await attempt(() => withPublicContext((tx) => tx.insert(schema.prices).values({ productId: product!.id, partnerId: null, currency: "GEL", amountMinor: 1, active: false })));
      check("6j. Public context can't insert a price", !publicPrice.ok);
      const generic = updatePartnerSchema.parse({ name: "x", commissionRateBps: 9999 });
      check("6k. Generic partner-update schema drops commissionRateBps", !("commissionRateBps" in generic));
      check("6l. Partner A still at 2500 / 5000 after all attempts", (await pricingOf(A.id)).effectivePriceMinor === 2500 && (await pricingOf(A.id)).commissionRateBps === 5000);
    }

    console.log("\n--- 7. Concurrent updates ---");
    {
      const C = await newPartner("c", 3000);
      const auditBefore = (await admin`select count(*)::int as n from audit_logs where target_id = ${C.id} and action like 'PRICING_%'`)[0]!.n as number;
      const rates = [1000, 2000, 4000, 6000, 8000];
      const results = await Promise.allSettled(
        rates.map((r) => asAdmin((tx) => pricingAdmin.setPartnerCommission(tx, adminUserId, C.id, { commissionRateBps: r, expectedCommissionRateBps: 3000 }))),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const conflicts = results.filter((r) => r.status === "rejected" && r.reason instanceof pricingAdmin.PricingConflictError).length;
      check("7a. Five simultaneous commission edits from 3000 → exactly one applied", ok === 1, `ok=${ok}`);
      check("7b. …the other four refused as stale (PricingConflictError)", conflicts === 4, `conflicts=${conflicts}`);
      const [cRow] = await admin`select commission_rate_bps from partners where id = ${C.id}`;
      check("7c. The stored rate is one of the attempted values", rates.includes(cRow!.commission_rate_bps));

      const prices = [1100, 1200, 1300, 1400, 1500];
      const priceResults = await Promise.allSettled(
        prices.map((p) => asAdmin((tx) => pricingAdmin.setPartnerPrice(tx, adminUserId, C.id, { amountMinor: p, expectedAmountMinor: null }))),
      );
      const priceOk = priceResults.filter((r) => r.status === "fulfilled").length;
      const active = await admin`select amount_minor from prices where partner_id = ${C.id} and active`;
      check("7d. Five simultaneous custom-price edits → exactly one applied, one active row", priceOk === 1 && active.length === 1, `ok=${priceOk} active=${active.length}`);

      const auditAfter = (await admin`select count(*)::int as n from audit_logs where target_id = ${C.id} and action like 'PRICING_%'`)[0]!.n as number;
      check("7e. Exactly one audit row per applied change (2)", auditAfter - auditBefore === 2, `delta=${auditAfter - auditBefore}`);

      const [product] = await admin`select id from products where key = 'PREMIUM_GREETING'`;
      const dupe = await attempt(() => admin`insert into prices (product_id, partner_id, currency, amount_minor) values (${product!.id}, ${C.id}, 'GEL', 1600)`);
      check("7f. DB refuses a second active override for the same partner (even as superuser)", !dupe.ok);
      const dupeDefault = await attempt(() => admin`insert into prices (product_id, partner_id, currency, amount_minor) values (${product!.id}, null, 'GEL', 1600)`);
      check("7g. DB refuses a second active platform default", !dupeDefault.ok);

      const defaults = [1010, 1020, 1030];
      const defaultResults = await Promise.allSettled(
        defaults.map((p) => asAdmin((tx) => pricingAdmin.setDefaultPrice(tx, adminUserId, { amountMinor: p, expectedAmountMinor: TEST_DEFAULT }))),
      );
      const winner = defaultResults.findIndex((r) => r.status === "fulfilled");
      check("7h. Three simultaneous default-price edits → exactly one applied", defaultResults.filter((r) => r.status === "fulfilled").length === 1);
      if (winner >= 0) currentDefault = defaults[winner]!;
      await setDefault(TEST_DEFAULT);

      const stale = await attempt(() => asAdmin((tx) => pricingAdmin.setPartnerCommission(tx, adminUserId, C.id, { commissionRateBps: 3000, expectedCommissionRateBps: 3000 })));
      check("7i. A later save based on the old value is refused, not silently applied", !stale.ok && stale.error.includes("changed by someone else"));
    }

    console.log("\n--- 8. Audit trail ---");
    {
      const rows = await admin`select actor_type, actor_id, action, metadata, created_at from audit_logs where target_type = 'partner' and target_id = ${A.id} and action like 'PRICING_%' order by created_at`;
      const actions = rows.map((r) => r.action);
      check(
        "8a. Every A pricing change is audited in order",
        JSON.stringify(actions) ===
          JSON.stringify(["PRICING_PARTNER_PRICE_SET", "PRICING_PARTNER_PRICE_SET", "PRICING_PARTNER_PRICE_CLEARED", "PRICING_PARTNER_COMMISSION_UPDATED", "PRICING_PARTNER_PRICE_SET"]),
        JSON.stringify(actions),
      );
      check("8b. Actor is the admin user", rows.every((r) => r.actor_type === "ADMIN" && r.actor_id === adminUserId));
      const m = rows.map((r) => [r.metadata.oldValue, r.metadata.newValue]);
      check("8c. Old and new values recorded", JSON.stringify(m) === JSON.stringify([[null, 1500], [1500, 1800], [1800, null], [3000, 5000], [null, 2500]]), JSON.stringify(m));
      check("8d. Each row has a timestamp", rows.every((r) => r.created_at instanceof Date));
      const history = await asAdmin((tx) => pricingAdmin.listPricingAuditLog(tx, A.id));
      check("8e. Admin history read returns them newest first", history.length === 5 && history[0]!.action === "PRICING_PARTNER_PRICE_SET" && history[0]!.newValue === 2500);
      const refusedLeftNoTrace = await admin`select 1 from audit_logs where actor_id = ${ownerUserId} and action like 'PRICING_%'`;
      check("8f. Refused attempts left no pricing audit row", refusedLeftNoTrace.length === 0);
      const defaultAudit = await admin`select metadata from audit_logs where action = 'PRICING_DEFAULT_PRICE_UPDATED' and actor_id = ${adminUserId} and target_type = 'product' order by created_at`;
      check(
        "8g. Default price changes are audited with old → new (1000 → 1200 from 1e)",
        defaultAudit.some((r) => r.metadata.oldValue === TEST_DEFAULT && r.metadata.newValue === 1200),
        JSON.stringify(defaultAudit.map((r) => r.metadata)),
      );
    }

    console.log("\n--- 9. Validation and rounding ---");
    {
      const bad = [
        validation.setPartnerPriceSchema.safeParse({ amountMinor: 12.5, expectedAmountMinor: null }),
        validation.setPartnerPriceSchema.safeParse({ amountMinor: 0, expectedAmountMinor: null }),
        validation.setPartnerPriceSchema.safeParse({ amountMinor: -100, expectedAmountMinor: null }),
        validation.setPartnerPriceSchema.safeParse({ amountMinor: split.MAX_PRICE_MINOR + 1, expectedAmountMinor: null }),
        validation.setPartnerPriceSchema.safeParse({ amountMinor: "1000", expectedAmountMinor: null }),
        validation.setPartnerCommissionSchema.safeParse({ commissionRateBps: 10001, expectedCommissionRateBps: 0 }),
        validation.setPartnerCommissionSchema.safeParse({ commissionRateBps: 30.5, expectedCommissionRateBps: 0 }),
        validation.setPartnerCommissionSchema.safeParse({ commissionRateBps: -1, expectedCommissionRateBps: 0 }),
        validation.setDefaultPriceSchema.safeParse({ amountMinor: 50, expectedAmountMinor: 1000 }),
      ];
      check("9a. Schemas reject fractional, zero, negative, oversized, string and out-of-range values", bad.every((r) => !r.success));
      check("9b. Schemas accept valid integer tetri / bps", validation.setPartnerPriceSchema.safeParse({ amountMinor: 1250, expectedAmountMinor: null }).success && validation.setPartnerCommissionSchema.safeParse({ commissionRateBps: 3050, expectedCommissionRateBps: 3000 }).success);

      const parses: [string, number | null][] = [["10", 1000], ["12.5", 1250], ["12,50", 1250], ["0.01", 1], ["12.345", null], ["-1", null], ["1e3", null], ["", null], ["abc", null]];
      check("9c. parseMajorToMinor is exact", parses.every(([s, v]) => split.parseMajorToMinor(s) === v), JSON.stringify(parses.map(([s]) => split.parseMajorToMinor(s))));
      const pct: [string, number | null][] = [["30", 3000], ["30.5", 3050], ["12.25", 1225], ["0", 0], ["100", 10000], ["100.01", null], ["33.333", null]];
      check("9d. parsePercentToBps is exact and bounded", pct.every(([s, v]) => split.parsePercentToBps(s) === v));
      check("9e. formatBpsAsPercent round-trips", [0, 1, 10, 1225, 3000, 3050, 10000].every((b) => split.parsePercentToBps(split.formatBpsAsPercent(b)) === b));

      let sumsOk = true;
      let floorOk = true;
      for (let gross = split.MIN_PRICE_MINOR; gross <= 5000; gross += 7) {
        for (const bps of [0, 1, 333, 2550, 3000, 3333, 6667, 9999, 10000]) {
          const s = split.splitCommission(gross, bps);
          if (s.partnerCommissionMinor + s.platformShareMinor !== gross) sumsOk = false;
          if (s.partnerCommissionMinor !== Math.floor((gross * bps) / 10000) || s.partnerCommissionMinor < 0 || s.platformShareMinor < 0) floorOk = false;
        }
      }
      check("9f. Split always sums to gross (property over ~700 prices × 9 rates)", sumsOk);
      check("9g. Partner share is always floor(gross × bps / 10000)", floorOk);
      check("9h. Max price at 100% stays exact", JSON.stringify(split.splitCommission(split.MAX_PRICE_MINOR, 10000)) === JSON.stringify({ partnerCommissionMinor: split.MAX_PRICE_MINOR, platformShareMinor: 0 }));
      const nonInt = [() => split.splitCommission(10.5, 3000), () => split.splitCommission(1000, 30.5), () => split.splitCommission(1000, 10001), () => split.splitCommission(-1, 3000)];
      check("9i. splitCommission refuses non-integer / out-of-range input", nonInt.every((f) => { try { f(); return false; } catch { return true; } }));

      const [product] = await admin`select id from products where key = 'PREMIUM_GREETING'`;
      const zero = await attempt(() => admin`insert into prices (product_id, partner_id, currency, amount_minor, active) values (${product!.id}, null, 'GEL', 0, false)`);
      check("9j. DB refuses a zero price (prices_amount_minor_positive)", !zero.ok);
      const inPlace = await attempt(() =>
        asAdmin((tx) => tx.update(schema.prices).set({ amountMinor: 1 }).where(dsql`${schema.prices.partnerId} = ${A.id} and ${schema.prices.active}`)),
      );
      check("9k. App role can't edit a price row in place, even as admin (0018 trigger)", !inPlace.ok && inPlace.error.includes("immutable"), inPlace.ok ? "succeeded" : inPlace.error);
      const outOfRange = await attempt(() => asAdmin((tx) => pricingAdmin.setPartnerCommission(tx, adminUserId, A.id, { commissionRateBps: 10001, expectedCommissionRateBps: 5000 })));
      check("9l. DB refuses a commission above 100% even past app validation", !outOfRange.ok);
    }
  } finally {
    // Leave the platform default exactly as it was found.
    if (currentDefault !== originalDefault) {
      await asAdmin((tx) => pricingAdmin.setDefaultPrice(tx, adminUserId, { amountMinor: originalDefault, expectedAmountMinor: currentDefault }));
    }
    await admin.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end().catch(() => undefined);
  process.exit(1);
});

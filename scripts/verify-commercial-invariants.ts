import Module from "node:module";

// `import "server-only"` throws when required outside Next's bundler, which
// is the ONLY thing that special-cases it into a no-op. That's correct
// production behavior we do not want to weaken on disk — instead, patch
// module resolution for this standalone verification process only, so it can
// still exercise the real, unmodified service/lib code. Must run before the
// `require()` calls below (this file compiles to CJS, so statement order is
// preserved — unlike hoisted ESM `import`, which is why these are require()).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const postgres = require("postgres") as typeof import("postgres");
const { eq, sql } = require("drizzle-orm") as typeof import("drizzle-orm");

const { generateEditToken, hashEditToken } = require("../src/lib/security/edit-token") as typeof import("../src/lib/security/edit-token");
const { generatePublicToken } = require("../src/lib/security/public-token") as typeof import("../src/lib/security/public-token");
const { startCheckout, confirmPaymentSuccess, activatePaidOrder } = require("../src/lib/payments/service") as typeof import("../src/lib/payments/service");
const { db, withPartnerContext, withEditableGreeting } = require("../src/db/client") as typeof import("../src/db/client");
const { orders, payments, partnerLedgerEntries, greetings, qrCodes } = require("../src/db/schema") as typeof import("../src/db/schema");

/**
 * Phase 0.5 §13 verification: exercises the REAL service functions and the
 * REAL app_runtime RLS role (never the superuser) against the live local DB.
 * Fixture setup alone uses the superuser connection (MIGRATIONS_DATABASE_URL)
 * — never the thing under test.
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

async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  console.log("Setting up fixtures (superuser)...");

  const partnerA = crypto.randomUUID();
  const partnerB = crypto.randomUUID();
  const partnerAUserId = crypto.randomUUID();
  const partnerBUserId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const qrA = crypto.randomUUID();
  const qrAToken = generatePublicToken();
  const greetingA = crypto.randomUUID();
  const editTokenA = generateEditToken();
  const qrOther = crypto.randomUUID();
  const qrOtherToken = generatePublicToken();
  const greetingUnpaid = crypto.randomUUID();
  const editTokenUnpaid = generateEditToken();

  const [product] = await admin`select id from products where key = 'PHOTO_GREETING' limit 1`;
  const [theme] = await admin`select id from themes where key = 'minimal' limit 1`;
  if (!product || !theme) throw new Error("Seed data missing — run npm run db:seed first");

  await admin`insert into partners (id, slug, name, commission_rate_bps) values
    (${partnerA}, ${"verify-partner-a-" + partnerA.slice(0, 8)}, 'Verify Partner A', 3000)`;
  await admin`insert into partners (id, slug, name, commission_rate_bps) values
    (${partnerB}, ${"verify-partner-b-" + partnerB.slice(0, 8)}, 'Verify Partner B', 2000)`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerA}, ${partnerAUserId}, 'OWNER')`;
  await admin`insert into partner_members (partner_id, user_id, role) values (${partnerB}, ${partnerBUserId}, 'OWNER')`;

  await admin`insert into qr_batches (id, partner_id, label, quantity) values (${batchId}, ${partnerA}, 'verify-batch', 2)`;
  await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values
    (${qrA}, ${qrAToken}, ${batchId}, ${partnerA}, 'DRAFT')`;
  await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values
    (${greetingA}, ${qrA}, ${theme.id}, ${product.id}, 'DRAFT', ${hashEditToken(editTokenA)})`;

  await admin`insert into qr_codes (id, public_token, batch_id, partner_id, status) values
    (${qrOther}, ${qrOtherToken}, ${batchId}, ${partnerA}, 'DRAFT')`;
  await admin`insert into greetings (id, qr_code_id, theme_id, product_id, status, edit_token_hash) values
    (${greetingUnpaid}, ${qrOther}, ${theme.id}, ${product.id}, 'DRAFT', ${hashEditToken(editTokenUnpaid)})`;
  // A message is required before checkout (migrations/0011 purchase eligibility).
  await admin`insert into greeting_content (greeting_id, type, slot, text_value, status) values
    (${greetingA}, 'text', 0, 'verify message', 'READY'), (${greetingUnpaid}, 'text', 0, 'verify message', 'READY')`;

  console.log("\n--- Attribution & checkout ---");

  const { order } = await startCheckout({ greetingId: greetingA, editToken: editTokenA, productId: product.id });
  check("8. Partner attribution comes from the QR, not client input", order.partnerId === partnerA);
  check("   order snapshots gross/commission/platform amounts", order.grossAmountMinor > 0 && order.partnerCommissionMinor + order.platformShareMinor === order.grossAmountMinor);

  const grossBeforePriceChange = order.grossAmountMinor;
  const commissionBeforePriceChange = order.partnerCommissionMinor;

  // Mutate the live price AND the partner's commission rate after the order
  // was created — the already-created order must not be affected.
  await admin`update prices set amount_minor = amount_minor + 12345 where product_id = ${product.id} and partner_id is null`;
  await admin`update partners set commission_rate_bps = 9999 where id = ${partnerA}`;

  const [orderReread] = await admin`select gross_amount_minor, partner_commission_minor from orders where id = ${order.id}`;
  check(
    "7. Order financial snapshot unchanged after price/commission change",
    orderReread?.gross_amount_minor === grossBeforePriceChange && orderReread?.partner_commission_minor === commissionBeforePriceChange,
  );

  console.log("\n--- Payment confirmation & commission ---");

  const providerPaymentId = `verify_${crypto.randomUUID()}`;
  const confirm1 = await confirmPaymentSuccess({
    provider: "TEST",
    providerPaymentId,
    orderId: order.id,
    amountMinor: order.grossAmountMinor,
    currency: order.currency,
  });
  check("payment confirmation succeeds and is not a duplicate", confirm1.alreadyProcessed === false);

  const ledgerAfterFirst = await admin`select amount_minor from partner_ledger_entries where order_id = ${order.id} and type = 'COMMISSION_EARNED'`;
  check("5. Successful payment produces exactly one commission entry", ledgerAfterFirst.length === 1);
  check("   commission amount matches the order snapshot", ledgerAfterFirst[0]?.amount_minor === order.partnerCommissionMinor);

  const confirm2 = await confirmPaymentSuccess({
    provider: "TEST",
    providerPaymentId,
    orderId: order.id,
    amountMinor: order.grossAmountMinor,
    currency: order.currency,
  });
  check("   duplicate confirmation is recognized as already-processed", confirm2.alreadyProcessed === true);

  const ledgerAfterDuplicate = await admin`select id from partner_ledger_entries where order_id = ${order.id} and type = 'COMMISSION_EARNED'`;
  check("6. Duplicate payment-success processing does not duplicate commission", ledgerAfterDuplicate.length === 1);

  const activation1 = await activatePaidOrder(order.id);
  check("payment-driven activation succeeds", activation1.activated === true);
  const [greetingRow] = await admin`select status from greetings where id = ${greetingA}`;
  const [qrRow] = await admin`select status from qr_codes where id = ${qrA}`;
  check("greeting flips to ACTIVE only via payment activation", greetingRow?.status === "ACTIVE");
  check("qr flips to ACTIVE only via payment activation", qrRow?.status === "ACTIVE");

  const activation2 = await activatePaidOrder(order.id);
  check("activation is idempotent (second call is a no-op, not an error)", activation2.activated === false);

  console.log("\n--- Client cannot self-activate an unpaid greeting ---");

  const selfActivateGreeting = await expectThrows(() =>
    withEditableGreeting(greetingUnpaid, (tx) =>
      tx.update(greetings).set({ status: "ACTIVE" }).where(eq(greetings.id, greetingUnpaid)),
    ),
  );
  check("4. Client (sender edit-token context) cannot set Greeting to ACTIVE", selfActivateGreeting);

  const selfActivateQr = await expectThrows(() =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.claimable_qr_id', ${qrOther}, true)`);
      await tx.update(qrCodes).set({ status: "ACTIVE" }).where(eq(qrCodes.id, qrOther));
    }),
  );
  check("   Client (QR claim context) cannot set QR to ACTIVE", selfActivateQr);

  console.log("\n--- Partner cannot forge payment success ---");

  const partnerOrderUpdate = await withPartnerContext(partnerAUserId, partnerA, (tx) =>
    tx.update(orders).set({ status: "PAID" }).where(eq(orders.id, order.id)).returning(),
  );
  check("3. Partner context cannot UPDATE an order to PAID", partnerOrderUpdate.length === 0);

  const partnerPaymentInsert = await expectThrows(() =>
    withPartnerContext(partnerAUserId, partnerA, (tx) =>
      tx.insert(payments).values({
        orderId: order.id,
        provider: "TEST",
        providerPaymentId: `forged_${crypto.randomUUID()}`,
        amountMinor: order.grossAmountMinor,
        currency: order.currency,
        status: "SUCCEEDED",
      }),
    ),
  );
  check("   Partner context cannot INSERT a fake SUCCEEDED payment", partnerPaymentInsert);

  console.log("\n--- Cross-tenant isolation (orders / ledger) ---");

  const partnerBOrders = await withPartnerContext(partnerBUserId, partnerB, (tx) =>
    tx.select().from(orders).where(eq(orders.partnerId, partnerA)),
  );
  check("1. Partner B cannot see Partner A's orders", partnerBOrders.length === 0);

  const partnerBLedger = await withPartnerContext(partnerBUserId, partnerB, (tx) =>
    tx.select().from(partnerLedgerEntries).where(eq(partnerLedgerEntries.partnerId, partnerA)),
  );
  check("2. Partner B cannot see Partner A's ledger entries", partnerBLedger.length === 0);

  const partnerAOwnOrders = await withPartnerContext(partnerAUserId, partnerA, (tx) =>
    tx.select().from(orders).where(eq(orders.id, order.id)),
  );
  check("   (sanity) Partner A CAN see its own order", partnerAOwnOrders.length === 1);

  console.log("\nCleaning up fixtures...");
  await admin`delete from partner_ledger_entries where partner_id in (${partnerA}, ${partnerB})`;
  await admin`delete from payments where order_id = ${order.id}`;
  await admin`delete from orders where id = ${order.id}`;
  await admin`delete from greeting_content where greeting_id in (${greetingA}, ${greetingUnpaid})`;
  await admin`delete from greetings where id in (${greetingA}, ${greetingUnpaid})`;
  await admin`delete from qr_codes where id in (${qrA}, ${qrOther})`;
  await admin`delete from qr_batches where id = ${batchId}`;
  await admin`delete from partner_members where partner_id in (${partnerA}, ${partnerB})`;
  await admin`delete from partners where id in (${partnerA}, ${partnerB})`;
  await admin`update prices set amount_minor = amount_minor - 12345 where product_id = ${product.id} and partner_id is null`;

  await admin.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  // Explicit exit: the app_runtime pool opened transitively via
  // require("../src/db/client") keeps idle sockets open with no timeout, which
  // can leave this standalone process alive well after all checks have
  // completed instead of letting Node exit naturally once the event loop empties.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await admin.end();
  process.exit(1);
});

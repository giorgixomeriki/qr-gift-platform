/**
 * verify:checkout-legal-guard — real-money checkout opens only against FINAL
 * policies in force (lib/site/legal-readiness.ts, lib/payments/checkout-gate.ts).
 *
 * No database, no network. The real bundled copy is checked as it is today
 * (it must keep checkout closed), then variations prove each rule fails closed:
 * annotations in either language, unset merchant details or publication
 * approvals, a missing / future / malformed effective date, unreadable copy.
 * The gate itself (isCheckoutOpen, BOG provider, owner pilot) is exercised
 * end to end, and the test-only copy override is refused in production.
 */
import Module from "node:module";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

const PILOT = "00794e0b-9d14-4529-8c05-8a43f9bfb781";
const OTHER = "11111111-1111-4111-8111-111111111111";
const MERCHANT: Record<string, string> = {
  MERCHANT_LEGAL_NAME_KA: "ი/მ ტესტი", MERCHANT_LEGAL_NAME_EN: "IE Test", MERCHANT_ENTITY_TYPE: "IE",
  MERCHANT_ID_CODE: "01234567890", MERCHANT_PUBLISH_ID_CODE: "owner-approved",
  MERCHANT_LEGAL_ADDRESS_KA: "თბილისი, ტესტის ქ. 1", MERCHANT_LEGAL_ADDRESS_EN: "1 Test St, Tbilisi", MERCHANT_PUBLISH_LEGAL_ADDRESS: "owner-approved",
  MERCHANT_ACTUAL_ADDRESS_KA: "თბილისი, ტესტის ქ. 2", MERCHANT_ACTUAL_ADDRESS_EN: "2 Test St, Tbilisi",
  MERCHANT_SUPPORT_EMAIL: "support@verify.test", MERCHANT_PHONE: "+995555000000",
  MERCHANT_SUPPORT_HOURS_KA: "ორშ–პარ, 10:00–18:00", MERCHANT_SUPPORT_HOURS_EN: "Mon–Fri, 10:00–18:00",
};
// Noon in Tbilisi on 2026-11-26.
const NOW = new Date("2026-11-26T08:00:00Z");

async function main() {
  Object.assign(process.env, {
    PAYMENTS_PROVIDER: "BOG",
    BOG_CLIENT_ID: "qa-client",
    BOG_CLIENT_SECRET: "qa-secret",
    BOG_API_BASE_URL: "https://api.bog.ge/payments/v1",
    BOG_OAUTH_TOKEN_URL: "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token",
    BOG_WEBHOOK_SIGNING_KEY: (require("./lib-bog-simulator") as typeof import("./lib-bog-simulator")).publicKey.export({ type: "spki", format: "pem" }).toString(),
    CHECKOUT_ENABLED: "false",
    CHECKOUT_PILOT_QR_IDS: PILOT,
    BOG_REFUNDS_ENABLED: "false",
  });
  const L = require("../src/lib/site/legal-readiness") as typeof import("../src/lib/site/legal-readiness");
  const { loadMerchantInfo } = require("../src/lib/merchant/info") as typeof import("../src/lib/merchant/info");
  const info = (over: Record<string, string | undefined> = {}) => loadMerchantInfo({ ...MERCHANT, LEGAL_EFFECTIVE_DATE: "2026-11-26", ...over });
  const real = () => {
    L.setLegalCopyForTesting(null);
    return undefined;
  };
  const finalCopy = L.finalizedCopyForTesting();
  const kinds = (r: ReturnType<typeof L.legalReadiness>) => r.problems.map((p) => p.kind);
  type Copy = ReturnType<typeof L.finalizedCopyForTesting>;
  const clone = (c: Copy): Copy => JSON.parse(JSON.stringify(c));
  const addBlock = (c: Copy, locale: "ka" | "en", policy: "terms" | "privacy" | "refunds", block: Record<string, string>) => {
    const out = clone(c);
    ((out[locale][policy] as { sections: { blocks: unknown[] }[] }).sections[0]!.blocks).push(block);
    return out;
  };

  console.log("\n--- A. Today's real copy is final: only the date and merchant details decide ---");
  {
    real();
    const r = L.legalReadiness(info(), NOW);
    const ann = r.problems.filter((p) => p.kind === "annotations");
    check("A1. Real copy has no review or decision notes in any policy (ka + en)", ann.length === 0, ann);
    check("A2. Real copy + complete merchant details + date reached → ready", r.ready, r.problems);
    check("A3. Real copy without LEGAL_EFFECTIVE_DATE → not ready (no_date)",
      JSON.stringify(L.legalReadiness(info({ LEGAL_EFFECTIVE_DATE: undefined }), NOW).problems) === JSON.stringify([{ kind: "not_in_effect", detail: "no_date" }]));
    check("A4. Real copy names only merchant details the guard checks (phone unset → not ready)",
      kinds(L.legalReadiness(info({ MERCHANT_PHONE: undefined }), NOW)).includes("missing_merchant_detail"));
  }

  console.log("\n--- B. Final copy: every rule fails closed ---");
  {
    check("B1. Final copy + complete details + date reached → ready", L.legalReadiness(info(), NOW, finalCopy).ready, L.legalReadiness(info(), NOW, finalCopy).problems);
    check("B2. Date unset → not ready (no_date)", JSON.stringify(L.legalReadiness(info({ LEGAL_EFFECTIVE_DATE: undefined }), NOW, finalCopy).problems) === JSON.stringify([{ kind: "not_in_effect", detail: "no_date" }]));
    check("B3. Date tomorrow in Tbilisi → not ready (future_date)", kinds(L.legalReadiness(info({ LEGAL_EFFECTIVE_DATE: "2026-11-27" }), NOW, finalCopy)).join() === "not_in_effect");
    check("B4. Date = today in Tbilisi though still 'yesterday' in UTC (00:30 Tbilisi = 20:30Z) → ready",
      L.legalReadiness(info({ LEGAL_EFFECTIVE_DATE: "2026-11-26" }), new Date("2026-11-25T20:30:00Z"), finalCopy).ready);
    check("B5. Malformed dates are not a date (26.11.2026, 2026-13-40, 'today') → not ready",
      ["26.11.2026", "2026-13-40", "today"].every((d) => !L.legalReadiness(info({ LEGAL_EFFECTIVE_DATE: d }), NOW, finalCopy).ready));
    check("B6. One lawyer note left in Georgian Terms only → not ready",
      !L.legalReadiness(info(), NOW, addBlock(finalCopy, "ka", "terms", { type: "review", text: "x" })).ready);
    check("B7. One owner decision left in English Refunds only → not ready (names the ref)",
      (() => { const r = L.legalReadiness(info(), NOW, addBlock(finalCopy, "en", "refunds", { type: "decision", ref: "M6", text: "x" })); return !r.ready && L.describeLegalProblems(r.problems, NOW).includes("[M6]"); })());
    check("B8. A merchant detail the policies name is unset (phone) → not ready",
      kinds(L.legalReadiness(info({ MERCHANT_PHONE: undefined }), NOW, finalCopy)).includes("missing_merchant_detail"));
    check("B9. ID code set but its publication not approved → not ready",
      kinds(L.legalReadiness(info({ MERCHANT_PUBLISH_ID_CODE: undefined }), NOW, finalCopy)).includes("missing_merchant_detail"));
    const broken = clone(finalCopy);
    (broken.en as Record<string, unknown>).privacy = { lead: "x", sections: "not an array" };
    let threw = false;
    let rb: ReturnType<typeof L.legalReadiness> | null = null;
    try { rb = L.legalReadiness(info(), NOW, broken); } catch { threw = true; }
    check("B10. Unreadable policy copy → not ready, never throws", !threw && !!rb && !rb.ready && kinds(rb).includes("unreadable"));
    const noLocale = { ka: finalCopy.ka } as unknown as Copy;
    check("B11. A whole language missing → not ready", !L.legalReadiness(info(), NOW, noLocale).ready);
    check("B12. Problems summary carries no merchant values or copy text",
      (() => { const s = L.describeLegalProblems(L.legalReadiness(info({ MERCHANT_PHONE: undefined }), NOW, addBlock(finalCopy, "ka", "terms", { type: "review", text: "SECRET-NOTE" })).problems, NOW); return !s.includes("SECRET-NOTE") && !s.includes("support@verify.test") && !s.includes("01234567890"); })());
  }

  console.log("\n--- P. Policy pages say \"In effect\" on exactly the checkout answer ---");
  {
    real();
    check("P1. Real copy + complete details + date reached: pages say in effect", L.legalPackageInEffect(info(), NOW) === true);
    check("P1b. Real copy without a date: pages say NOT in effect", L.legalPackageInEffect(info({ LEGAL_EFFECTIVE_DATE: undefined }), NOW) === false);
    L.setLegalCopyForTesting(finalCopy);
    check("P2. Final copy + date reached: in effect", L.legalPackageInEffect(info(), NOW) === true);
    check("P3. Final copy + future date: not yet in effect", L.legalPackageInEffect(info({ LEGAL_EFFECTIVE_DATE: "2026-11-27" }), NOW) === false);
    check("P4. Final copy + a merchant detail unset: not in effect", L.legalPackageInEffect(info({ MERCHANT_PHONE: undefined }), NOW) === false);
    L.setLegalCopyForTesting(addBlock(finalCopy, "en", "privacy", { type: "review", text: "x" }));
    check("P5. One note in another policy keeps every policy page 'not yet in effect'", L.legalPackageInEffect(info(), NOW) === false);
    real();
  }

  console.log("\n--- C. The checkout gate (BOG provider, owner pilot) ---");
  {
    Object.assign(process.env, MERCHANT, { LEGAL_EFFECTIVE_DATE: "2026-01-01" });
    const { isCheckoutOpen, assertCheckoutOpen, CheckoutUnavailableError } = require("../src/lib/payments/checkout-gate") as typeof import("../src/lib/payments/checkout-gate");
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
    try {
      real();
      process.env.LEGAL_EFFECTIVE_DATE = "";
      check("C1. Real copy, no LEGAL_EFFECTIVE_DATE: the pilot card is CLOSED", isCheckoutOpen(PILOT) === false);
      let refused = false;
      try { assertCheckoutOpen(PILOT); } catch (e) { refused = e instanceof CheckoutUnavailableError; }
      check("C2. …assertCheckoutOpen refuses it (what every order / bank-payment step calls)", refused);
      isCheckoutOpen(PILOT);
      isCheckoutOpen(OTHER);
      check("C3. Logged once per distinct reason (LEGAL_NOT_READY), not per request", warns.filter((w) => w.includes("LEGAL_NOT_READY")).length === 1, warns.length);
      process.env.LEGAL_EFFECTIVE_DATE = "2026-01-01";
      check("C4. The log names refs and counts only, no copy text or merchant values",
        warns.every((w) => !w.includes("support@verify.test") && !w.includes("01234567890") && !w.includes("will be stated here")));

      L.setLegalCopyForTesting(finalCopy);
      check("C5. Final copy + date reached: the pilot card opens", isCheckoutOpen(PILOT) === true);
      check("C6. …every other card stays closed (CHECKOUT_ENABLED=false)", isCheckoutOpen(OTHER) === false && isCheckoutOpen() === false);
      process.env.LEGAL_EFFECTIVE_DATE = "";
      check("C7. Final copy but no date: closed", isCheckoutOpen(PILOT) === false);
      process.env.LEGAL_EFFECTIVE_DATE = "2026-01-01";
      process.env.MERCHANT_SUPPORT_EMAIL = "";
      check("C8. Final copy, date set, support email unset: closed", isCheckoutOpen(PILOT) === false);
      process.env.MERCHANT_SUPPORT_EMAIL = MERCHANT.MERCHANT_SUPPORT_EMAIL!;
      check("C9. Restored: open again (the gate is evaluated per request, nothing cached)", isCheckoutOpen(PILOT) === true);
      L.setLegalCopyForTesting(null);
      check("C10. Back to the real (final) copy with the date set: the pilot card opens", isCheckoutOpen(PILOT) === true);
      process.env.LEGAL_EFFECTIVE_DATE = "2999-01-01";
      check("C10b. Real copy, future date: closed again", isCheckoutOpen(PILOT) === false);
      process.env.LEGAL_EFFECTIVE_DATE = "2026-01-01";
    } finally {
      console.warn = origWarn;
    }

    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    let blocked = false;
    try { L.setLegalCopyForTesting(finalCopy); } catch { blocked = true; }
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    check("C11. The test-only copy override is refused in production", blocked);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

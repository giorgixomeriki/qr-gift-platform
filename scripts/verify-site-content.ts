import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Static checks for the public information pages (about, how it works,
 * pricing, contact and the three policies). No database or server needed.
 *
 *   A. KA and EN copy have the same structure, and every page parses.
 *   B. Every inline token and link is valid, and each KA string uses exactly
 *      the same tokens and links as its EN counterpart.
 *   C. KA copy is Georgian; EN copy has no Georgian.
 *   D. Every page in SITE_PAGES exists as a route, and vice versa.
 *   E. Merchant configuration: missing / invalid / complete.
 *   F. Pricing: no hard-coded amounts, no commissions, no tax claims; the
 *      standard-price selection rule.
 *   G. Copy that assumes a product fact matches the code.
 *   H. Every merchant-decision marker is documented in the requirements
 *      checklist.
 *   I. The fictional demo profile (MERCHANT_PROFILE=demo) is opt-in only,
 *      never mixes with real values, is refused on production, and is
 *      labelled.
 *
 * The rendered pages (both languages, footer, mobile menu, pricing against
 * the database) are covered by e2e/site-pages.spec.ts.
 */
const { parseInline, linksIn, merchantTokensIn } = require("../src/lib/site/inline") as typeof import("../src/lib/site/inline");
const { sectionsSchema, analyseSections } = require("../src/lib/site/document") as typeof import("../src/lib/site/document");
const { SITE_PAGES } = require("../src/lib/site/routes") as typeof import("../src/lib/site/routes");
const { parseMerchantInfo, loadMerchantInfo, resolveMerchantToken, MERCHANT_FIELDS, MERCHANT_TOKENS } = require("../src/lib/merchant/info") as typeof import("../src/lib/merchant/info");
const { DEMO_MERCHANT_ENV } = require("../src/lib/merchant/demo") as typeof import("../src/lib/merchant/demo");
const { pickStandardPrice } = require("../src/lib/merchant/standard-price") as typeof import("../src/lib/merchant/standard-price");
const { MEDIA_SLOT_LIMITS } = require("../src/lib/validation/content-types") as typeof import("../src/lib/validation/content-types");

const root = join(__dirname, "..");
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
const load = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, Json>;
const site = { ka: load("src/messages/site/ka.json"), en: load("src/messages/site/en.json") };
const app = { ka: load("src/messages/ka.json"), en: load("src/messages/en.json") };

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    const d = detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 600)}`;
    console.log(`  FAIL  ${name}${d}`);
  }
}

/** Structural signature: keys, array lengths, and the identifying fields of blocks/sections. */
function shapeDiffs(a: Json, b: Json, path: string, out: string[]) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return void out.push(`${path}: array length ${Array.isArray(a) ? a.length : "-"} vs ${Array.isArray(b) ? b.length : "-"}`);
    a.forEach((v, i) => shapeDiffs(v, b[i]!, `${path}[${i}]`, out));
    return;
  }
  if (a && typeof a === "object") {
    if (!b || typeof b !== "object") return void out.push(`${path}: object vs ${typeof b}`);
    const ka = Object.keys(a).sort().join(",");
    const kb = Object.keys(b).sort().join(",");
    if (ka !== kb) return void out.push(`${path}: keys [${ka}] vs [${kb}]`);
    for (const k of Object.keys(a)) {
      const va = (a as Record<string, Json>)[k]!;
      const vb = (b as Record<string, Json>)[k]!;
      if (["type", "id", "ref", "ordered", "tone"].includes(k) && va !== vb) out.push(`${path}.${k}: ${String(va)} vs ${String(vb)}`);
      else shapeDiffs(va, vb, `${path}.${k}`, out);
    }
    return;
  }
  if (typeof a !== typeof b) out.push(`${path}: ${typeof a} vs ${typeof b}`);
}

/** Every string leaf, with its path, in document order. */
function strings(v: Json, path = ""): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => strings(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => (["type", "id", "ref", "tone"].includes(k) ? [] : strings(x, path ? `${path}.${k}` : k)));
  return [];
}

const DOC_NAMESPACES = ["about", "service", "pricing", "contact", "refunds", "privacy", "terms"] as const;

function main() {
  console.log("--- A. Structure ---");
  const nsKa = Object.keys(site.ka).sort();
  const nsEn = Object.keys(site.en).sort();
  check("A1. KA and EN define the same namespaces", nsKa.join() === nsEn.join(), { ka: nsKa, en: nsEn });
  const collisions = nsKa.filter((n) => n in app.ka || n in app.en);
  check("A2. Site namespaces don't collide with the app's message namespaces", collisions.length === 0, collisions);
  const diffs: string[] = [];
  shapeDiffs(site.ka, site.en, "", diffs);
  check("A3. KA and EN copy have identical structure (keys, lists, sections, block types, ids, refs)", diffs.length === 0, diffs.slice(0, 10));
  for (const locale of ["ka", "en"] as const) {
    const bad = DOC_NAMESPACES.filter((ns) => !sectionsSchema.safeParse((site[locale][ns] as Record<string, Json>)?.sections).success);
    check(`A4. Every page's sections parse (${locale})`, bad.length === 0, bad);
    const missing = DOC_NAMESPACES.flatMap((ns) => ["metaTitle", "metaDescription", "eyebrow", "title", "lead"].filter((k) => typeof (site[locale][ns] as Record<string, Json>)?.[k] !== "string").map((k) => `${ns}.${k}`));
    check(`A5. Every page has title, lead, eyebrow and metadata (${locale})`, missing.length === 0, missing);
  }

  console.log("\n--- B. Tokens and links ---");
  const routes = new Set<string>(["/", ...SITE_PAGES.map((p) => p.href)]);
  const tokenErrors: string[] = [];
  const badLinks: string[] = [];
  for (const locale of ["ka", "en"] as const) {
    for (const [path, text] of strings(site[locale])) {
      try {
        for (const href of linksIn(parseInline(text))) if (href.startsWith("/") && !routes.has(href.split("#")[0]!)) badLinks.push(`${locale}:${path} → ${href}`);
      } catch (err) {
        tokenErrors.push(`${locale}:${path}: ${(err as Error).message}`);
      }
    }
  }
  check("B1. Every string's inline syntax parses (known tokens, allowed links, no [[…]] placeholders)", tokenErrors.length === 0, tokenErrors.slice(0, 10));
  check("B2. Every internal link points to an existing page", badLinks.length === 0, badLinks);
  const kaStrings = new Map(strings(site.ka));
  const mismatched: string[] = [];
  for (const [path, en] of strings(site.en)) {
    const ka = kaStrings.get(path);
    if (ka === undefined) continue;
    const sig = (s: string) => (s.match(/\{\{[a-zA-Z.]+\}\}|\]\([^)]+\)/g) ?? []).sort().join(" ");
    if (sig(ka) !== sig(en)) mismatched.push(`${path}: ka[${sig(ka)}] en[${sig(en)}]`);
  }
  check("B3. Each KA string uses exactly the same tokens and links as its EN counterpart", mismatched.length === 0, mismatched.slice(0, 10));
  const usedMerchant = new Set(strings(site.en).flatMap(([, s]) => merchantTokensIn(parseInline(s))));
  const info = parseMerchantInfo({});
  const unresolvable = [...usedMerchant].filter((t) => !resolveMerchantToken(info, t, "ka").field || !resolveMerchantToken(info, t, "en").field);
  check("B4. Every merchant token used in the copy maps to a configuration field in both languages", unresolvable.length === 0, unresolvable);

  console.log("\n--- C. Language ---");
  const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿ]/;
  // Strings that are legitimately language-neutral: tokens only (e.g. a
  // list of file formats), cookie names, product names, the copyright line.
  const NEUTRAL = new Set(["NEXT_LOCALE", "qr_edit_…", "Supabase", "© {year} QR Starr"]);
  const neutral = (s: string) => NEUTRAL.has(s) || s.replace(/\{\{[a-zA-Z.]+\}\}/g, "").trim() === "";
  const notGeorgian = strings(site.ka).filter(([, s]) => !GEORGIAN.test(s) && !neutral(s)).map(([p, s]) => `${p}: ${s}`);
  check("C1. Every KA string is written in Georgian", notGeorgian.length === 0, notGeorgian.slice(0, 10));
  // The demo notice is deliberately bilingual ("DEMO / სატესტო მონაცემები") in both languages.
  const georgianInEn = strings(site.en).filter(([p, s]) => GEORGIAN.test(s) && p !== "site.demo.notice").map(([p]) => p);
  check("C2. No EN string contains Georgian (except the bilingual demo notice)", georgianInEn.length === 0, georgianInEn);
  const navKeys = SITE_PAGES.map((p) => p.key);
  for (const locale of ["ka", "en"] as const) {
    const nav = ((site[locale].site as Record<string, Json>).nav ?? {}) as Record<string, Json>;
    check(`C3. Every page has a navigation label (${locale})`, navKeys.every((k) => typeof nav[k] === "string" && (nav[k] as string).length > 0), navKeys.filter((k) => !nav[k]));
  }

  console.log("\n--- D. Routes ---");
  const siteDir = join(root, "src/app/(site)");
  const routeDirs = readdirSync(siteDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `/${d.name}`);
  check("D1. Every page in SITE_PAGES has a route with a page.tsx", SITE_PAGES.every((p) => existsSync(join(siteDir, p.href.slice(1), "page.tsx"))), SITE_PAGES.filter((p) => !existsSync(join(siteDir, p.href.slice(1), "page.tsx"))).map((p) => p.href));
  check("D2. Every route in (site) is listed in SITE_PAGES (and therefore in the footer)", routeDirs.every((d) => SITE_PAGES.some((p) => p.href === d)), routeDirs);
  check("D3. The required pages are all present: about, contact, how it works, pricing, refunds, privacy, terms", ["/about", "/contact", "/how-it-works", "/pricing", "/delivery-and-refunds", "/privacy", "/terms"].every((h) => SITE_PAGES.some((p) => p.href === h)));
  const footerSrc = readFileSync(join(root, "src/components/site/site-footer.tsx"), "utf8");
  const rootPageSrc = readFileSync(join(root, "src/app/page.tsx"), "utf8");
  check("D4. The footer is built from SITE_PAGES, and is on the home page and the site layout", footerSrc.includes("SITE_PAGES") && rootPageSrc.includes("<SiteFooter") && readFileSync(join(siteDir, "layout.tsx"), "utf8").includes("<SiteFooter"));

  console.log("\n--- E. Merchant configuration ---");
  const empty = parseMerchantInfo({});
  const required = Object.entries(MERCHANT_FIELDS).filter(([, s]) => s.required).map(([f]) => f);
  check("E1. With nothing configured, every required field is reported missing and nothing is invented", !empty.complete && empty.missing.length === required.length && Object.values(empty.values).every((v) => v === null));
  check("E2. Whitespace-only values count as missing", parseMerchantInfo({ MERCHANT_SUPPORT_EMAIL: "   " }).values.supportEmail === null);
  const valid = {
    MERCHANT_LEGAL_NAME_KA: "შპს ტესტი",
    MERCHANT_LEGAL_NAME_EN: "Test LLC",
    MERCHANT_ENTITY_TYPE: "LLC",
    MERCHANT_ID_CODE: "123456789",
    MERCHANT_LEGAL_ADDRESS_KA: "თბილისი, ტესტის ქ. 1",
    MERCHANT_LEGAL_ADDRESS_EN: "1 Test St, Tbilisi",
    MERCHANT_SUPPORT_EMAIL: "support@example.test",
    MERCHANT_PHONE: "+995 555 12 34 56",
    LEGAL_EFFECTIVE_DATE: "2027-01-01",
  };
  const full = parseMerchantInfo(valid);
  check("E3. A complete, valid configuration is accepted", full.complete && full.invalid.length === 0 && full.values.idCode === "123456789" && full.values.legalNameKa === "შპს ტესტი", { missing: full.missing, invalid: full.invalid });
  check("E4. Language-specific details resolve per locale", resolveMerchantToken(full, "legalName", "ka").value === "შპს ტესტი" && resolveMerchantToken(full, "legalName", "en").value === "Test LLC");
  check("E5. The privacy contact falls back to the support email when no privacy email is set", resolveMerchantToken(full, "privacyEmail", "en").value === "support@example.test");
  const bad = parseMerchantInfo({ ...valid, MERCHANT_SUPPORT_EMAIL: "not-an-email", MERCHANT_PHONE: "555", MERCHANT_ID_CODE: "12345", MERCHANT_ENTITY_TYPE: "LTD", LEGAL_EFFECTIVE_DATE: "2027/01/01" });
  const rejected = bad.invalid.map((i) => i.field).sort().join(",");
  check("E6. Invalid values are rejected, reported, and never displayed", rejected === "entityType,idCode,legalEffectiveDate,phone,supportEmail" && bad.values.supportEmail === null && bad.values.phone === null && !bad.complete, bad.invalid);
  check("E7. An individual entrepreneur's 11-digit personal number is accepted", parseMerchantInfo({ MERCHANT_ID_CODE: "01234567890" }).values.idCode === "01234567890");
  check("E8. Every merchant token is backed by a field", MERCHANT_TOKENS.every((t) => resolveMerchantToken(empty, t, "en").field in MERCHANT_FIELDS));

  console.log("\n--- F. Pricing and claims ---");
  const allCopy = [...strings(site.ka), ...strings(site.en)];
  const hardCodedAmounts = allCopy.filter(([, s]) => /\d+([.,]\d+)?\s*(GEL|₾|ლარ)/.test(s) || /(GEL|₾)\s*\d/.test(s)).map(([p]) => p);
  check("F1. No price is hard-coded in the copy (prices come only from {{price}})", hardCodedAmounts.length === 0, hardCodedAmounts);
  const commission = allCopy.filter(([, s]) => /commission|revenue share|payout share|bps|\d+\s*%|საკომისიო|პროცენტ/i.test(s)).map(([p]) => p);
  check("F2. No partner commission or revenue split is exposed", commission.length === 0, commission);
  const taxClaims = allCopy.filter(([, s]) => /VAT[- ]inclusive|including VAT|incl\.? VAT|VAT included|დღგ-?ს? ჩათვლით|დღგ-ის ჩათვლით/i.test(s)).map(([p]) => p);
  check("F3. No tax-inclusive claim is made before the tax status is confirmed", taxClaims.length === 0, taxClaims);
  const fees = allCopy.filter(([, s]) => /service fee|booking fee|handling fee|მომსახურების საკომისიო/i.test(s)).map(([p]) => p);
  check("F4. No extra fees are described", fees.length === 0, fees);
  check("F5. Standard price: one active default is shown", pickStandardPrice([{ amountMinor: 1000, currency: "GEL" }])?.amountMinor === 1000);
  check("F6. Standard price: none configured → unavailable (no fallback amount)", pickStandardPrice([]) === null);
  check("F7. Standard price: ambiguous (two active defaults) → unavailable", pickStandardPrice([{ amountMinor: 1000, currency: "GEL" }, { amountMinor: 1500, currency: "GEL" }]) === null);
  const priceCardSrc = readFileSync(join(root, "src/components/site/price-card.tsx"), "utf8");
  check("F8. The pricing card renders the price only through {{price}} (the pricing data)", priceCardSrc.includes("{{price}}") && !/\d+\s*(GEL|₾)/.test(priceCardSrc));

  console.log("\n--- G. Copy assumptions match the code ---");
  check("G1. Copy says “one video” / “ერთი ვიდეო” and “one voice note”: the code allows exactly one of each", MEDIA_SLOT_LIMITS.video === 1 && MEDIA_SLOT_LIMITS.audio === 1, MEDIA_SLOT_LIMITS);

  console.log("\n--- H. Review markers are documented ---");
  const checklist = readFileSync(join(root, "docs/merchant/BOG_WEBSITE_REQUIREMENTS.md"), "utf8");
  const refs = new Set<string>();
  let reviews = 0;
  for (const ns of DOC_NAMESPACES) {
    const a = analyseSections(sectionsSchema.parse((site.en[ns] as Record<string, Json>).sections));
    a.decisions.forEach((r) => refs.add(r));
    reviews += a.reviews;
  }
  const undocumented = [...refs].filter((r) => !new RegExp(`\\|\\s*${r}\\s*\\|`).test(checklist));
  check(`H1. Every decision marker in the copy (${[...refs].sort().join(", ")}) is listed in docs/merchant/BOG_WEBSITE_REQUIREMENTS.md`, undocumented.length === 0, undocumented);
  check(`H2. Legal-review markers are present where provisions await review (${reviews} in total)`, reviews > 0);

  console.log("\n--- I. Demo profile isolation ---");
  const plain = loadMerchantInfo({});
  check("I1. Without MERCHANT_PROFILE nothing fictional is shown: mode is configured and every required detail is missing", plain.mode === "configured" && !plain.complete && Object.values(plain.values).every((v) => v === null));
  const demo = loadMerchantInfo({ MERCHANT_PROFILE: "demo" });
  const expected = {
    legalNameKa: "შპს ქიუარ სტარ დემო",
    legalNameEn: "QR Starr Demo LLC",
    entityType: "LLC",
    idCode: "000000000",
    legalAddressKa: "საქართველო, თბილისი, დემო ქუჩა №1",
    legalAddressEn: "1 Demo Street, Tbilisi, Georgia",
    supportEmail: "demo@example.com",
    phone: "+995 555 00 00 00",
    supportHoursEn: "Monday–Friday, 10:00–18:00",
    privacyEmail: "privacy@example.com",
  } as const;
  const wrong = Object.entries(expected).filter(([f, v]) => demo.values[f as keyof typeof demo.values] !== v);
  check("I2. MERCHANT_PROFILE=demo shows the agreed fictional details, all of which pass validation", demo.mode === "demo" && demo.complete && demo.invalid.length === 0 && wrong.length === 0, { wrong, invalid: demo.invalid });
  check("I3. The demo profile never sets an effective date: the policies stay drafts", demo.values.legalEffectiveDate === null);
  const mixed = loadMerchantInfo({ MERCHANT_PROFILE: "demo", MERCHANT_SUPPORT_EMAIL: "real@company.test", MERCHANT_LEGAL_NAME_EN: "Real Company LLC" });
  check("I4. Demo and real values never mix: with demo on, real MERCHANT_* values are not used", mixed.mode === "demo" && mixed.values.supportEmail === "demo@example.com" && mixed.values.legalNameEn === "QR Starr Demo LLC");
  for (const [label, env] of [
    ["VERCEL_ENV=production", { VERCEL_ENV: "production" }],
    ["NEXT_PUBLIC_APP_URL=https://qrapp.ge", { NEXT_PUBLIC_APP_URL: "https://qrapp.ge" }],
    ["NEXT_PUBLIC_APP_URL=https://www.qrapp.ge", { NEXT_PUBLIC_APP_URL: "https://www.qrapp.ge" }],
  ] as const) {
    const refused = loadMerchantInfo({ MERCHANT_PROFILE: "demo", ...env });
    check(`I5. Demo is refused on production (${label}): real variables and their missing-data safeguards apply`, refused.mode === "configured" && !refused.complete && refused.values.supportEmail === null && !!refused.profileRefused);
  }
  const refusedWithReal = loadMerchantInfo({ MERCHANT_PROFILE: "demo", VERCEL_ENV: "production", ...Object.fromEntries(Object.entries(valid)) });
  check("I6. On production, real values configured alongside a stray MERCHANT_PROFILE=demo are shown as normal", refusedWithReal.mode === "configured" && refusedWithReal.complete && refusedWithReal.values.supportEmail === "support@example.test");
  check("I7. Preview deployments (VERCEL_ENV=preview, non-production URL) may use the demo profile", loadMerchantInfo({ MERCHANT_PROFILE: "demo", VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://qr-gift-platform-git-x.vercel.app" }).mode === "demo");
  const unknown = loadMerchantInfo({ MERCHANT_PROFILE: "sample" });
  check("I8. An unknown profile is ignored and reported, never guessed", unknown.mode === "configured" && !!unknown.profileRefused && unknown.values.supportEmail === null);
  const srcFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? srcFiles(join(dir, d.name)) : /\.(ts|tsx|json)$/.test(d.name) ? [join(dir, d.name)] : []));
  // Imports of the demo module (from lib/merchant: "./demo"; elsewhere: ".../merchant/demo"), or the fictional values themselves.
  const demoRefs = srcFiles(join(root, "src")).filter((f) => {
    if (f.endsWith(join("merchant", "demo.ts"))) return false;
    const text = readFileSync(f, "utf8");
    const importsDemo = /merchant\/demo["']/.test(text) || (f.includes(join("lib", "merchant")) && /from ["']\.\/demo["']/.test(text));
    return importsDemo || /demo@example\.com|privacy@example\.com|QR Starr Demo|ქიუარ სტარ დემო/.test(text);
  });
  check("I9. The fictional data lives only in lib/merchant/demo.ts and is loaded only by lib/merchant/info.ts", demoRefs.length === 1 && demoRefs[0]!.endsWith(join("merchant", "info.ts")), demoRefs.map((f) => f.slice(root.length)));
  check("I10. The demo profile covers only merchant fields (no price, no policy terms)", Object.keys(DEMO_MERCHANT_ENV).every((k) => k.startsWith("MERCHANT_")));
  const notices = [site.ka, site.en].map((m) => ((m.site as Record<string, Json>).demo as Record<string, Json>)?.notice);
  check("I11. Both languages label demo data “DEMO / სატესტო მონაცემები”", notices.every((n) => n === "DEMO / სატესტო მონაცემები"), notices);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

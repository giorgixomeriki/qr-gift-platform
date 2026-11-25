/**
 * Lists the merchant details (MERCHANT_* / LEGAL_EFFECTIVE_DATE) the current
 * environment is missing or has invalid, as a checklist for the owner. Reads
 * only environment variables: no database, no network. Prints variable names
 * and what to provide, never the values themselves. Exit code 1 while any
 * required detail is missing or invalid, and while the fictional demo
 * profile is active (demo data is never real merchant information).
 *
 *   npm run ops:check-merchant-info
 *
 * See docs/merchant/MERCHANT_INFORMATION.md.
 */
const { loadMerchantInfo, MERCHANT_FIELDS, MERCHANT_FIELD_NAMES } = require("../src/lib/merchant/info") as typeof import("../src/lib/merchant/info");

const info = loadMerchantInfo(process.env);
if (info.mode === "demo") {
  console.log("DEMO PROFILE ACTIVE (MERCHANT_PROFILE=demo): every value below is FICTIONAL preview data.");
  console.log("This environment has no real merchant information. Unset MERCHANT_PROFILE and set the MERCHANT_* variables.\n");
}
if (info.profileRefused) console.log(`NOTE: ${info.profileRefused}\n`);
const invalid = new Map(info.invalid.map((i) => [i.field, i.reason]));

console.log("Merchant information for the public pages\n");
for (const field of MERCHANT_FIELD_NAMES) {
  const spec = MERCHANT_FIELDS[field];
  const state = info.values[field] !== null ? "set" : invalid.has(field) ? `INVALID (${invalid.get(field)})` : spec.required ? "MISSING" : "not set (optional)";
  const mark = info.values[field] !== null ? "✓" : spec.required || invalid.has(field) ? "✗" : "·";
  console.log(`  ${mark} ${spec.env.padEnd(28)} ${state.padEnd(30)} ${spec.describe}`);
}

const problems = info.missing.length + info.invalid.length;
console.log(info.mode === "demo" ? "\nDemo profile only: these values are fictional and are NOT real merchant information." : problems === 0 ? "\nAll required merchant details are set." : `\n${info.missing.length} required detail(s) missing, ${info.invalid.length} invalid. The pages show "not yet published" markers until they are fixed.`);
process.exit(info.mode === "configured" && info.complete && info.invalid.length === 0 ? 0 : 1);

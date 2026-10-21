/**
 * Lists the merchant details (MERCHANT_* / LEGAL_EFFECTIVE_DATE) the current
 * environment is missing or has invalid, as a checklist for the owner. Reads
 * only environment variables: no database, no network. Prints variable names
 * and what to provide, never the values themselves. Exit code 1 while any
 * required detail is missing or invalid.
 *
 *   npm run ops:check-merchant-info
 *
 * See docs/merchant/MERCHANT_INFORMATION.md.
 */
const { parseMerchantInfo, MERCHANT_FIELDS, MERCHANT_FIELD_NAMES } = require("../src/lib/merchant/info") as typeof import("../src/lib/merchant/info");

const info = parseMerchantInfo(process.env);
const invalid = new Map(info.invalid.map((i) => [i.field, i.reason]));

console.log("Merchant information for the public pages\n");
for (const field of MERCHANT_FIELD_NAMES) {
  const spec = MERCHANT_FIELDS[field];
  const state = info.values[field] !== null ? "set" : invalid.has(field) ? `INVALID (${invalid.get(field)})` : spec.required ? "MISSING" : "not set (optional)";
  const mark = info.values[field] !== null ? "✓" : spec.required || invalid.has(field) ? "✗" : "·";
  console.log(`  ${mark} ${spec.env.padEnd(28)} ${state.padEnd(30)} ${spec.describe}`);
}

const problems = info.missing.length + info.invalid.length;
console.log(problems === 0 ? "\nAll required merchant details are set." : `\n${info.missing.length} required detail(s) missing, ${info.invalid.length} invalid. The pages show "not yet published" markers until they are fixed.`);
process.exit(info.complete && info.invalid.length === 0 ? 0 : 1);

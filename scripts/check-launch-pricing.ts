import postgres from "postgres";
import { splitCommission } from "../src/lib/payments/pricing";
import { DEFAULT_PRODUCT_KEY } from "../src/lib/greetings/constants";

/**
 * Launch pricing check: 10.00 GEL per greeting, 3.00 GEL (30%) to the partner,
 * 7.00 GEL to the platform. READ-ONLY — runs in a READ ONLY transaction, so it
 * is safe to point at any environment, production included, as an operator
 * check after provisioning and before each launch step.
 *
 * Pricing is data, not code (prices rows + partners.commission_rate_bps), so
 * this verifies the data actually in the target database:
 *  1. Exactly one active platform-default price for the default product: 1000 GEL minor units.
 *  2. No active partner-specific price override for that product.
 *  3. Every ACTIVE partner is at 3000 bps.
 *  4. The split arithmetic yields 300 / 700 for that price and rate.
 *
 * Uses MIGRATIONS_DATABASE_URL because the app_runtime role cannot see other
 * partners through RLS.
 */
const LAUNCH_PRICE_MINOR = 1000;
const LAUNCH_CURRENCY = "GEL";
const LAUNCH_COMMISSION_BPS = 3000;

let failures = 0;
function list(items: string[]): string | undefined {
  if (items.length === 0) return undefined;
  const shown = items.slice(0, 10).join(", ");
  return items.length > 10 ? `${shown} … and ${items.length - 10} more` : shown;
}
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const url = process.env.MIGRATIONS_DATABASE_URL;
  if (!url) throw new Error("MIGRATIONS_DATABASE_URL is required");
  const sql = postgres(url, { max: 1 });

  try {
    await sql.begin("read only", async (tx) => {
      const defaults = await tx<{ amount_minor: number; currency: string }[]>`
        select pr.amount_minor, pr.currency
        from prices pr join products p on p.id = pr.product_id
        where p.key = ${DEFAULT_PRODUCT_KEY} and pr.active and pr.partner_id is null`;
      check(
        `one active platform-default price for ${DEFAULT_PRODUCT_KEY}`,
        defaults.length === 1,
        `found ${defaults.length}`,
      );
      const [price] = defaults;
      check(
        `default price is ${LAUNCH_PRICE_MINOR} ${LAUNCH_CURRENCY} minor units`,
        price?.amount_minor === LAUNCH_PRICE_MINOR && price?.currency === LAUNCH_CURRENCY,
        price ? `found ${price.amount_minor} ${price.currency}` : "none",
      );

      const overrides = await tx<{ slug: string; amount_minor: number }[]>`
        select pa.slug, pr.amount_minor
        from prices pr
        join products p on p.id = pr.product_id
        join partners pa on pa.id = pr.partner_id
        where p.key = ${DEFAULT_PRODUCT_KEY} and pr.active`;
      check(
        "no active partner-specific price overrides",
        overrides.length === 0,
        list(overrides.map((o) => `${o.slug}=${o.amount_minor}`)),
      );

      const offRate = await tx<{ slug: string; commission_rate_bps: number }[]>`
        select slug, commission_rate_bps from partners
        where status = 'ACTIVE' and commission_rate_bps <> ${LAUNCH_COMMISSION_BPS}`;
      check(
        `every ACTIVE partner is at ${LAUNCH_COMMISSION_BPS} bps`,
        offRate.length === 0,
        list(offRate.map((p) => `${p.slug}=${p.commission_rate_bps}`)),
      );
    });
  } finally {
    await sql.end();
  }

  const split = splitCommission(LAUNCH_PRICE_MINOR, LAUNCH_COMMISSION_BPS);
  check(
    "split is 300 partner / 700 platform",
    split.partnerCommissionMinor === 300 && split.platformShareMinor === 700,
    `${split.partnerCommissionMinor} / ${split.platformShareMinor}`,
  );

  console.log(failures === 0 ? "Launch pricing OK." : `${failures} launch pricing check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

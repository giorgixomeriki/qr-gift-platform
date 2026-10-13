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
 *  2. Partner-specific price overrides (Super Admin–configured, migrations/0018)
 *     are listed for review, and each must be in the partner's own currency.
 *     Not a failure by themselves — custom partner pricing is a feature.
 *  3. ACTIVE partners not at the 3000 bps launch rate are listed for review
 *     (also configurable per partner); every rate must be in [0, 10000].
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
function info(label: string, detail?: string) {
  console.log(`INFO  ${label}${detail ? ` — ${detail}` : ""}`);
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

      const overrides = await tx<{ slug: string; amount_minor: number; currency: string; partner_currency: string }[]>`
        select pa.slug, pr.amount_minor, pr.currency, pa.currency as partner_currency
        from prices pr
        join products p on p.id = pr.product_id
        join partners pa on pa.id = pr.partner_id
        where p.key = ${DEFAULT_PRODUCT_KEY} and pr.active`;
      info(
        `${overrides.length} partner-specific price override(s)`,
        list(overrides.map((o) => `${o.slug}=${o.amount_minor} ${o.currency}`)),
      );
      const wrongCurrency = overrides.filter((o) => o.currency !== o.partner_currency);
      check(
        "every price override is in its partner's currency",
        wrongCurrency.length === 0,
        list(wrongCurrency.map((o) => `${o.slug}: ${o.currency} vs ${o.partner_currency}`)),
      );

      const offRate = await tx<{ slug: string; commission_rate_bps: number }[]>`
        select slug, commission_rate_bps from partners
        where status = 'ACTIVE' and commission_rate_bps <> ${LAUNCH_COMMISSION_BPS}`;
      info(
        `${offRate.length} ACTIVE partner(s) not at the ${LAUNCH_COMMISSION_BPS} bps launch rate`,
        list(offRate.map((p) => `${p.slug}=${p.commission_rate_bps}`)),
      );
      const outOfRange = offRate.filter((p) => p.commission_rate_bps < 0 || p.commission_rate_bps > 10000);
      check("every commission rate is within 0–10000 bps", outOfRange.length === 0, list(outOfRange.map((p) => p.slug)));
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

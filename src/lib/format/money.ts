/**
 * Client-safe money formatting (no server imports), shared by every surface
 * that shows an amount. Amounts are integer minor units, never floats.
 *
 * Georgian convention puts the lari sign after the amount ("5 ₾",
 * "12,50 ₾") — in both UI languages, since that's how prices are written
 * in Georgia. Whole amounts drop the ".00" in consumer-facing copy;
 * pass `{ fixed: true }` for ledgers/dashboards where columns must align.
 */
export function formatMinorAmount(
  amountMinor: number,
  currency: string,
  locale: string,
  { fixed = false }: { fixed?: boolean } = {},
): string {
  const numberLocale = locale === "ka" ? "ka-GE" : "en-GB";
  const fractionDigits = fixed || amountMinor % 100 !== 0 ? 2 : 0;
  if (currency === "GEL") {
    const n = new Intl.NumberFormat(numberLocale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
    return `${n} ₾`;
  }
  return new Intl.NumberFormat(numberLocale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: fractionDigits,
  }).format(amountMinor / 100);
}

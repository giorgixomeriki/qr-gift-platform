import { getTranslations } from "next-intl/server";
import { Spark } from "@/components/ui/logo";
import { Inline } from "./inline";
import type { SiteContext } from "./context";

/** The standard price, read from the pricing data (never hard-coded); "unavailable" when it can't be read. */
export async function PriceCard({ ctx }: { ctx: SiteContext }) {
  const t = await getTranslations("pricing.card");
  return (
    <section aria-labelledby="price-card-title" className="relative max-w-xl overflow-hidden rounded-[var(--radius-xl)] bg-surface p-7 shadow-sm ring-1 ring-line sm:p-9" data-testid="price-card">
      <Spark className="absolute -right-6 -top-6 size-28 text-ember-soft" />
      <p id="price-card-title" className="text-eyebrow text-ember">
        {t("label")}
      </p>
      <p className="mt-3 font-serif text-[3rem] leading-none text-ink">
        <Inline text="{{price}}" ctx={ctx} />
      </p>
      <p className="mt-3 text-body text-ink-2">{t("unit")}</p>
      <p className="mt-5 border-t border-line pt-4 text-body-sm text-ink-3">{t("note")}</p>
    </section>
  );
}

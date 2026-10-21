import "server-only";
import { getLocale, getTranslations } from "next-intl/server";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getMerchantInfo } from "@/lib/merchant/server";
import { getStandardPrice, type StandardPrice } from "@/lib/merchant/price";
import { getProductFacts } from "@/lib/site/facts";
import type { MerchantInfo } from "@/lib/merchant/info";
import type { FactToken } from "@/lib/site/inline";

/** Everything inline copy can reference, resolved once per page render. */
export type SiteContext = {
  locale: Locale;
  merchant: MerchantInfo;
  facts: Record<FactToken, string>;
  /** Undefined when the page doesn't show a price; null when no valid price is configured. */
  price: StandardPrice | null | undefined;
  labels: {
    pending: string;
    pendingHint: string;
    priceUnavailable: string;
    entityTypes: Record<string, string>;
    demo: { notice: string; body: string; tag: string };
  };
};

export async function getSiteContext({ withPrice = false }: { withPrice?: boolean } = {}): Promise<SiteContext> {
  const rawLocale = await getLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "ka";
  const t = await getTranslations("site");
  return {
    locale,
    merchant: getMerchantInfo(),
    facts: getProductFacts(),
    price: withPrice ? await getStandardPrice() : undefined,
    labels: {
      pending: t("status.pending"),
      pendingHint: t("status.pendingHint"),
      priceUnavailable: t("status.priceUnavailable"),
      entityTypes: { LLC: t("entityTypes.LLC"), JSC: t("entityTypes.JSC"), IE: t("entityTypes.IE"), OTHER: t("entityTypes.OTHER") },
      demo: { notice: t("demo.notice"), body: t("demo.body"), tag: t("demo.tag") },
    },
  };
}

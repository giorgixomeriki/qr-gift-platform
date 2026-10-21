import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { resolveMerchantToken } from "@/lib/merchant/info";
import { analyseSections, sectionsSchema } from "@/lib/site/document";
import { getSiteContext } from "./context";
import { Inline } from "./inline";
import { PageHeader } from "./page-header";
import { SiteDocument } from "./document";

export type DocumentNamespace = "about" | "service" | "pricing" | "contact" | "refunds" | "privacy" | "terms";
type Namespace = DocumentNamespace;

/** Pages whose text is a policy that takes effect on a date (LEGAL_EFFECTIVE_DATE). */
const POLICIES: Namespace[] = ["refunds", "privacy", "terms"];

/**
 * A complete long-form information page: header, draft status, document.
 * The draft banner is computed, not configured: the page is a draft while
 * its copy holds any review/decision marker, or references a merchant
 * detail that is not set, or (for policies) has no effective date.
 */
export async function DocumentPage({
  namespace,
  intro,
  withPrice = false,
  introUses = [],
}: {
  namespace: Namespace;
  intro?: ReactNode;
  withPrice?: boolean;
  /** Inline strings the intro renders (e.g. merchant tokens), so they count towards the draft status. */
  introUses?: string[];
}) {
  const t = await getTranslations(namespace);
  const ts = await getTranslations("site");
  const ctx = await getSiteContext({ withPrice });
  const sections = sectionsSchema.parse(t.raw("sections"));
  const lead = t.raw("lead") as string;
  const analysis = analyseSections(sections, [lead, ...introUses]);

  const unpublished = analysis.merchantTokens.filter((tok) => resolveMerchantToken(ctx.merchant, tok, ctx.locale).value === null);
  const isPolicy = POLICIES.includes(namespace);
  const effectiveDate = ctx.merchant.values.legalEffectiveDate;
  const markers = analysis.reviews + analysis.decisions.length;
  const isDraft = markers > 0 || unpublished.length > 0 || (isPolicy && !effectiveDate);

  const status = isPolicy
    ? effectiveDate && !isDraft
      ? ts("status.effectiveFrom", { date: formatEffectiveDate(effectiveDate, ctx.locale) })
      : ts("status.notYetEffective")
    : undefined;

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        lead={<Inline text={lead} ctx={ctx} />}
        status={status}
        draft={isDraft ? { title: ts("status.draftTitle"), body: isPolicy ? ts("status.draftPolicyBody") : ts("status.draftPageBody") } : undefined}
      />
      {intro && <div className="pt-10">{intro}</div>}
      <div className="pt-12">
        <SiteDocument
          sections={sections}
          ctx={ctx}
          numbered={isPolicy}
          labels={{ onThisPage: ts("status.onThisPage"), review: ts("status.review"), decision: ts("status.decision") }}
        />
      </div>
    </>
  );
}

function formatEffectiveDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ka" ? "ka-GE" : "en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** Title and description for a page's <head>. */
export async function documentMetadata(namespace: Namespace) {
  const t = await getTranslations(namespace);
  return { title: t("metaTitle"), description: t("metaDescription") };
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DocumentPage, documentMetadata } from "@/components/site/document-page";
import { MerchantDetails } from "@/components/site/merchant-details";
import { getSiteContext } from "@/components/site/context";

/** The merchant's registered details and how to reach support. */
export async function generateMetadata(): Promise<Metadata> {
  return documentMetadata("contact");
}

const REQUIRED_DETAILS = ["legalName", "entityType", "idCode", "legalAddress", "supportEmail", "phone"].map((t) => `{{merchant.${t}}}`);

export default async function Page() {
  const ctx = await getSiteContext();
  const t = await getTranslations("contact");
  return (
    <DocumentPage
      namespace="contact"
      introUses={REQUIRED_DETAILS}
      intro={
        <section aria-labelledby="merchant-details-title" className="max-w-3xl rounded-[var(--radius-xl)] bg-surface px-6 py-5 shadow-xs ring-1 ring-line sm:px-8 sm:py-6">
          <h2 id="merchant-details-title" className="text-eyebrow text-ember">
            {t("detailsTitle")}
          </h2>
          <div className="mt-2">
            <MerchantDetails ctx={ctx} />
          </div>
        </section>
      }
    />
  );
}

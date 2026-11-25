import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DocumentPage, documentMetadata } from "@/components/site/document-page";
import { Highlights } from "@/components/site/highlights";
import { getSiteContext } from "@/components/site/context";

/** Product and service description: what is bought, what a greeting holds, activation, limits. */
export async function generateMetadata(): Promise<Metadata> {
  return documentMetadata("service");
}

export default async function Page() {
  const ctx = await getSiteContext();
  const t = await getTranslations("service");
  return <DocumentPage namespace="service" intro={<Highlights namespace="service" itemsKey="contents" ctx={ctx} label={t("contentsLabel")} />} />;
}

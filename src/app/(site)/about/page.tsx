import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DocumentPage, documentMetadata } from "@/components/site/document-page";
import { Highlights } from "@/components/site/highlights";
import { getSiteContext } from "@/components/site/context";

/** About QR Starr: what it is, how the card and the greeting connect, who it's for. */
export async function generateMetadata(): Promise<Metadata> {
  return documentMetadata("about");
}

export default async function Page() {
  const ctx = await getSiteContext();
  const t = await getTranslations("about");
  return <DocumentPage namespace="about" intro={<Highlights namespace="about" itemsKey="steps" ctx={ctx} numbered label={t("stepsLabel")} />} />;
}

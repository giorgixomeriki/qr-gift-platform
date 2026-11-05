import type { Metadata } from "next";
import { DocumentPage, documentMetadata } from "@/components/site/document-page";
import { PriceCard } from "@/components/site/price-card";
import { getSiteContext } from "@/components/site/context";

/** The current standard price, read from the same pricing data checkout uses. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return documentMetadata("pricing");
}

export default async function Page() {
  const ctx = await getSiteContext({ withPrice: true });
  return <DocumentPage namespace="pricing" withPrice intro={<PriceCard ctx={ctx} />} />;
}

import type { Metadata } from "next";
import { DocumentPage, documentMetadata } from "@/components/site/document-page";

/** Delivery, cancellation and refund policy. */
export async function generateMetadata(): Promise<Metadata> {
  return documentMetadata("refunds");
}

export default function Page() {
  return <DocumentPage namespace="refunds" />;
}

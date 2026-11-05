import type { Metadata } from "next";
import { DocumentPage, documentMetadata } from "@/components/site/document-page";

/** Privacy policy: what is collected, why, who sees it, and your rights. */
export async function generateMetadata(): Promise<Metadata> {
  return documentMetadata("privacy");
}

export default function Page() {
  return <DocumentPage namespace="privacy" />;
}

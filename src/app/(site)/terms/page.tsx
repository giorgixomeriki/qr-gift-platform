import type { Metadata } from "next";
import { DocumentPage, documentMetadata } from "@/components/site/document-page";

/** Terms and conditions for senders and recipients. */
export async function generateMetadata(): Promise<Metadata> {
  return documentMetadata("terms");
}

export default function Page() {
  return <DocumentPage namespace="terms" />;
}

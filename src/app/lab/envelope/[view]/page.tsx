import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnvelopeRecipientLab, EnvelopeWindowsLab } from "@/components/greeting/envelope-lab";

const THEMES = ["romantic", "birthday", "wedding", "celebration", "elegant", "minimal", "luxury-vintage"];

/**
 * Envelope comparison lab (mock content). 404 unless NEXT_PUBLIC_LAB=1 at build time.
 *   /lab/envelope/recipient?theme=<world>&env=classic|luxe   the production recipient screen (sealed envelope + its opening)
 *   /lab/envelope/windows                                      the sender's preview window, all seven worlds, classic | luxe
 */
export const metadata: Metadata = { title: "Envelope lab", robots: { index: false, follow: false } };
const MSG = "ჩემო ძვირფასო ნინო,\n\nდღეს მინდა გითხრა ის, რასაც ყოველდღე ვფიქრობ, მაგრამ იშვიათად ვამბობ ხმამაღლა.\n\nშენი გიორგი";

export default async function Page({ params, searchParams }: { params: Promise<{ view: string }>; searchParams: Promise<{ theme?: string; env?: string }> }) {
  if (process.env.NEXT_PUBLIC_LAB !== "1") notFound();
  const { view } = await params;
  const q = await searchParams;
  if (view === "windows") return <EnvelopeWindowsLab />;
  if (view === "recipient") {
    const theme = THEMES.includes(q.theme ?? "") ? q.theme! : "romantic";
    return <EnvelopeRecipientLab theme={theme} env={q.env === "classic" ? "classic" : "luxe"} message={MSG} />;
  }
  notFound();
}

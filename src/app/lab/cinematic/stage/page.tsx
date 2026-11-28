import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CinematicStage } from "@/components/cinematic/lab";

/**
 * One cinematic opening on the production recipient renderer (synthetic content). 404 unless NEXT_PUBLIC_LAB=1.
 *   /lab/cinematic/stage?v=A|B|C&theme=<world>&photos=0..3&q=auto|high|mid|lite&reduced=1&autoplay=1
 */
export const metadata: Metadata = { title: "Cinematic stage", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_LAB !== "1") notFound();
  const q = await searchParams;
  return <CinematicStage params={q} />;
}

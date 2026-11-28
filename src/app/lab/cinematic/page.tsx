import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CinematicCompare } from "@/components/cinematic/lab";

/** A/B/C comparison of the cinematic opening, in phone-sized frames. 404 unless NEXT_PUBLIC_LAB=1. */
export const metadata: Metadata = { title: "Cinematic opening lab", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NEXT_PUBLIC_LAB !== "1") notFound();
  return <CinematicCompare />;
}

import type { Metadata } from "next";
import { preload } from "react-dom";
import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { DemoRibbon } from "@/components/site/demo-ribbon";
import { Hero } from "@/components/site/home/hero";
import { Demo, Experiences, Finale, Moments, Occasions, Partners, Pricing, Steps, Transform, Trust } from "@/components/site/home/sections";
import { MotionRoot } from "@/components/site/home/motion";
import { RevealObserver } from "@/components/site/home/reveal";
import "@/components/site/home/home.css";

/**
 * The bare domain: QR Starr's public home page. It tells the whole story —
 * what the card is, what happens after the scan, what a greeting can hold,
 * the occasions, the partner offer, the price and the reassurances — and
 * routes partners to sign in. Recipients and senders still always arrive via
 * /g/{token}; nothing here creates or opens a greeting.
 *
 * Every fact comes from product constants or the pricing data (copy.tsx);
 * the site footer carries the information pages and the merchant details.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing");
  return { title: { absolute: t("metaTitle") }, description: t("metaDescription") };
}

export default function RootPage() {
  // The Latin display face of this page only (home.css); the headline paints with it.
  preload("/fonts/cormorant-garamond-latin.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <div className="hm site-skin flex min-h-dvh flex-col">
      <DemoRibbon />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <MotionRoot>
          <Hero />
          <Moments />
          <Steps />
          <Transform />
          <Demo />
          <Experiences />
          <Occasions />
          <Partners />
          <Pricing />
          <Trust />
          <Finale />
        </MotionRoot>
      </main>
      <SiteFooter />
      <RevealObserver />
    </div>
  );
}

import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { DemoRibbon } from "@/components/site/demo-ribbon";

/**
 * The public information pages (about, how it works, pricing, contact and
 * the policies). Their own chrome: a header with page navigation and the
 * site footer. The QR flow (/g/*) and the dashboards keep theirs.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoRibbon />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-page pb-20 pt-12 outline-none md:pt-16">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

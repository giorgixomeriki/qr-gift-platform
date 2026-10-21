import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/ui/logo";
import { SITE_GROUPS, SITE_PAGES } from "@/lib/site/routes";
import { getSiteContext } from "./context";
import { MerchantDetails } from "./merchant-details";

/**
 * The site-wide footer for the public pages: links to every information page
 * and the merchant's registered details (Bank of Georgia expects both in the
 * footer). Until the required details are configured it says so in one line
 * and links to the contact page, instead of filling the footer with markers.
 */
export async function SiteFooter() {
  const t = await getTranslations("site");
  const ctx = await getSiteContext();
  // A string, not a number: ICU would format 2026 as "2,026".
  const year = String(new Date().getUTCFullYear());

  return (
    <footer className="mt-auto border-t border-line bg-sunken/60 pb-[var(--safe-bottom)]" data-testid="site-footer">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-page py-12 md:grid-cols-[1.3fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <Logo className="text-base" />
          <p className="mt-3 text-body-sm text-ink-2">{t("footer.tagline")}</p>
        </div>
        {SITE_GROUPS.map((group) => (
          <nav key={group} aria-label={t(`footer.${group}`)}>
            <p className="text-eyebrow text-ink-3">{t(`footer.${group}`)}</p>
            <ul className="mt-3 space-y-1">
              {SITE_PAGES.filter((p) => p.group === group).map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="inline-flex min-h-9 items-center text-body-sm text-ink-2 transition-colors hover:text-ink" data-testid={`footer-link-${p.key}`}>
                    {t(`nav.${p.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-page py-8 text-body-sm text-ink-2 md:grid-cols-[1fr_auto] md:items-end">
          <section aria-label={t("footer.merchantHeading")}>
            <p className="text-eyebrow text-ink-3">{t("footer.merchantHeading")}</p>
            <div className="mt-3">
              {ctx.merchant.complete ? (
                <MerchantDetails ctx={ctx} compact />
              ) : (
                <p data-pending="merchant-details">
                  {t("footer.merchantPending")}{" "}
                  <Link href="/contact" className="font-medium text-ink underline decoration-ember/50 underline-offset-[3px] hover:decoration-ember">
                    {t("nav.contact")}
                  </Link>
                </p>
              )}
            </div>
            <p className="mt-3 text-ink-3">{t("footer.currency")}</p>
          </section>
          <p className="text-caption text-ink-3">{t("footer.copyright", { year })}</p>
        </div>
      </div>
    </footer>
  );
}

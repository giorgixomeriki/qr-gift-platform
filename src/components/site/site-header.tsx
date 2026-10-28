import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/greeting/locale-switcher";
import { Logo } from "@/components/ui/logo";
import { SITE_PAGES } from "@/lib/site/routes";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";

export async function SiteHeader() {
  const t = await getTranslations("site.nav");
  const primary = SITE_PAGES.filter((p) => p.primary).map((p) => ({ href: p.href, label: t(p.key) }));
  const legal = SITE_PAGES.filter((p) => !p.primary).map((p) => ({ href: p.href, label: t(p.key) }));

  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-paper/90 pt-[var(--safe-top)] backdrop-blur-md">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-3 py-2 text-ink-inverse focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-40"
      >
        {t("skipToContent")}
      </a>
      <div className="relative mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-page">
        <Link href="/" className="rounded-md" aria-label={t("home")}>
          <Logo className="text-base" />
        </Link>
        <nav aria-label={t("primaryLabel")} className="hidden md:block">
          <NavLinks links={primary} />
        </nav>
        <div className="flex items-center gap-1 md:gap-3">
          <LocaleSwitcher />
          <Link
            href="/partner/login"
            className="hidden min-h-10 items-center rounded-full px-4 text-label text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-sunken lg:inline-flex"
            data-testid="header-partner-login"
          >
            {t("partnerLogin")}
          </Link>
          <MobileNav
            primary={primary}
            legal={legal}
            partner={{ href: "/partner/login", label: t("partnerLogin") }}
            labels={{ open: t("openMenu"), close: t("closeMenu"), nav: t("menuLabel"), legal: t("legalHeading") }}
          />
        </div>
      </div>
    </header>
  );
}

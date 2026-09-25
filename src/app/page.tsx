import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { ThemeSwatch } from "@/components/greeting/theme-swatch";
import { LocaleSwitcher } from "@/components/greeting/locale-switcher";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

/**
 * The bare domain. There's no public marketing site yet, so this is a calm
 * brand page that explains the product in one line and routes partners to
 * sign in — recipients and senders always arrive via /g/{token}.
 */
export default async function RootPage() {
  const t = await getTranslations("home");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Logo className="text-base" />
        <LocaleSwitcher />
      </header>
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 py-10 sm:px-6 md:grid-cols-[1.1fr_1fr] md:gap-16">
        <div className="stagger">
          <p className="text-eyebrow text-ember">{t("eyebrow")}</p>
          <h1 className="text-display mt-3">{t("title")}</h1>
          <p className="mt-4 max-w-md text-body text-ink-2">{t("body")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/partner/login" size="lg" iconEnd={<ArrowRight className="size-4" aria-hidden />}>
              {t("partnerCta")}
            </ButtonLink>
          </div>
        </div>
        <ThemeSwatch themeKey="celebration" envelopeWidth="58%" className="animate-fade aspect-[4/3] w-full rounded-[var(--radius-xl)] shadow-md md:aspect-[4/5]" />
      </main>
    </div>
  );
}

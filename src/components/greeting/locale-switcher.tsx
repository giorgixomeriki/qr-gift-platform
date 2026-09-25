"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setLocaleAction } from "@/lib/i18n/actions";

const OPTIONS = [
  { locale: "ka", short: "ქარ", name: "ქართული" },
  { locale: "en", short: "EN", name: "English" },
] as const;

/**
 * Consumer-facing locale toggle (Phase 4 §6) — a sender or recipient may not
 * share the browser/Accept-Language guess request.ts falls back to. A small
 * two-option segmented control: a corner-of-screen affordance, not a
 * settings page.
 */
export function LocaleSwitcher({ className, tone = "default" }: { className?: string; tone?: "default" | "inverse" }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function switchTo(next: "ka" | "en") {
    if (next === locale) return;
    startTransition(async () => {
      await setLocaleAction(next, pathname);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={`inline-flex rounded-full p-0.5 text-caption font-medium ${
        tone === "inverse" ? "bg-white/15 text-white" : "bg-sunken text-ink-2"
      } ${pending ? "opacity-60" : ""} ${className ?? ""}`}
      data-testid="locale-switcher"
    >
      {OPTIONS.map((o) => {
        const active = o.locale === locale;
        return (
          <button
            key={o.locale}
            type="button"
            lang={o.locale}
            onClick={() => switchTo(o.locale)}
            disabled={pending}
            aria-pressed={active}
            aria-label={o.name}
            className={`min-w-11 rounded-full px-3 py-1.5 transition-colors ${
              active ? (tone === "inverse" ? "bg-white text-ink shadow-xs" : "bg-surface text-ink shadow-xs") : "hover:text-ink"
            }`}
            data-testid={`locale-${o.locale}`}
          >
            {o.short}
          </button>
        );
      })}
    </div>
  );
}

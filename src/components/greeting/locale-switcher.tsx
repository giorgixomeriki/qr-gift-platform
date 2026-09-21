"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { setLocaleAction } from "@/lib/i18n/actions";

/**
 * Consumer-facing locale toggle (Phase 4 §6) — a sender or recipient may not
 * share the browser/Accept-Language guess request.ts falls back to. Kept
 * tiny and unobtrusive on purpose: this is a corner-of-screen affordance, not
 * a settings page.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  async function switchTo(next: "ka" | "en") {
    if (next === locale) return;
    await setLocaleAction(next, pathname);
    router.refresh();
  }

  return (
    <div className={`flex gap-1 text-xs ${className ?? ""}`} data-testid="locale-switcher">
      <button
        type="button"
        onClick={() => switchTo("ka")}
        className={locale === "ka" ? "font-semibold underline" : "opacity-60"}
        data-testid="locale-ka"
        aria-current={locale === "ka"}
      >
        ქარ
      </button>
      <span aria-hidden="true" className="opacity-40">
        /
      </span>
      <button
        type="button"
        onClick={() => switchTo("en")}
        className={locale === "en" ? "font-semibold underline" : "opacity-60"}
        data-testid="locale-en"
        aria-current={locale === "en"}
      >
        EN
      </button>
    </div>
  );
}

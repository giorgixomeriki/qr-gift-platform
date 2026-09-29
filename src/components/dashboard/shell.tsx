import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LocaleSwitcher } from "@/components/greeting/locale-switcher";
import { NavLinks, type NavItem } from "./nav-links";

/**
 * Chrome for the partner and admin dashboards. One top bar (brand, area,
 * nav, language, sign out); nav collapses into a horizontally scrollable row
 * under the bar on phones instead of a hamburger — there are only a few
 * destinations and they should stay one tap away.
 */
export function DashboardShell({
  area,
  nav,
  signOutAction,
  signOutLabel,
  children,
}: {
  area: string;
  nav?: NavItem[];
  signOutAction: () => Promise<void>;
  signOutLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <div className="flex shrink-0 items-center gap-2">
            <Logo className="text-[0.9375rem]" />
            <span className="hidden rounded-full bg-sunken px-2 py-0.5 text-caption font-medium text-ink-2 sm:inline">{area}</span>
          </div>
          {nav && (
            <div className="hidden min-w-0 flex-1 md:block">
              <NavLinks items={nav} />
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <LocaleSwitcher />
            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-label text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              >
                <LogOut className="size-4" aria-hidden />
                <span className="hidden sm:inline">{signOutLabel}</span>
                <span className="sr-only sm:hidden">{signOutLabel}</span>
              </button>
            </form>
          </div>
        </div>
        {nav && (
          <div className="border-t border-line px-4 md:hidden">
            <NavLinks items={nav} />
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

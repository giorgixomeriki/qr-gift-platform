import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

/**
 * Chrome for the sender flow on /g/*: a quiet header and a single readable
 * column. Deliberately no navigation — every screen has one job and one
 * primary action, which lives in <ActionBar>.
 */
export function FlowShell({
  children,
  headerStart,
  headerEnd,
  width = "narrow",
}: {
  children: ReactNode;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  width?: "narrow" | "wide";
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 bg-paper/85 pt-[var(--safe-top)] backdrop-blur-md supports-[backdrop-filter]:bg-paper/75">
        <div
          className={`px-page mx-auto flex h-14 w-full items-center justify-between gap-3 ${
            width === "wide" ? "max-w-5xl" : "max-w-xl"
          }`}
        >
          <div className="flex min-w-0 items-center gap-1">{headerStart ?? <Logo className="text-[0.9375rem]" />}</div>
          <div className="flex shrink-0 items-center gap-3">{headerEnd}</div>
        </div>
      </header>
      <main
        className={`px-page mx-auto flex w-full flex-1 flex-col ${width === "wide" ? "max-w-5xl" : "max-w-xl"}`}
      >
        {children}
      </main>
    </div>
  );
}

/**
 * Bottom-anchored primary action. Sticky (not fixed) so it never covers the
 * last field when the mobile keyboard is open, and padded for the home
 * indicator on notched phones.
 */
export function ActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-auto px-4 pt-6 pb-[max(1rem,var(--safe-bottom))] sm:-mx-6 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-paper from-60% to-paper/0"
      />
      <div className="relative flex flex-col gap-2">
        {children}
        {note && <p className="text-center text-caption text-ink-3">{note}</p>}
      </div>
    </div>
  );
}

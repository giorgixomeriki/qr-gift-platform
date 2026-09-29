import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

/**
 * Shared frame for every sign-in / password screen (admin and partner): the
 * brand, the area it belongs to, and a single focused card. Calm and
 * professional — this is a workplace tool, not the emotional gifting surface.
 */
export function AuthShell({ area, children }: { area?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center px-5 pt-[max(3.5rem,var(--safe-top))] pb-12 sm:justify-center sm:px-4 sm:py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center gap-2 sm:mb-8 sm:justify-center">
          <Logo className="text-lg" />
          {area && (
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-caption font-medium text-ink-2">{area}</span>
          )}
        </div>
        {/* Phones: the form sits directly on paper. Larger screens: a quiet card. */}
        <div className="animate-rise sm:rounded-[var(--radius-lg)] sm:bg-surface sm:p-8 sm:shadow-sm sm:ring-1 sm:ring-line">{children}</div>
      </div>
    </main>
  );
}

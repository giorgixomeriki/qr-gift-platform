import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

/**
 * Shared frame for every sign-in / password screen (admin and partner): the
 * brand, the area it belongs to, and a single focused card. Calm and
 * professional — this is a workplace tool, not the emotional gifting surface.
 */
export function AuthShell({ area, children }: { area?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <Logo className="text-lg" />
          {area && (
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-caption font-medium text-ink-2">{area}</span>
          )}
        </div>
        <div className="animate-rise rounded-[var(--radius-xl)] bg-surface p-6 shadow-md ring-1 ring-line sm:p-8">{children}</div>
      </div>
    </main>
  );
}

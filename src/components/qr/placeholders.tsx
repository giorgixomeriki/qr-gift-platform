import { getTranslations } from "next-intl/server";

/**
 * Remaining structural placeholders: BLOCKED (moderation — no content to show
 * either way) and a DRAFT visited without edit access (someone else's
 * in-progress draft, or a lost/cleared cookie). The ACTIVE recipient route
 * has a real experience — see components/greeting/recipient-view.tsx.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-950 p-8 text-center text-neutral-200">
      {children}
    </main>
  );
}

export async function DraftNoAccessPlaceholder() {
  const t = await getTranslations("sender.noAccess");
  return (
    <Shell>
      <p className="text-lg">{t("title")}</p>
      <p className="mt-2 max-w-xs text-sm text-neutral-500">{t("body")}</p>
    </Shell>
  );
}

export async function BlockedPlaceholder() {
  const t = await getTranslations("qr");
  return (
    <Shell>
      <p className="text-lg">{t("unavailableTitle")}</p>
      <p className="mt-2 max-w-xs text-sm text-neutral-500">{t("unavailableBody")}</p>
    </Shell>
  );
}

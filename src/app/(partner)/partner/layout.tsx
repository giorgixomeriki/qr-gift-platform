import { getTranslations } from "next-intl/server";
import { DashboardShell } from "@/components/dashboard/shell";
import { signOutAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Partner dashboard chrome. Deliberately its own layout, isolated from the
 * bare root layout the sender/recipient surfaces use — this is a "professional
 * operational dashboard" (architecture plan §20), not the emotional surface.
 * The login page lives under this same layout, so it stays chrome-free by
 * checking session state here rather than needing a second layout.
 */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    return <div className="flex min-h-dvh flex-col">{children}</div>;
  }

  const t = await getTranslations("nav");

  return (
    <DashboardShell area={t("partnerArea")} signOutAction={signOutAction.bind(null, "/partner/login")} signOutLabel={t("signOut")}>
      {children}
    </DashboardShell>
  );
}

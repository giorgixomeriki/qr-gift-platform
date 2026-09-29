import { getTranslations } from "next-intl/server";
import { DashboardShell } from "@/components/dashboard/shell";
import { signOutAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    return <div className="flex min-h-dvh flex-col">{children}</div>;
  }

  const t = await getTranslations("nav");

  return (
    <DashboardShell
      area={t("adminArea")}
      nav={[
        { href: "/admin/dashboard", label: t("dashboard") },
        { href: "/admin/partners", label: t("partners") },
        { href: "/admin/moderation", label: t("moderation") },
      ]}
      signOutAction={signOutAction.bind(null, "/admin/login")}
      signOutLabel={t("signOut")}
    >
      {children}
    </DashboardShell>
  );
}

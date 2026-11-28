import { getTranslations } from "next-intl/server";
import { DashboardShell } from "@/components/dashboard/shell";
import { signOutAction } from "@/lib/auth/actions";
import { currentAdminMfaPause, getAdminAccess } from "@/lib/auth/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { access } = await getAdminAccess();

  // No navigation until sign-in is complete. Presentation only: every page
  // and action enforces access itself (requireAdminPage / requireAdmin).
  if (access === "ANONYMOUS" || access === "MFA_LOCKED" || access === "MFA_ENROLL" || access === "MFA_CHALLENGE") {
    return <div className="flex min-h-dvh flex-col">{children}</div>;
  }

  const t = await getTranslations("nav");

  return (
    <DashboardShell
      area={t("adminArea")}
      nav={[
        { href: "/admin/dashboard", label: t("dashboard") },
        { href: "/admin/partners", label: t("partners") },
        { href: "/admin/inventory", label: t("inventory") },
        { href: "/admin/moderation", label: t("moderation") },
        { href: "/admin/security", label: t("security") },
      ]}
      signOutAction={signOutAction.bind(null, "/admin/login")}
      signOutLabel={t("signOut")}
    >
      {access === "GRANTED_MFA_PAUSED" && <MfaPausedBanner text={pausedText(t)} />}
      {children}
    </DashboardShell>
  );
}

function pausedText(t: Awaited<ReturnType<typeof getTranslations<"nav">>>): string {
  const pause = currentAdminMfaPause();
  const until = pause.active ? pause.until.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "";
  return t("mfaPausedBanner", { until });
}

function MfaPausedBanner({ text }: { text: string }) {
  return (
    <p role="status" className="mb-4 rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {text}
    </p>
  );
}

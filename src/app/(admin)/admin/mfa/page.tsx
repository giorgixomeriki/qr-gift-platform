import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { MfaChallengeForm } from "@/components/auth/mfa-forms";
import { Button } from "@/components/ui/button";
import { getAdminAccess } from "@/lib/auth/admin";
import { signOutAction } from "@/lib/auth/actions";
import { ADMIN_MFA_ENROLL_PATH } from "@/lib/auth/assurance";

export const dynamic = "force-dynamic";

export default async function AdminMfaChallengePage() {
  const { access, user, factors } = await getAdminAccess();
  if (!user) redirect("/admin/login");
  if (access === "MFA_ENROLL") redirect(ADMIN_MFA_ENROLL_PATH);
  if (access !== "MFA_CHALLENGE") redirect("/admin/dashboard");

  const [t, tNav, locale] = await Promise.all([getTranslations("auth"), getTranslations("nav"), getLocale()]);
  const options = factors.map((f) => ({
    id: f.id,
    label: t("mfa.addedOn", { date: new Date(f.createdAt).toLocaleDateString(locale === "ka" ? "ka-GE" : "en-GB") }),
  }));

  return (
    <AuthShell area={t("areaAdmin")}>
      <MfaChallengeForm factors={options} doneHref="/admin/dashboard" />
      <form action={signOutAction.bind(null, "/admin/login")} className="mt-4">
        <Button type="submit" variant="secondary" size="md" block>{tNav("signOut")}</Button>
      </form>
    </AuthShell>
  );
}

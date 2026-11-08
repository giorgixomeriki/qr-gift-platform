import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { MfaEnrollment } from "@/components/auth/mfa-forms";
import { Button } from "@/components/ui/button";
import { getAdminAccess } from "@/lib/auth/admin";
import { signOutAction } from "@/lib/auth/actions";
import { ADMIN_MFA_CHALLENGE_PATH } from "@/lib/auth/assurance";

export const dynamic = "force-dynamic";

export default async function AdminMfaSetupPage() {
  const { access, user } = await getAdminAccess();
  if (!user) redirect("/admin/login");
  if (access === "MFA_CHALLENGE") redirect(ADMIN_MFA_CHALLENGE_PATH);
  if (access !== "MFA_ENROLL") redirect("/admin/dashboard");

  const [t, tNav] = await Promise.all([getTranslations("auth"), getTranslations("nav")]);
  return (
    <AuthShell area={t("areaAdmin")}>
      <MfaEnrollment title={t("mfa.setupTitle")} body={t("mfa.setupBody")} doneHref="/admin/dashboard" />
      <form action={signOutAction.bind(null, "/admin/login")} className="mt-4">
        <Button type="submit" variant="secondary" size="md" block>{tNav("signOut")}</Button>
      </form>
    </AuthShell>
  );
}

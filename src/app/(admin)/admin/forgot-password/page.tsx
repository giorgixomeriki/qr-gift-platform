import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default async function AdminForgotPasswordPage() {
  const t = await getTranslations("auth");
  return (
    <AuthShell area={t("areaAdmin")}>
      <ForgotPasswordForm title={t("forgotPasswordTitle")} loginHref="/admin/login" role="admin" />
    </AuthShell>
  );
}

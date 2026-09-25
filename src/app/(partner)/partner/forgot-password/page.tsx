import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default async function PartnerForgotPasswordPage() {
  const t = await getTranslations("auth");
  return (
    <AuthShell area={t("areaPartner")}>
      <ForgotPasswordForm title={t("forgotPasswordTitle")} loginHref="/partner/login" role="partner" />
    </AuthShell>
  );
}

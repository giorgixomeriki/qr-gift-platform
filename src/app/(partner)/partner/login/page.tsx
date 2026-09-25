import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export default async function PartnerLoginPage() {
  const t = await getTranslations("auth");
  return (
    <AuthShell area={t("areaPartner")}>
      <LoginForm
        title={t("partnerLoginTitle")}
        subtitle={t("partnerLoginBody")}
        redirectTo="/partner/dashboard"
        forgotPasswordHref="/partner/forgot-password"
      />
    </AuthShell>
  );
}

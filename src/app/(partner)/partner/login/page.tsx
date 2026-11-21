import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { PartnerLogin } from "@/components/auth/partner-login";
import { env } from "@/lib/env";

export default async function PartnerLoginPage() {
  const t = await getTranslations("auth");
  return (
    <AuthShell area={t("areaPartner")}>
      <PartnerLogin
        title={t("partnerLoginTitle")}
        subtitle={t("partnerLoginBody")}
        redirectTo="/partner/dashboard"
        forgotPasswordHref="/partner/forgot-password"
        phoneEnabled={env.PARTNER_PHONE_AUTH_ENABLED}
      />
    </AuthShell>
  );
}

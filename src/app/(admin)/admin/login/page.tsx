import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export default async function AdminLoginPage() {
  const t = await getTranslations("auth");
  return (
    <AuthShell area={t("areaAdmin")}>
      <LoginForm title={t("adminLoginTitle")} subtitle={t("adminLoginBody")} redirectTo="/admin/dashboard" forgotPasswordHref="/admin/forgot-password" />
    </AuthShell>
  );
}

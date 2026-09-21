import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";

export default async function AdminLoginPage() {
  const t = await getTranslations("auth");
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-neutral-950 p-8">
      <LoginForm title={t("adminLoginTitle")} redirectTo="/admin/dashboard" />
    </main>
  );
}

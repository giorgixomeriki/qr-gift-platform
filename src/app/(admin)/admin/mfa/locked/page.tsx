import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { getAdminAccess } from "@/lib/auth/admin";
import { signOutAction } from "@/lib/auth/actions";

export const dynamic = "force-dynamic";

/** An admin with no usable factor and no enrollment grant. Offers nothing but signing out. */
export default async function AdminMfaLockedPage() {
  const { access, user } = await getAdminAccess();
  if (!user) redirect("/admin/login");
  if (access !== "MFA_LOCKED") redirect("/admin/dashboard");

  const [t, tNav] = await Promise.all([getTranslations("auth"), getTranslations("nav")]);
  return (
    <AuthShell area={t("areaAdmin")}>
      <div className="flex flex-col gap-3" data-testid="mfa-locked">
        <h1 className="font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{t("mfa.lockedTitle")}</h1>
        <p className="text-body-sm text-ink-2">{t("mfa.lockedBody")}</p>
      </div>
      <form action={signOutAction.bind(null, "/admin/login")} className="mt-6">
        <Button type="submit" variant="secondary" size="md" block>{tNav("signOut")}</Button>
      </form>
    </AuthShell>
  );
}

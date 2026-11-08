import { getLocale, getTranslations } from "next-intl/server";
import { MfaFactorsPanel } from "@/components/admin/mfa-factors-panel";
import { NotAdmin } from "@/components/admin/not-admin";
import { PageHeader, Panel } from "@/components/dashboard/ui";
import { getAdminAccess, requireAdminPage } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  const { user, isAdmin } = await requireAdminPage();
  const t = await getTranslations("admin");
  if (!isAdmin) return <NotAdmin message={t("notAdmin", { email: user.email ?? "" })} />;

  const [tMfa, locale, { factors }] = await Promise.all([getTranslations("auth.mfa"), getLocale(), getAdminAccess()]);
  const rows = factors.map((f) => ({ id: f.id, addedOn: new Date(f.createdAt).toLocaleDateString(locale === "ka" ? "ka-GE" : "en-GB") }));

  return (
    <div className="flex flex-col gap-10" data-testid="admin-security-page">
      <PageHeader title={tMfa("securityTitle")} description={tMfa("securityBody")} />
      <Panel title={tMfa("factorsTitle")}>
        <MfaFactorsPanel factors={rows} />
      </Panel>
    </div>
  );
}

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { checkIsAdmin } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { listOpenReports, listStaleDrafts } from "@/lib/moderation/service";
import { NotAdmin } from "@/components/admin/not-admin";
import { ModerationSearch, OpenReportsList, StaleDraftsList } from "@/components/admin/moderation-panel";
import { PageHeader, Panel } from "@/components/dashboard/ui";

/**
 * Admin moderation (Phase 4 §12/§13) — operational metadata only, never
 * Greeting content. Every Block/Unblock is reason-required and audit logged
 * (see lib/moderation/service.ts); "stale drafts" is visibility only, no
 * automatic recycling.
 */
export default async function AdminModerationPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("admin");
  const isAdmin = await checkIsAdmin(user.id);
  if (!isAdmin) return <NotAdmin message={t("notAdmin", { email: user.email ?? "" })} />;

  const { reports, staleDrafts } = await requireAdmin(async (tx) => ({
    reports: await listOpenReports(tx),
    staleDrafts: await listStaleDrafts(tx, 14),
  }));
  const tm = await getTranslations("admin.moderation");

  return (
    <div className="flex flex-col gap-8" data-testid="admin-moderation-page">
      <PageHeader title={tm("title")} description={tm("subtitle")} />

      <Panel title={tm("findTitle")} description={tm("contentHiddenNote")}>
        <ModerationSearch />
      </Panel>

      <Panel title={tm("openReportsTitle", { count: reports.length })} flush>
        <OpenReportsList reports={reports} />
      </Panel>

      <Panel title={tm("staleDraftsTitle", { count: staleDrafts.length })} description={tm("staleDraftsNote")} flush>
        <StaleDraftsList drafts={staleDrafts} />
      </Panel>
    </div>
  );
}

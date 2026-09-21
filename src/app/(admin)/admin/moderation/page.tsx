import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { checkIsAdmin } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { listOpenReports, listStaleDrafts } from "@/lib/moderation/service";
import { ModerationSearch, OpenReportsList, StaleDraftsList } from "@/components/admin/moderation-panel";

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
  if (!isAdmin) {
    return <p className="text-sm text-neutral-400">{t("notAdmin", { email: user.email ?? "" })}</p>;
  }

  const { reports, staleDrafts } = await requireAdmin(async (tx) => ({
    reports: await listOpenReports(tx),
    staleDrafts: await listStaleDrafts(tx, 14),
  }));
  const tm = await getTranslations("admin.moderation");

  return (
    <div className="flex flex-col gap-8" data-testid="admin-moderation-page">
      <div>
        <h1 className="text-lg font-medium text-neutral-100">{tm("title")}</h1>
        <p className="text-sm text-neutral-500">{tm("subtitle")}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-300">{tm("findTitle")}</h2>
        <ModerationSearch />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-300">{tm("openReportsTitle", { count: reports.length })}</h2>
        <OpenReportsList reports={reports} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-300">{tm("staleDraftsTitle", { count: staleDrafts.length })}</h2>
        <p className="text-xs text-neutral-600">{tm("staleDraftsNote")}</p>
        <StaleDraftsList drafts={staleDrafts} />
      </section>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { checkIsAdmin } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminMetrics } from "@/lib/dashboard/admin-metrics";
import { formatMinorAmount } from "@/lib/format/money";
import { ReconcileActivationsButton } from "@/components/admin/reconcile-activations-button";
import { NotAdmin } from "@/components/admin/not-admin";
import { PageHeader, Panel, Stat, StatGroup, table } from "@/components/dashboard/ui";
import { buttonClasses } from "@/components/ui/button";

/**
 * Real platform-wide aggregates (Phase 1 — "no fake data"), computed live
 * from the RLS-scoped admin transaction on every request. Admin authorization
 * is re-verified server-side (requireAdmin) — this page's own guard is not
 * the enforcement boundary.
 */
export default async function AdminDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("admin");
  const isAdmin = await checkIsAdmin(user.id);
  if (!isAdmin) return <NotAdmin message={t("notAdmin", { email: user.email ?? "" })} />;

  const metrics = await requireAdmin((tx) => getAdminMetrics(tx));
  const td = await getTranslations("admin.dashboard");
  const tStage = await getTranslations("admin.dashboard.funnel.stages");
  const tNav = await getTranslations("nav");
  const locale = await getLocale();
  const maxCount = Math.max(1, ...metrics.funnel.map((s) => s.count));

  return (
    <div className="flex flex-col gap-10" data-testid="admin-dashboard-page">
      <PageHeader
        title={td("title")}
        description={t("signedInAs", { email: user.email ?? "" })}
        actions={
          <Link href="/admin/partners" className={buttonClasses({ variant: "secondary", size: "md" })}>
            {tNav("managePartners")}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      />

      <StatGroup title={td("salesTitle")}>
        <Stat label={td("stats.successfulSales")} value={metrics.successfulSales} testId="metric-sales" />
        <Stat
          label={td("stats.partnerCommissions")}
          value={formatMinorAmount(metrics.totalCommissionMinor, "GEL", locale, { fixed: true })}
          testId="metric-commissions"
        />
        <Stat
          label={td("stats.partners")}
          value={td("activeOfTotal", { active: metrics.activePartnerCount, total: metrics.partnerCount })}
          testId="metric-partners"
        />
        <Stat label={td("stats.qrBatches")} value={metrics.batchCount} testId="metric-batches" />
      </StatGroup>

      <StatGroup title={td("cardsTitle")}>
        <Stat label={td("stats.qrGenerated")} value={metrics.qrGenerated} testId="metric-qr-generated" />
        <Stat label={td("stats.qrDistributed")} value={metrics.qrDistributed} testId="metric-qr-distributed" />
        <Stat label={td("stats.qrActive")} value={metrics.qrActive} testId="metric-qr-active" />
        <Stat label={td("stats.qrBlocked")} value={metrics.qrBlocked} testId="metric-qr-blocked" />
      </StatGroup>

      <Panel title={td("funnel.title")} description={td("funnel.description")} testId="admin-funnel" flush>
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>{td("funnel.stageHeader")}</th>
                <th className={`${table.th} w-2/5`}>
                  <span className="sr-only">{td("funnel.countHeader")}</span>
                </th>
                <th className={`${table.th} text-right`}>{td("funnel.countHeader")}</th>
                <th className={`${table.th} text-right`}>{td("funnel.vsPreviousHeader")}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.funnel.map((stage) => (
                <tr key={stage.key} className={table.tr} data-testid="funnel-row">
                  <td className={`${table.td} whitespace-nowrap text-ink`}>{tStage(stage.key)}</td>
                  <td className={table.td} aria-hidden>
                    <div className="h-2 w-full min-w-24 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-ember" style={{ width: `${(stage.count / maxCount) * 100}%` }} />
                    </div>
                  </td>
                  <td className={`${table.td} text-right font-medium tabular-nums`}>{stage.count}</td>
                  <td className={`${table.td} text-right tabular-nums text-ink-3`}>
                    {stage.conversionFromPreviousPct === null ? "—" : `${stage.conversionFromPreviousPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={td("maintenanceTitle")} description={td("maintenanceHint")}>
        <ReconcileActivationsButton />
      </Panel>
    </div>
  );
}

import Link from "next/link";
import { ArrowRight, ScanLine } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAdmin, requireAdminPage } from "@/lib/auth/admin";
import { getAdminMetrics } from "@/lib/dashboard/admin-metrics";
import { getPhysicalInventorySummary } from "@/lib/qr/handovers";
import { getReconcileHealth } from "@/lib/payments/reconcile-heartbeat";
import { formatMinorAmount } from "@/lib/format/money";
import { ReconcileActivationsButton } from "@/components/admin/reconcile-activations-button";
import { NotAdmin } from "@/components/admin/not-admin";
import { Badge, PageHeader, Panel, Stat, StatGroup, table } from "@/components/dashboard/ui";
import { ButtonLink, buttonClasses } from "@/components/ui/button";

/**
 * Real platform-wide aggregates (Phase 1 — "no fake data"), computed live
 * from the RLS-scoped admin transaction on every request. Admin authorization
 * is re-verified server-side (requireAdmin) — this page's own guard is not
 * the enforcement boundary.
 */
const RECONCILE_TONE = { OK: "success", ATTENTION: "warning", FAILING: "danger", STALE: "danger", NEVER: "neutral" } as const;

export default async function AdminDashboardPage() {
  const { user, isAdmin } = await requireAdminPage();

  const t = await getTranslations("admin");
  if (!isAdmin) return <NotAdmin message={t("notAdmin", { email: user.email ?? "" })} />;

  const { metrics, reconcile, physical } = await requireAdmin(async (tx) => ({
    metrics: await getAdminMetrics(tx),
    reconcile: await getReconcileHealth(tx),
    physical: await getPhysicalInventorySummary(tx),
  }));
  const th = await getTranslations("handover");
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

      <Panel title={td("reconcile.title")} description={td("reconcile.description")} testId="admin-reconcile-health">
        <div className="flex flex-wrap items-center gap-3 text-body-sm">
          <span data-testid="reconcile-status">
            <Badge tone={RECONCILE_TONE[reconcile.status]}>{td(`reconcile.status.${reconcile.status}`)}</Badge>
          </span>
          <span className="text-ink-2">
            {reconcile.lastSuccessAt
              ? td("reconcile.lastSuccess", { when: reconcile.lastSuccessAt.toLocaleString(locale === "ka" ? "ka-GE" : "en-GB", { timeZone: "Asia/Tbilisi", dateStyle: "medium", timeStyle: "short" }) })
              : td("reconcile.noSuccess")}
          </span>
          {reconcile.lastRemaining !== null && reconcile.lastRemaining > 0 && (
            <span className="text-danger">{td("reconcile.open", { count: reconcile.lastRemaining })}</span>
          )}
        </div>
        {!reconcile.scheduleConfigured && (
          <p className={`mt-2 text-caption ${reconcile.required ? "text-danger" : "text-ink-3"}`}>
            {td(reconcile.required ? "reconcile.notConfiguredRequired" : "reconcile.notConfigured")}
          </p>
        )}
      </Panel>

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

      <div className="flex flex-col gap-3" data-testid="admin-physical-inventory">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-label text-ink-2">{th("inventory.physicalTitle")}</h2>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/admin/inventory" variant="secondary" size="sm">{tNav("inventory")}</ButtonLink>
            <ButtonLink href="/admin/inventory/scan" size="sm" icon={<ScanLine className="size-4" aria-hidden />} data-testid="dashboard-scan-assign">
              {th("inventory.scanCta")}
            </ButtonLink>
          </div>
        </div>
        <StatGroup>
          <Stat label={th("inventory.stats.inCentral")} value={physical.inCentralStock} testId="metric-central-stock" />
          <Stat label={th("inventory.stats.reserved")} value={physical.reserved} testId="metric-reserved" />
          <Stat label={th("inventory.stats.heldByPartners")} value={physical.heldByPartners} testId="metric-held-by-partners" />
          <Stat label={th("inventory.stats.openHandovers")} value={physical.pendingHandovers + physical.disputedHandovers} testId="metric-open-handovers" />
        </StatGroup>
      </div>

      <Panel title={td("funnel.title")} description={td("funnel.description")} testId="admin-funnel" flush>
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>{td("funnel.stageHeader")}</th>
                <th className={`${table.th} hidden w-2/5 sm:table-cell`}>
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
                  <td className={`${table.td} hidden sm:table-cell`} aria-hidden>
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

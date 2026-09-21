import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { checkIsAdmin } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminMetrics } from "@/lib/dashboard/admin-metrics";
import { ReconcileActivationsButton } from "@/components/admin/reconcile-activations-button";

function Stat({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div className="rounded border border-neutral-800 p-4" data-testid={testId}>
      <p className="text-xs uppercase text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-100">{value}</p>
    </div>
  );
}

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
  if (!isAdmin) {
    return <p className="text-sm text-neutral-400">{t("notAdmin", { email: user.email ?? "" })}</p>;
  }

  const metrics = await requireAdmin((tx) => getAdminMetrics(tx));
  const td = await getTranslations("admin.dashboard");
  const tStage = await getTranslations("admin.dashboard.funnel.stages");
  const tNav = await getTranslations("nav");

  return (
    <div className="flex flex-col gap-6" data-testid="admin-dashboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-neutral-100">{td("title")}</h1>
          <p className="text-sm text-neutral-500">{t("signedInAs", { email: user.email ?? "" })}</p>
        </div>
        <Link href="/admin/partners" className="text-sm underline text-neutral-300">
          {tNav("managePartners")}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={td("stats.partners")} value={td("activeOfTotal", { active: metrics.activePartnerCount, total: metrics.partnerCount })} testId="metric-partners" />
        <Stat label={td("stats.qrBatches")} value={metrics.batchCount} testId="metric-batches" />
        <Stat label={td("stats.qrGenerated")} value={metrics.qrGenerated} testId="metric-qr-generated" />
        <Stat label={td("stats.qrDistributed")} value={metrics.qrDistributed} testId="metric-qr-distributed" />
        <Stat label={td("stats.qrActive")} value={metrics.qrActive} testId="metric-qr-active" />
        <Stat label={td("stats.qrBlocked")} value={metrics.qrBlocked} testId="metric-qr-blocked" />
        <Stat label={td("stats.successfulSales")} value={metrics.successfulSales} testId="metric-sales" />
        <Stat
          label={td("stats.partnerCommissions")}
          value={(metrics.totalCommissionMinor / 100).toFixed(2)}
          testId="metric-commissions"
        />
      </div>

      <section className="flex flex-col gap-2" data-testid="admin-funnel">
        <h2 className="text-sm font-medium text-neutral-300">{td("funnel.title")}</h2>
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-neutral-500">
                <th className="px-3 py-2">{td("funnel.stageHeader")}</th>
                <th className="px-3 py-2">{td("funnel.countHeader")}</th>
                <th className="px-3 py-2">{td("funnel.vsPreviousHeader")}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.funnel.map((stage) => (
                <tr key={stage.key} className="border-t border-neutral-800" data-testid="funnel-row">
                  <td className="px-3 py-1.5 text-neutral-300">{tStage(stage.key)}</td>
                  <td className="px-3 py-1.5 font-medium text-neutral-100">{stage.count}</td>
                  <td className="px-3 py-1.5 text-neutral-500">
                    {stage.conversionFromPreviousPct === null ? "—" : `${stage.conversionFromPreviousPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ReconcileActivationsButton />
    </div>
  );
}

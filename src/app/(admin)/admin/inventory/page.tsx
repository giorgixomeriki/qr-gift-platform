import Link from "next/link";
import { ArrowRight, ScanLine, PackageOpen } from "lucide-react";
import { eq, sql } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAdmin, requireAdminPage } from "@/lib/auth/admin";
import { orders } from "@/db/schema";
import { getCentralStockPartner, getPhysicalInventorySummary, listHandovers, type HandoverStatus } from "@/lib/qr/handovers";
import { formatBusinessDateTime } from "@/lib/format/datetime";
import { NotAdmin } from "@/components/admin/not-admin";
import { CentralStockButton } from "@/components/admin/central-stock-button";
import { HANDOVER_STATUS_TONE } from "@/components/admin/handover-status";
import { Badge, EmptyState, PageHeader, Panel, Stat, StatGroup, control, table } from "@/components/dashboard/ui";
import { Button, ButtonLink } from "@/components/ui/button";

const STATUSES: HandoverStatus[] = ["PENDING", "DISPUTED", "ACCEPTED", "REJECTED", "CANCELLED"];

/**
 * Physical QR inventory (Scan-to-Assign). Where cards are (central stock /
 * reserved / partners) is shown separately from what customers did with them
 * (status) and from real sales, never summed into one figure. The existing
 * per-partner batch workflow is untouched; this page only adds to it.
 */
export default async function AdminInventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { user, isAdmin } = await requireAdminPage();
  const tAdmin = await getTranslations("admin");
  if (!isAdmin) return <NotAdmin message={tAdmin("notAdmin", { email: user.email ?? "" })} />;

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const status = STATUSES.includes(params.status as HandoverStatus) ? (params.status as HandoverStatus) : undefined;

  const data = await requireAdmin(async (tx) => {
    const [paid] = await tx.select({ count: sql<number>`count(*)::int` }).from(orders).where(eq(orders.status, "PAID"));
    return {
      central: await getCentralStockPartner(tx),
      summary: await getPhysicalInventorySummary(tx),
      handovers: await listHandovers(tx, { q, status }),
      paidSales: paid?.count ?? 0,
    };
  });

  const t = await getTranslations("handover");
  const locale = await getLocale();
  const s = data.summary;
  const actor = (type: string | null, id: string | null) =>
    !id ? "—" : type === "PARTNER" ? t("inventory.history.byPartner") : id === user.id ? t("inventory.history.byYou") : t("inventory.history.byAdmin");

  return (
    <div className="flex flex-col gap-10" data-testid="admin-inventory-page">
      <PageHeader
        title={t("inventory.title")}
        description={t("inventory.description")}
        actions={
          <ButtonLink href="/admin/inventory/scan" size="lg" icon={<ScanLine className="size-5" aria-hidden />} data-testid="scan-assign-cta">
            {t("inventory.scanCta")}
          </ButtonLink>
        }
      />

      <Panel title={t("inventory.central.title")} description={t("inventory.central.dormant")} testId="central-stock-panel">
        {data.central ? (
          <Link href={`/admin/partners/${data.central.id}`} className="inline-flex items-center gap-1 text-label text-ink underline-offset-4 hover:underline" data-testid="central-stock-link">
            {t("inventory.central.manage")} — {data.central.name}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-body-sm text-ink-2">{t("inventory.central.none")}</p>
            <CentralStockButton />
          </div>
        )}
      </Panel>

      <StatGroup title={t("inventory.physicalTitle")} columns={3}>
        <Stat label={t("inventory.stats.generated")} value={s.generated} testId="inv-generated" />
        <Stat label={t("inventory.stats.inCentral")} value={s.inCentralStock} testId="inv-central" />
        <Stat label={t("inventory.stats.centralFree")} value={s.centralFree} testId="inv-central-free" />
        <Stat label={t("inventory.stats.reserved")} value={s.reserved} testId="inv-reserved" />
        <Stat label={t("inventory.stats.received")} value={s.receivedByPartners} testId="inv-received" />
        <Stat label={t("inventory.stats.heldByPartners")} value={s.heldByPartners} testId="inv-held" />
      </StatGroup>

      <StatGroup title={t("inventory.lifecycleTitle")}>
        <Stat label={t("inventory.stats.available")} value={s.available} testId="inv-available" />
        <Stat label={t("inventory.stats.draft")} value={s.draft} testId="inv-draft" />
        <Stat label={t("inventory.stats.active")} value={s.active} testId="inv-active" />
        <Stat label={t("inventory.stats.blocked")} value={s.blocked} testId="inv-blocked" />
      </StatGroup>

      <StatGroup title={t("inventory.salesTitle")} columns={3}>
        <Stat label={t("inventory.stats.paidSales")} value={data.paidSales} tone="accent" testId="inv-paid-sales" />
        <Stat label={t("inventory.stats.openHandovers")} value={s.pendingHandovers} testId="inv-open-handovers" />
        <Stat label={t("inventory.stats.disputed")} value={s.disputedHandovers} testId="inv-disputed" />
      </StatGroup>

      <Panel title={t("inventory.history.title")} flush testId="handover-history">
        <form className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row" method="get">
          <input name="q" defaultValue={q} placeholder={t("inventory.history.search")} aria-label={t("inventory.history.search")} className={control} data-testid="handover-search" />
          <select name="status" defaultValue={status ?? ""} aria-label={t("inventory.history.status")} className={`${control} sm:w-56`} data-testid="handover-status-filter">
            <option value="">{t("inventory.history.allStatuses")}</option>
            {STATUSES.map((st) => (
              <option key={st} value={st}>{t(`status.${st}`)}</option>
            ))}
          </select>
          <Button type="submit" variant="secondary">{t("inventory.history.filter")}</Button>
        </form>
        {data.handovers.length === 0 ? (
          <EmptyState icon={<PackageOpen aria-hidden />} title={t("inventory.history.empty")} />
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>{t("inventory.history.partner")}</th>
                  <th className={`${table.th} text-right`}>{t("inventory.history.quantity")}</th>
                  <th className={table.th}>{t("inventory.history.created")}</th>
                  <th className={table.th}>{t("inventory.history.status")}</th>
                  <th className={table.th}>{t("inventory.history.createdBy")}</th>
                  <th className={table.th}>{t("inventory.history.resolvedBy")}</th>
                  <th className={table.th}><span className="sr-only">{t("inventory.history.details")}</span></th>
                </tr>
              </thead>
              <tbody>
                {data.handovers.map((h) => (
                  <tr key={h.id} className={table.tr} data-testid="handover-row" data-status={h.status}>
                    <td className={`${table.td} text-ink`}>{h.toPartnerName}</td>
                    <td className={`${table.td} text-right tabular-nums`}>{h.quantity}</td>
                    <td className={`${table.td} whitespace-nowrap text-ink-2`}>{formatBusinessDateTime(h.createdAt, locale)}</td>
                    <td className={table.td}><Badge tone={HANDOVER_STATUS_TONE[h.status]}>{t(`status.${h.status}`)}</Badge></td>
                    <td className={`${table.td} text-ink-2`}>{actor("ADMIN", h.createdBy)}</td>
                    <td className={`${table.td} text-ink-2`}>{actor(h.resolvedActorType, h.resolvedBy)}</td>
                    <td className={`${table.td} text-right`}>
                      <Link href={`/admin/inventory/handovers/${h.id}`} className="text-label text-ink underline-offset-4 hover:underline">{t("inventory.history.details")}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

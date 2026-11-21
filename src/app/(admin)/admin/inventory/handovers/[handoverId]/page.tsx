import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAdmin, requireAdminPage } from "@/lib/auth/admin";
import { getHandoverDetail } from "@/lib/qr/handovers";
import { handoverIdSchema } from "@/lib/validation/handovers";
import { formatBusinessDateTime } from "@/lib/format/datetime";
import { NotAdmin } from "@/components/admin/not-admin";
import { HandoverAdminActions } from "@/components/admin/handover-admin-actions";
import { HANDOVER_STATUS_TONE } from "@/components/admin/handover-status";
import { Badge, PageHeader, Panel, table } from "@/components/dashboard/ui";
import { Notice } from "@/components/ui/notice";

/** One handover: the exact cards (token hint only — no greeting content), their status and holder, and admin resolution. */
export default async function AdminHandoverDetailPage({ params }: { params: Promise<{ handoverId: string }> }) {
  const { handoverId } = await params;
  const { user, isAdmin } = await requireAdminPage();
  const tAdmin = await getTranslations("admin");
  if (!isAdmin) return <NotAdmin message={tAdmin("notAdmin", { email: user.email ?? "" })} />;
  if (!handoverIdSchema.safeParse(handoverId).success) notFound();

  const h = await requireAdmin((tx) => getHandoverDetail(tx, handoverId));
  if (!h) notFound();

  const t = await getTranslations("handover");
  const tQr = await getTranslations("enums.qrStatus");
  const locale = await getLocale();
  const when = (d: Date | null) => (d ? formatBusinessDateTime(d, locale) : "—");

  return (
    <div className="flex flex-col gap-8" data-testid="admin-handover-detail">
      <div className="flex flex-col gap-3">
        <Link href="/admin/inventory" className="-ml-1 inline-flex w-fit items-center gap-1 text-label text-ink-2 hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden />
          {t("detail.back")}
        </Link>
        <PageHeader
          title={t("detail.title", { partner: h.toPartnerName })}
          actions={<span data-testid="handover-status"><Badge tone={HANDOVER_STATUS_TONE[h.status]}>{t(`status.${h.status}`)}</Badge></span>}
        />
      </div>

      <Panel>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-body-sm sm:grid-cols-2">
          <div><dt className="text-caption text-ink-3">{t("detail.from")}</dt><dd>{t("detail.centralStock")}</dd></div>
          <div><dt className="text-caption text-ink-3">{t("detail.to")}</dt><dd><Link className="underline-offset-4 hover:underline" href={`/admin/partners/${h.toPartnerId}`}>{h.toPartnerName}</Link></dd></div>
          <div><dt className="text-caption text-ink-3">{t("detail.quantity")}</dt><dd className="tabular-nums" data-testid="handover-quantity">{h.quantity}</dd></div>
          <div><dt className="text-caption text-ink-3">{t("detail.created")}</dt><dd>{when(h.createdAt)}</dd></div>
          <div><dt className="text-caption text-ink-3">{t("detail.resolved")}</dt><dd>{when(h.resolvedAt)}</dd></div>
          {h.note && <div><dt className="text-caption text-ink-3">{t("detail.note")}</dt><dd>{h.note}</dd></div>}
          {h.resolutionNote && <div><dt className="text-caption text-ink-3">{t("detail.resolutionNote")}</dt><dd>{h.resolutionNote}</dd></div>}
        </dl>
      </Panel>

      {h.disputeNote && (
        <Notice tone="warning" title={t("detail.disputeTitle")}>
          {h.disputeReceivedCount !== null && <p>{t("detail.disputeCount", { count: h.disputeReceivedCount })}</p>}
          <p data-testid="handover-dispute-note">{h.disputeNote}</p>
        </Notice>
      )}

      {(h.status === "PENDING" || h.status === "DISPUTED") && (
        <Panel title={t("detail.actions")}>
          <HandoverAdminActions handoverId={h.id} status={h.status} />
        </Panel>
      )}

      <Panel title={t("detail.cardsTitle")} flush>
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>{t("detail.card")}</th>
                <th className={table.th}>{t("detail.cardStatus")}</th>
                <th className={table.th}>{t("detail.holder")}</th>
                <th className={table.th}>{t("detail.reservation")}</th>
              </tr>
            </thead>
            <tbody>
              {h.items.map((item, i) => (
                <tr key={item.hint + i} className={table.tr} data-testid="handover-item">
                  <td className={`${table.td} font-mono text-caption`}>{i + 1}. {item.hint}</td>
                  <td className={table.td}>{tQr(item.status as "AVAILABLE" | "DRAFT" | "ACTIVE" | "BLOCKED")}</td>
                  <td className={`${table.td} text-ink-2`}>{item.ownerName}</td>
                  <td className={`${table.td} text-ink-2`}>{item.reserved ? t("detail.reserved") : t("detail.released")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

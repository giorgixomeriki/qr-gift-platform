import { getLocale, getTranslations } from "next-intl/server";
import { Panel, table } from "@/components/dashboard/ui";
import { formatMinorAmount } from "@/lib/format/money";
import type { QrResultRow } from "@/lib/dashboard/attribution";

/** Per-card results (lib/dashboard/attribution.ts getQrResults). Server-rendered; no greeting content. */
export async function QrResultsTable({ rows, currency }: { rows: QrResultRow[]; currency: string }) {
  const t = await getTranslations("partnerAccess.qrResults");
  const tStatus = await getTranslations("enums.qrStatus");
  const locale = await getLocale();
  const money = (minor: number) => formatMinorAmount(minor, currency, locale, { fixed: true });

  return (
    <Panel title={t("title")} description={t("hint")} flush testId="partner-qr-results">
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.thead}>
            <tr>
              <th className={table.th}>{t("colCard")}</th>
              <th className={table.th}>{t("colBatch")}</th>
              <th className={table.th}>{t("colStatus")}</th>
              <th className={`${table.th} text-right`}>{t("colScans")}</th>
              <th className={`${table.th} text-right`}>{t("colPaid")}</th>
              <th className={`${table.th} text-right`}>{t("colRevenue")}</th>
              <th className={`${table.th} text-right`}>{t("colCommission")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.qrCodeId} className={table.tr} data-testid="partner-qr-result-row">
                <td className={`${table.td} font-mono text-caption`}>{r.label}</td>
                <td className={`${table.td} text-ink-2`}>{r.batchLabel}</td>
                <td className={`${table.td} whitespace-nowrap text-ink-2`}>
                  {tStatus(r.status as "AVAILABLE")} · {r.distributionStatus === "DISTRIBUTED" ? t("handedOver") : t("inStock")}
                </td>
                <td className={`${table.td} text-right tabular-nums`}>{r.scans}</td>
                <td className={`${table.td} text-right tabular-nums`}>{r.paidActivations}</td>
                <td className={`${table.td} text-right tabular-nums`}>{money(r.grossMinor)}</td>
                <td className={`${table.td} text-right tabular-nums`}>{money(r.netCommissionMinor)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-center text-caption text-ink-3">
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

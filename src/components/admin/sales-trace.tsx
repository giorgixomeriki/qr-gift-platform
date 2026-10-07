"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Badge, table } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { formatMinorAmount } from "@/lib/format/money";
import { formatBusinessDateTime } from "@/lib/business-calendar";

type SaleRow = {
  orderId: string;
  orderStatus: string;
  paidAt: string | Date | null;
  createdAt: string | Date;
  qrPublicToken: string;
  batchLabel: string;
  currency: string;
  grossAmountMinor: number;
  partnerCommissionMinor: number;
  commissionRateBps: number | null;
  paymentProvider: string | null;
  providerPaymentId: string | null;
  commissionEarnedMinor: number | null;
  commissionReversedMinor: number | null;
};

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Admin financial trace for one partner: each money-bearing order with its
 * QR, batch, payment and ledger outcome on one row. No greeting content.
 * Refund is confirmation-gated inline (same pattern as PayoutManager).
 */
export function SalesTrace({
  rows,
  refundAction,
}: {
  rows: SaleRow[];
  refundAction: (orderId: string) => Promise<ActionResult<{ alreadyRefunded: boolean }>>;
}) {
  const t = useTranslations("salesTrace");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const money = (minor: number, cur: string) => formatMinorAmount(minor, cur, locale, { fixed: true });
  // Business timezone, not the admin's browser zone — matches payout periods.
  const fmt = (d: string | Date) => formatBusinessDateTime(d, locale);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refund(orderId: string) {
    setPending(true);
    setError(null);
    const result = await refundAction(orderId);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirming(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col" data-testid="sales-trace">
      {error && (
        <p className="px-5 pt-4 text-caption text-danger" role="alert" data-testid="sales-trace-error">
          {error}
        </p>
      )}
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.thead}>
            <tr>
              <th className={table.th}>{t("paidHeader")}</th>
              <th className={table.th}>{t("qrHeader")}</th>
              <th className={table.th}>{t("orderHeader")}</th>
              <th className={table.th}>{t("paymentHeader")}</th>
              <th className={`${table.th} text-right`}>{t("grossHeader")}</th>
              <th className={`${table.th} text-right`}>{t("commissionHeader")}</th>
              <th className={table.th}>{t("statusHeader")}</th>
              <th className={table.th}>
                <span className="sr-only">{t("actionsHeader")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.orderId} className={table.tr} data-testid="sales-trace-row">
                <td className={`${table.td} whitespace-nowrap text-ink-2`}>{fmt(r.paidAt ?? r.createdAt)}</td>
                <td className={table.td}>
                  <span className="block font-mono text-caption">{r.qrPublicToken}</span>
                  <span className="block text-caption text-ink-3">{r.batchLabel}</span>
                </td>
                <td className={`${table.td} font-mono text-caption`} title={r.orderId}>
                  {r.orderId.slice(0, 8)}
                </td>
                <td className={`${table.td} text-caption`}>
                  <span className="block">{r.paymentProvider ?? "—"}</span>
                  <span className="block max-w-[14rem] truncate font-mono text-ink-3" title={r.providerPaymentId ?? undefined}>
                    {r.providerPaymentId ?? "—"}
                  </span>
                </td>
                <td className={`${table.td} text-right tabular-nums`}>{money(r.grossAmountMinor, r.currency)}</td>
                <td className={`${table.td} text-right tabular-nums`}>
                  <span className="block">{money(r.partnerCommissionMinor, r.currency)}</span>
                  {r.commissionRateBps !== null && <span className="block text-caption text-ink-3">{t("rate", { pct: r.commissionRateBps / 100 })}</span>}
                </td>
                <td className={table.td}>
                  {r.commissionReversedMinor !== null ? (
                    <Badge tone="warning">{t("statusReversed")}</Badge>
                  ) : r.commissionEarnedMinor !== null ? (
                    <Badge tone="success">{t("statusEarned")}</Badge>
                  ) : r.orderStatus === "REFUND_REQUIRED" ? (
                    <Badge tone="danger">{t("statusRefundRequired")}</Badge>
                  ) : (
                    <Badge>{t("statusNoCommission")}</Badge>
                  )}
                </td>
                <td className={`${table.td} whitespace-nowrap text-right`}>
                  {r.orderStatus === "PAID" &&
                    (confirming === r.orderId ? (
                      <span className="inline-flex gap-2">
                        <Button size="sm" variant="danger" loading={pending} onClick={() => refund(r.orderId)} data-testid="sales-trace-refund-confirm">
                          {t("refundConfirm")}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                          {tCommon("cancel")}
                        </Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(r.orderId)} data-testid="sales-trace-refund">
                        {t("refund")}
                      </Button>
                    ))}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-caption text-ink-3">
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

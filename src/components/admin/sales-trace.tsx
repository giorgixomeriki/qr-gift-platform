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
  chargedBack?: boolean;
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
  chargebackAction,
  evidenceAction,
}: {
  rows: SaleRow[];
  refundAction: (orderId: string) => Promise<ActionResult<{ alreadyRefunded: boolean; pending?: boolean }>>;
  chargebackAction: (orderId: string, input: { reference: string; disputedOn: string }) => Promise<ActionResult<{ commissionReversedMinor: number }>>;
  evidenceAction: (orderId: string) => Promise<ActionResult<unknown>>;
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
  const [notice, setNotice] = useState<string | null>(null);
  // Chargeback: which row's form is open, and its two fields.
  const [chargeback, setChargeback] = useState<{ orderId: string; reference: string; disputedOn: string; confirm: boolean } | null>(null);

  async function recordChargeback() {
    if (!chargeback) return;
    setPending(true);
    setError(null);
    setNotice(null);
    const result = await chargebackAction(chargeback.orderId, { reference: chargeback.reference, disputedOn: chargeback.disputedOn });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setChargeback(null);
    setNotice(t("chargebackRecorded"));
    router.refresh();
  }

  async function downloadEvidence(orderId: string) {
    setError(null);
    const result = await evidenceAction(orderId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dispute-evidence-${orderId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function refund(orderId: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    const result = await refundAction(orderId);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirming(null);
    // An asynchronous provider (BOG) confirms the refund later; until then the
    // order stays PAID and nothing is reversed.
    if (result.data.pending) setNotice(t("refundRequested"));
    router.refresh();
  }

  return (
    <div className="flex flex-col" data-testid="sales-trace">
      {error && (
        <p className="px-5 pt-4 text-caption text-danger" role="alert" data-testid="sales-trace-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="px-5 pt-4 text-caption text-ink-2" role="status" data-testid="sales-trace-notice">
          {notice}
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
                  {r.chargedBack ? (
                    <Badge tone="danger">{t("statusChargedBack")}</Badge>
                  ) : r.commissionReversedMinor !== null ? (
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
                  {chargeback?.orderId === r.orderId ? (
                    <span className="inline-flex flex-wrap items-center justify-end gap-2" data-testid="sales-trace-chargeback-form">
                      <input
                        aria-label={t("chargebackReference")}
                        placeholder={t("chargebackReference")}
                        value={chargeback.reference}
                        maxLength={100}
                        onChange={(e) => setChargeback({ ...chargeback, reference: e.target.value, confirm: false })}
                        className="h-9 w-40 rounded-md border border-line px-2 text-caption"
                        data-testid="sales-trace-chargeback-reference"
                      />
                      <input
                        type="date"
                        aria-label={t("chargebackDate")}
                        value={chargeback.disputedOn}
                        onChange={(e) => setChargeback({ ...chargeback, disputedOn: e.target.value, confirm: false })}
                        className="h-9 rounded-md border border-line px-2 text-caption"
                        data-testid="sales-trace-chargeback-date"
                      />
                      {chargeback.confirm ? (
                        <Button size="sm" variant="danger" loading={pending} onClick={recordChargeback} data-testid="sales-trace-chargeback-confirm">
                          {t("chargebackConfirm")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={!chargeback.reference.trim() || !chargeback.disputedOn}
                          onClick={() => setChargeback({ ...chargeback, confirm: true })}
                          data-testid="sales-trace-chargeback-next"
                        >
                          {t("chargebackRecord")}
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setChargeback(null)}>
                        {tCommon("cancel")}
                      </Button>
                    </span>
                  ) : (
                  <span className="inline-flex gap-2">
                  {(r.orderStatus === "PAID" || r.orderStatus === "REFUNDED") && (
                    <Button size="sm" variant="secondary" onClick={() => downloadEvidence(r.orderId)} data-testid="sales-trace-evidence">
                      {t("evidence")}
                    </Button>
                  )}
                  {r.orderStatus === "PAID" && confirming !== r.orderId && (
                    <Button size="sm" variant="secondary" onClick={() => setChargeback({ orderId: r.orderId, reference: "", disputedOn: "", confirm: false })} data-testid="sales-trace-chargeback">
                      {t("chargeback")}
                    </Button>
                  )}
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
                  </span>
                  )}
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

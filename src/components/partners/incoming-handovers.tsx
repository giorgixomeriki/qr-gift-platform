"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Panel, control, fieldLabel } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { HANDOVER_STATUS_TONE } from "@/components/admin/handover-status";
import { partnerReportDiscrepancyAction } from "@/lib/qr/handover-actions";

export type PartnerTransferView = {
  id: string;
  quantity: number;
  status: "PENDING" | "DISPUTED" | "ACCEPTED" | "REJECTED" | "CANCELLED";
  /** When the cards arrived (resolved_at), or when a legacy handover was created. */
  atLabel: string;
  reported: boolean;
};

/**
 * "QR cards from QR STARR" on the partner dashboard — read-only. QR STARR's
 * admin transfers cards and they are in this partner's inventory at once;
 * there is nothing to accept or approve. A partner may report that the
 * physical count doesn't match: support only, the transfer is not reversed.
 */
export function IncomingHandovers({ transfers, canReport }: { transfers: PartnerTransferView[]; canReport: boolean }) {
  const t = useTranslations("handover");
  const latest = transfers.find((h) => h.status === "ACCEPTED");
  return (
    <Panel title={t("partner.title")} description={t("partner.hint")} testId="incoming-handovers">
      <div className="flex flex-col gap-4">
        {latest && (
          <Notice tone="success">
            <span data-testid="handover-notification">
              {t("partner.added", { count: latest.quantity })}
              <span className="text-caption text-ink-3"> · {latest.atLabel}</span>
            </span>
          </Notice>
        )}
        <div className="flex flex-col gap-1.5">
          <p className="text-caption font-medium text-ink-2">{t("partner.historyTitle")}</p>
          <ul className="flex flex-col divide-y divide-line" data-testid="handover-recent">
            {transfers.map((h) => (
              <TransferRow key={h.id} transfer={h} canReport={canReport} />
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function TransferRow({ transfer: h, canReport }: { transfer: PartnerTransferView; canReport: boolean }) {
  const t = useTranslations("handover");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(h.reported);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const received = count.trim() === "" ? null : Number(count);
    const r = await partnerReportDiscrepancyAction({ handoverId: h.id, receivedCount: received, note }).catch(() => ({ ok: false as const, error: "unknown" as const }));
    setBusy(false);
    if (!r.ok) return setError(t(`errors.${r.error}`, { count: 0 }));
    setOpen(false);
    setSent(true);
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-2 py-2" data-testid="partner-transfer" data-status={h.status}>
      <div className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
        <span>{h.atLabel}</span>
        <span className="tabular-nums" data-testid="partner-transfer-quantity">· {t("partner.quantity", { count: h.quantity })}</span>
        <Badge tone={HANDOVER_STATUS_TONE[h.status]}>{t(`status.${h.status}`)}</Badge>
        {h.status === "ACCEPTED" && canReport && !sent && !open && (
          <button type="button" className="text-caption text-ink-3 underline underline-offset-4 hover:text-ink" onClick={() => setOpen(true)} data-testid="handover-report-open">
            {t("partner.report")}
          </button>
        )}
        {sent && <span className="text-caption text-ink-3" data-testid="handover-report-sent">{t("partner.reportSent")}</span>}
      </div>
      {open && (
        <form onSubmit={send} className="flex flex-col gap-3 rounded-md p-3 ring-1 ring-line" data-testid="handover-report-form">
          <p className="text-caption text-ink-3">{t("partner.reportHint")}</p>
          <label className={fieldLabel}>
            {t("partner.disputeCount")}
            <input type="number" inputMode="numeric" min={0} max={10000} value={count} onChange={(e) => setCount(e.target.value)} className={`${control} w-32 tabular-nums`} data-testid="handover-report-count" />
          </label>
          <label className={fieldLabel}>
            {t("partner.disputeNote")}
            <textarea required maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={`${control} h-auto py-2`} data-testid="handover-report-note" />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" loading={busy} data-testid="handover-report-send">{t("partner.send")}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("partner.cancel")}</Button>
          </div>
        </form>
      )}
      {error && <p className="text-caption text-danger" role="alert" data-testid="handover-error">{error}</p>}
    </li>
  );
}

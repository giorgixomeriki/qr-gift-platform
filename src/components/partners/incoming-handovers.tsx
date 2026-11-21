"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PackageCheck } from "lucide-react";
import { Badge, Panel, control, fieldLabel } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { HANDOVER_STATUS_TONE } from "@/components/admin/handover-status";
import { partnerAcceptHandoverAction, partnerDisputeHandoverAction } from "@/lib/qr/handover-actions";

export type PartnerHandoverView = {
  id: string;
  quantity: number;
  status: "PENDING" | "DISPUTED" | "ACCEPTED" | "REJECTED" | "CANCELLED";
  createdAtLabel: string;
};

/**
 * "Incoming QR cards" on the partner dashboard. The partner counts the
 * physical cards, then confirms receipt (ownership moves atomically on the
 * server) or reports a discrepancy (kept for QR STARR to resolve).
 */
export function IncomingHandovers({ open, recent, canReceive }: { open: PartnerHandoverView[]; recent: PartnerHandoverView[]; canReceive: boolean }) {
  const t = useTranslations("handover");
  return (
    <Panel title={t("partner.title")} description={t("partner.hint")} testId="incoming-handovers">
      <div className="flex flex-col gap-4">
        {open.length === 0 && <p className="text-caption text-ink-3">{t("partner.noIncoming")}</p>}
        {open.map((h) => (
          <IncomingCard key={h.id} handover={h} canReceive={canReceive} />
        ))}
        {recent.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-caption font-medium text-ink-2">{t("partner.historyTitle")}</p>
            <ul className="flex flex-col gap-1" data-testid="handover-recent">
              {recent.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
                  <span>{h.createdAtLabel}</span>
                  <span className="tabular-nums">· {t("partner.quantity", { count: h.quantity })}</span>
                  <Badge tone={HANDOVER_STATUS_TONE[h.status]}>{t(`status.${h.status}`)}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

function IncomingCard({ handover: h, canReceive }: { handover: PartnerHandoverView; canReceive: boolean }) {
  const t = useTranslations("handover");
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "confirm" | "dispute">("idle");
  const [checked, setChecked] = useState(false);
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    const r = await partnerAcceptHandoverAction(h.id).catch(() => ({ ok: false as const, error: "unknown" as const }));
    setBusy(false);
    if (!r.ok) return setError(t(`errors.${r.error}`, { count: ("ineligibleCount" in r && r.ineligibleCount) || 0 }));
    setSuccess(true);
    router.refresh();
  }

  async function dispute(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const received = count.trim() === "" ? null : Number(count);
    const r = await partnerDisputeHandoverAction({ handoverId: h.id, receivedCount: received, note }).catch(() => ({ ok: false as const, error: "unknown" as const }));
    setBusy(false);
    if (!r.ok) return setError(t(`errors.${r.error}`, { count: 0 }));
    setMode("idle");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-md p-4 ring-1 ring-line" data-testid="incoming-handover" data-status={h.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-ember-soft text-ember-ink"><PackageCheck className="size-5" aria-hidden /></div>
          <div>
            <p className="text-label text-ink">{t("partner.from")}</p>
            <p className="font-serif text-[1.5rem] leading-tight tabular-nums" data-testid="incoming-quantity">{t("partner.quantity", { count: h.quantity })}</p>
            <p className="text-caption text-ink-3">{t("partner.sentOn", { date: h.createdAtLabel })}</p>
          </div>
        </div>
        <Badge tone={HANDOVER_STATUS_TONE[h.status]}>{t(`status.${h.status}`)}</Badge>
      </div>

      {success && <Notice tone="success">{t("partner.accepted")}</Notice>}
      {h.status === "DISPUTED" && <Notice tone="warning">{t("partner.disputed")}</Notice>}

      {h.status === "PENDING" && canReceive && !success && mode === "idle" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => setMode("confirm")} data-testid="handover-confirm-open">{t("partner.confirm")}</Button>
          <Button variant="secondary" onClick={() => setMode("dispute")} data-testid="handover-dispute-open">{t("partner.report")}</Button>
        </div>
      )}

      {h.status === "PENDING" && canReceive && !success && mode === "confirm" && (
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2 text-body-sm">
            <input type="checkbox" className="mt-1 size-4" checked={checked} onChange={(e) => setChecked(e.target.checked)} data-testid="handover-confirm-check" />
            {t("partner.confirmCheck", { count: h.quantity })}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={accept} loading={busy} disabled={!checked} data-testid="handover-confirm">{t("partner.confirm")}</Button>
            <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy}>{t("partner.cancel")}</Button>
          </div>
        </div>
      )}

      {h.status === "PENDING" && canReceive && !success && mode === "dispute" && (
        <form onSubmit={dispute} className="flex flex-col gap-3" data-testid="handover-dispute-form">
          <label className={fieldLabel}>
            {t("partner.disputeCount")}
            <input type="number" inputMode="numeric" min={0} max={10000} value={count} onChange={(e) => setCount(e.target.value)} className={`${control} w-32 tabular-nums`} data-testid="handover-dispute-count" />
          </label>
          <label className={fieldLabel}>
            {t("partner.disputeNote")}
            <textarea required maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={`${control} h-auto py-2`} data-testid="handover-dispute-note" />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" loading={busy} data-testid="handover-dispute-send">{t("partner.send")}</Button>
            <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy}>{t("partner.cancel")}</Button>
          </div>
        </form>
      )}

      {error && <p className="text-caption text-danger" role="alert" data-testid="handover-error">{error}</p>}
    </div>
  );
}

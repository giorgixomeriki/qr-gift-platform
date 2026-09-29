"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { control, fieldLabel, table } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { formatMinorAmount } from "@/lib/format/money";

type Payout = {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
  periodFrom: string | Date;
  periodTo: string | Date;
  reference: string | null;
  paidAt: string | Date | null;
};

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };


/**
 * Manual payout recording (Phase 5 §16) — accounting inside QR Gift, never a
 * real bank transfer: the admin has already paid the partner some other way
 * and is recording that fact here. Confirmation-gated (mirrors the
 * moderation panel's inline-confirm pattern, not window.confirm()) since
 * this is a financial record, not a casual toggle.
 */
export function PayoutManager({
  partnerId,
  currency,
  unpaidBalanceMinor,
  payouts,
  recordAction,
}: {
  partnerId: string;
  currency: string;
  unpaidBalanceMinor: number;
  payouts: Payout[];
  recordAction: (partnerId: string, input: unknown) => Promise<ActionResult<{ payoutId: string }>>;
}) {
  const t = useTranslations("payoutManager");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const money = (minor: number, cur: string) => formatMinorAmount(minor, cur, locale, { fixed: true });
  const fmt = (d: string | Date) =>
    new Date(d).toLocaleDateString(locale === "ka" ? "ka-GE" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  const today = new Date().toISOString().slice(0, 10);
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState("");
  const [periodFrom, setPeriodFrom] = useState(today);
  const [periodTo, setPeriodTo] = useState(today);
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountMinor = Math.round(Number(amount) * 100);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountMinor) && amountMinor > 0;

  async function submit() {
    setPending(true);
    setError(null);
    const result = await recordAction(partnerId, {
      currency,
      amountMinor,
      periodFrom,
      periodTo,
      reference: reference.trim() || undefined,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    setAmount("");
    setReference("");
    router.refresh();
  }

  const over = amountValid && amountMinor > unpaidBalanceMinor;

  return (
    <div className="flex flex-col" data-testid="payout-manager">
      <div className="flex flex-wrap items-end justify-between gap-4 p-5">
        <div>
          <p className="text-caption text-ink-2">{t("unpaidBalance")}</p>
          <p className="mt-1 text-[1.75rem] leading-none font-medium tabular-nums" data-testid="payout-unpaid-balance">
            {money(unpaidBalanceMinor, currency)}
          </p>
        </div>
        {!confirming && (
          <Button onClick={() => setConfirming(true)} disabled={unpaidBalanceMinor <= 0} data-testid="payout-start">
            {t("recordButton")}
          </Button>
        )}
      </div>

      {confirming && (
        <div className="mx-5 mb-5 flex flex-col gap-4 rounded-[var(--radius-md)] bg-paper p-4 ring-1 ring-line" data-testid="payout-form">
          <p className="text-caption text-ink-2">{t("explainer")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={fieldLabel}>
              <span className="flex items-baseline justify-between gap-2">
                {t("amountLabel", { currency, max: money(unpaidBalanceMinor, currency) })}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={over || undefined}
                className={`${control} tabular-nums aria-invalid:ring-2 aria-invalid:ring-danger`}
                data-testid="payout-amount"
              />
              <button
                type="button"
                onClick={() => setAmount((unpaidBalanceMinor / 100).toFixed(2))}
                className="w-fit text-caption font-normal text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
              >
                {t("useFullBalance")}
              </button>
            </label>
            <label className={fieldLabel}>
              {t("periodFrom")}
              <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} className={control} data-testid="payout-period-from" />
            </label>
            <label className={fieldLabel}>
              {t("periodTo")}
              <input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} className={control} data-testid="payout-period-to" />
            </label>
          </div>
          <label className={fieldLabel}>
            {t("referenceLabel")}
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("referencePlaceholder")}
              className={control}
              data-testid="payout-reference"
            />
          </label>
          {over && (
            <p className="text-caption text-danger" role="alert">
              {t("overBalance")}
            </p>
          )}
          {error && (
            <p className="text-caption text-danger" role="alert" data-testid="payout-error">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={submit} loading={pending} disabled={!amountValid || over} data-testid="payout-confirm">
              {t("confirmButton")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              data-testid="payout-cancel"
            >
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      )}

      <div className={`${table.wrap} border-t border-line`}>
        <table className={table.table}>
          <thead className={table.thead}>
            <tr>
              <th className={table.th}>{t("periodHeader")}</th>
              <th className={`${table.th} text-right`}>{t("amountHeader")}</th>
              <th className={table.th}>{t("referenceHeader")}</th>
              <th className={table.th}>{t("paidHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className={table.tr} data-testid="payout-row">
                <td className={`${table.td} whitespace-nowrap`}>
                  {fmt(p.periodFrom)} – {fmt(p.periodTo)}
                </td>
                <td className={`${table.td} text-right tabular-nums`}>{money(p.amountMinor, p.currency)}</td>
                <td className={`${table.td} text-ink-2`}>{p.reference ?? t("noReference")}</td>
                <td className={`${table.td} whitespace-nowrap text-ink-2`}>{p.paidAt ? fmt(p.paidAt) : t("noReference")}</td>
              </tr>
            ))}
            {payouts.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-caption text-ink-3">
                  {t("noPayouts")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

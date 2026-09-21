"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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

function fmt(d: string | Date) {
  return new Date(d).toLocaleDateString();
}

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
  const router = useRouter();
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

  return (
    <div className="flex flex-col gap-3" data-testid="payout-manager">
      <div className="rounded border border-neutral-800 p-3">
        <p className="text-xs uppercase text-neutral-500">{t("unpaidBalance")}</p>
        <p className="mt-1 text-xl font-semibold text-neutral-100" data-testid="payout-unpaid-balance">
          {(unpaidBalanceMinor / 100).toFixed(2)} {currency}
        </p>
      </div>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={unpaidBalanceMinor <= 0}
          className="w-fit rounded bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 disabled:opacity-50"
          data-testid="payout-start"
        >
          {t("recordButton")}
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded border border-neutral-700 p-3" data-testid="payout-form">
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            {t("amountLabel", { currency, max: (unpaidBalanceMinor / 100).toFixed(2) })}
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-40 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
              data-testid="payout-amount"
            />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              {t("periodFrom")}
              <input
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
                data-testid="payout-period-from"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              {t("periodTo")}
              <input
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
                data-testid="payout-period-to"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            {t("referenceLabel")}
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("referencePlaceholder")}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
              data-testid="payout-reference"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending || !amountValid || amountMinor > unpaidBalanceMinor}
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              data-testid="payout-confirm"
            >
              {pending ? "…" : t("confirmButton")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              className="rounded border border-neutral-700 px-3 py-1.5 text-xs"
              data-testid="payout-cancel"
            >
              {tCommon("cancel")}
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-400" data-testid="payout-error">
              {error}
            </p>
          )}
        </div>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left uppercase text-neutral-500">
            <th className="py-1">{t("periodHeader")}</th>
            <th className="py-1">{t("amountHeader")}</th>
            <th className="py-1">{t("referenceHeader")}</th>
            <th className="py-1">{t("paidHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((p) => (
            <tr key={p.id} className="border-t border-neutral-800" data-testid="payout-row">
              <td className="py-1.5">
                {fmt(p.periodFrom)} – {fmt(p.periodTo)}
              </td>
              <td className="py-1.5">
                {(p.amountMinor / 100).toFixed(2)} {p.currency}
              </td>
              <td className="py-1.5">{p.reference ?? t("noReference")}</td>
              <td className="py-1.5">{p.paidAt ? fmt(p.paidAt) : t("noReference")}</td>
            </tr>
          ))}
          {payouts.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-neutral-500">
                {t("noPayouts")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

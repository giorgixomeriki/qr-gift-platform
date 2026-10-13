"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Badge, control, fieldLabel, table } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { formatMinorAmount } from "@/lib/format/money";
import { formatBusinessDateTime } from "@/lib/business-calendar";
import {
  MAX_PRICE_MINOR,
  MIN_PRICE_MINOR,
  formatBpsAsPercent,
  formatMinorAsMajorInput,
  parseMajorToMinor,
  parsePercentToBps,
  splitCommission,
} from "@/lib/payments/split";
import { adminSetPartnerCommissionAction, adminSetPartnerPriceAction, type PricingActionResult } from "@/lib/payments/pricing-actions";

type Pricing = {
  currency: string;
  defaultPriceMinor: number | null;
  overridePriceMinor: number | null;
  effectivePriceMinor: number | null;
  source: "PARTNER" | "DEFAULT" | "NONE";
  commissionRateBps: number;
  partnerAmountMinor: number | null;
  platformAmountMinor: number | null;
};

type HistoryEntry = {
  id: string;
  action: "PRICING_DEFAULT_PRICE_UPDATED" | "PRICING_PARTNER_PRICE_SET" | "PRICING_PARTNER_PRICE_CLEARED" | "PRICING_PARTNER_COMMISSION_UPDATED";
  actorId: string | null;
  createdAt: string | Date;
  oldValue: number | null;
  newValue: number | null;
};

/**
 * Super Admin controls for one partner's activation price and commission.
 * Everything shown here is a preview computed with the same splitCommission
 * checkout uses; the server re-validates and re-derives every number, and
 * each save carries the value this page loaded so a concurrent edit by
 * another admin is refused rather than overwritten.
 */
export function PartnerPricingManager({ partnerId, pricing, history }: { partnerId: string; pricing: Pricing; history: HistoryEntry[] }) {
  const t = useTranslations("admin.pricing");
  const locale = useLocale();
  const router = useRouter();
  const money = (minor: number) => formatMinorAmount(minor, pricing.currency, locale, { fixed: true });

  const [priceInput, setPriceInput] = useState(pricing.overridePriceMinor === null ? "" : formatMinorAsMajorInput(pricing.overridePriceMinor));
  const [commissionInput, setCommissionInput] = useState(formatBpsAsPercent(pricing.commissionRateBps));
  const [pending, setPending] = useState<"price" | "clear" | "commission" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedPrice = priceInput.trim() === "" ? null : parseMajorToMinor(priceInput);
  const priceValid = parsedPrice !== null && parsedPrice >= MIN_PRICE_MINOR && parsedPrice <= MAX_PRICE_MINOR;
  const parsedBps = parsePercentToBps(commissionInput);

  // Preview of what the next checkout would snapshot, using the edited values.
  const previewPrice = priceValid ? parsedPrice : pricing.overridePriceMinor === null ? pricing.defaultPriceMinor : pricing.overridePriceMinor;
  const previewBps = parsedBps ?? pricing.commissionRateBps;
  const preview = previewPrice === null ? null : splitCommission(previewPrice, previewBps);

  async function run(kind: "price" | "clear" | "commission", call: () => Promise<PricingActionResult>) {
    setPending(kind);
    setError(null);
    const result = await call();
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function savePrice(e: React.FormEvent) {
    e.preventDefault();
    if (!priceValid) {
      setError(t("priceInvalid", { min: money(MIN_PRICE_MINOR), max: money(MAX_PRICE_MINOR) }));
      return;
    }
    void run("price", () => adminSetPartnerPriceAction(partnerId, { amountMinor: parsedPrice, expectedAmountMinor: pricing.overridePriceMinor }));
  }

  function clearPrice() {
    void run("clear", async () => {
      const result = await adminSetPartnerPriceAction(partnerId, { amountMinor: null, expectedAmountMinor: pricing.overridePriceMinor });
      if (result.ok) setPriceInput("");
      return result;
    });
  }

  function saveCommission(e: React.FormEvent) {
    e.preventDefault();
    if (parsedBps === null) {
      setError(t("commissionInvalid"));
      return;
    }
    void run("commission", () =>
      adminSetPartnerCommissionAction(partnerId, { commissionRateBps: parsedBps, expectedCommissionRateBps: pricing.commissionRateBps }),
    );
  }

  const describe = (entry: HistoryEntry) => {
    const fmt = (v: number | null) =>
      entry.action === "PRICING_PARTNER_COMMISSION_UPDATED" ? (v === null ? "—" : `${formatBpsAsPercent(v)}%`) : v === null ? t("defaultShort") : money(v);
    return { label: t(`history.${entry.action}`), change: `${fmt(entry.oldValue)} → ${fmt(entry.newValue)}` };
  };

  return (
    <div className="flex flex-col gap-6" data-testid="partner-pricing-manager">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-caption text-ink-3">{t("effectivePrice")}</dt>
          <dd className="flex items-center gap-2 text-h3 tabular-nums" data-testid="pricing-effective">
            {pricing.effectivePriceMinor === null ? "—" : money(pricing.effectivePriceMinor)}
            <Badge tone={pricing.source === "PARTNER" ? "info" : pricing.source === "DEFAULT" ? "neutral" : "danger"}>{t(`source.${pricing.source}`)}</Badge>
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-caption text-ink-3">{t("partnerAmount", { rate: formatBpsAsPercent(pricing.commissionRateBps) })}</dt>
          <dd className="text-h3 tabular-nums">{pricing.partnerAmountMinor === null ? "—" : money(pricing.partnerAmountMinor)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-caption text-ink-3">{t("platformAmount")}</dt>
          <dd className="text-h3 tabular-nums">{pricing.platformAmountMinor === null ? "—" : money(pricing.platformAmountMinor)}</dd>
        </div>
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={savePrice} className="flex flex-col gap-2" data-testid="partner-price-form">
          <label className={fieldLabel}>
            {t("priceLabel", { currency: pricing.currency })}
            <input
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              placeholder={pricing.defaultPriceMinor === null ? "" : formatMinorAsMajorInput(pricing.defaultPriceMinor)}
              className={`${control} tabular-nums`}
              data-testid="partner-price-input"
            />
          </label>
          <p className="text-caption text-ink-3">
            {pricing.defaultPriceMinor === null ? t("noDefault") : t("priceHint", { price: money(pricing.defaultPriceMinor) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={pending === "price"} disabled={pending !== null} data-testid="partner-price-save">
              {t("savePrice")}
            </Button>
            {pricing.overridePriceMinor !== null && (
              <Button type="button" variant="secondary" loading={pending === "clear"} disabled={pending !== null} onClick={clearPrice} data-testid="partner-price-clear">
                {t("useDefault")}
              </Button>
            )}
          </div>
        </form>

        <form onSubmit={saveCommission} className="flex flex-col gap-2" data-testid="partner-commission-form">
          <label className={fieldLabel}>
            {t("commissionLabel")}
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              value={commissionInput}
              onChange={(e) => setCommissionInput(e.target.value)}
              className={`${control} tabular-nums`}
              data-testid="partner-commission-edit-input"
            />
          </label>
          <p className="text-caption text-ink-3">{t("commissionHint")}</p>
          <div>
            <Button type="submit" loading={pending === "commission"} disabled={pending !== null} data-testid="partner-commission-save">
              {t("saveCommission")}
            </Button>
          </div>
        </form>
      </div>

      {preview && previewPrice !== null && (
        <p className="text-caption text-ink-2 tabular-nums" data-testid="pricing-preview">
          {t("preview", {
            price: money(previewPrice),
            partner: money(preview.partnerCommissionMinor),
            platform: money(preview.platformShareMinor),
          })}
        </p>
      )}

      {error && (
        <p className="text-caption text-danger" role="alert" data-testid="pricing-error">
          {error}
        </p>
      )}

      <p className="text-caption text-ink-3">{t("snapshotNote")}</p>

      {history.length > 0 && (
        <div className={table.wrap}>
          <table className={table.table} data-testid="pricing-history">
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>{t("historyWhen")}</th>
                <th className={table.th}>{t("historyChange")}</th>
                <th className={table.th}>{t("historyValues")}</th>
                <th className={table.th}>{t("historyActor")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => {
                const d = describe(entry);
                return (
                  <tr key={entry.id} className={table.tr}>
                    <td className={`${table.td} whitespace-nowrap tabular-nums`}>{formatBusinessDateTime(entry.createdAt, locale)}</td>
                    <td className={table.td}>{d.label}</td>
                    <td className={`${table.td} tabular-nums`}>{d.change}</td>
                    <td className={`${table.td} font-mono text-caption text-ink-3`}>{entry.actorId?.slice(0, 8) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

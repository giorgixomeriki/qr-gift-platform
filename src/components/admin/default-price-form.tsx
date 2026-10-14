"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { control, fieldLabel } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { formatMinorAmount } from "@/lib/format/money";
import { MAX_PRICE_MINOR, MIN_PRICE_MINOR, formatMinorAsMajorInput, parseMajorToMinor } from "@/lib/payments/split";
import { adminSetDefaultPriceAction } from "@/lib/payments/pricing-actions";

/** Super Admin: the platform-default activation price every partner without an override charges. */
export function DefaultPriceForm({ amountMinor, currency }: { amountMinor: number | null; currency: string }) {
  const t = useTranslations("admin.pricing");
  const locale = useLocale();
  const router = useRouter();
  const [value, setValue] = useState(amountMinor === null ? "" : formatMinorAsMajorInput(amountMinor));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (minor: number) => formatMinorAmount(minor, currency, locale, { fixed: true });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseMajorToMinor(value);
    if (parsed === null || parsed < MIN_PRICE_MINOR || parsed > MAX_PRICE_MINOR) {
      setError(t("priceInvalid", { min: money(MIN_PRICE_MINOR), max: money(MAX_PRICE_MINOR) }));
      return;
    }
    setPending(true);
    setError(null);
    const result = await adminSetDefaultPriceAction({ amountMinor: parsed, expectedAmountMinor: amountMinor });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2" data-testid="default-price-form">
      <div className="grid gap-3 sm:grid-cols-[12rem_auto] sm:items-end sm:justify-start">
        <label className={fieldLabel}>
          {t("defaultPriceLabel", { currency })}
          <input
            required
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={`${control} tabular-nums`}
            data-testid="default-price-input"
          />
        </label>
        <Button type="submit" loading={pending} data-testid="default-price-save">
          {t("savePrice")}
        </Button>
      </div>
      <p className="text-caption text-ink-3">{t("defaultPriceHint")}</p>
      {error && (
        <p className="text-caption text-danger" role="alert" data-testid="default-price-error">
          {error}
        </p>
      )}
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { control, fieldLabel } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";

type ActionResult = { ok: true } | { ok: false; error: string };

export function CreateBatchForm({ createAction }: { createAction: (input: unknown) => Promise<ActionResult> }) {
  const t = useTranslations("createBatchForm");
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await createAction({ label: label.trim(), quantity: Number(quantity) });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLabel("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" data-testid="create-batch-form">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
        <label className={fieldLabel}>
          {t("labelField")}
          <input
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("labelPlaceholder")}
            className={control}
            data-testid="batch-label-input"
          />
        </label>
        <label className={fieldLabel}>
          {t("quantityField")}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={2000}
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={`${control} tabular-nums`}
            data-testid="batch-quantity-input"
          />
        </label>
        <Button type="submit" loading={pending} data-testid="create-batch-submit">
          {t("submitButton")}
        </Button>
      </div>
      <p className="text-caption text-ink-3">{t("quantityHint")}</p>
      {error && (
        <p className="text-caption text-danger" role="alert" data-testid="create-batch-error">
          {error}
        </p>
      )}
    </form>
  );
}

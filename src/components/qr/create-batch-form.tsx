"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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
    const result = await createAction({ label, quantity: Number(quantity) });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLabel("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3" data-testid="create-batch-form">
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        {t("labelField")}
        <input
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("labelPlaceholder")}
          className="w-64 rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          data-testid="batch-label-input"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        {t("quantityField")}
        <input
          type="number"
          min={1}
          max={2000}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-24 rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          data-testid="batch-quantity-input"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        data-testid="create-batch-submit"
      >
        {pending ? "…" : t("submitButton")}
      </button>
      {error && (
        <p className="text-sm text-red-600" data-testid="create-batch-error">
          {error}
        </p>
      )}
    </form>
  );
}

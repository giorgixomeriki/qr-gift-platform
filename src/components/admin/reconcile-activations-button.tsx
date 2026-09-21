"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { reconcileActivationsAction } from "@/lib/payments/admin-actions";

export function ReconcileActivationsButton() {
  const t = useTranslations("admin.reconcile");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setResult(null);
    const response = await reconcileActivationsAction();
    setPending(false);
    if (!response.ok) {
      setResult(response.error);
      return;
    }
    setResult(t("result", { checked: response.data.checked, activated: response.data.activated }));
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 disabled:opacity-50"
        data-testid="reconcile-activations-button"
      >
        {pending ? t("running") : t("button")}
      </button>
      {result && (
        <span className="text-xs text-neutral-500" data-testid="reconcile-activations-result">
          {result}
        </span>
      )}
    </div>
  );
}

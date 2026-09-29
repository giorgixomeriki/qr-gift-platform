"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { reconcileActivationsAction } from "@/lib/payments/admin-actions";

export function ReconcileActivationsButton() {
  const t = useTranslations("admin.reconcile");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setPending(true);
    setResult(null);
    const response = await reconcileActivationsAction();
    setPending(false);
    if (!response.ok) {
      setResult({ ok: false, text: response.error });
      return;
    }
    setResult({ ok: true, text: t("result", { checked: response.data.checked, activated: response.data.activated }) });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        onClick={run}
        loading={pending}
        loadingLabel={t("running")}
        icon={<RefreshCw className="size-4" aria-hidden />}
        data-testid="reconcile-activations-button"
      >
        {t("button")}
      </Button>
      {result && (
        <span className={`text-caption ${result.ok ? "text-ink-2" : "text-danger"}`} role="status" data-testid="reconcile-activations-result">
          {result.text}
        </span>
      )}
    </div>
  );
}

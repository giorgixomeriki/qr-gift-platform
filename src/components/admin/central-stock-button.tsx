"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { adminEnsureCentralStockAction } from "@/lib/qr/handover-actions";

export function CentralStockButton() {
  const t = useTranslations("handover");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await adminEnsureCentralStockAction().catch(() => ({ ok: false as const, error: "unknown" as const }));
          setPending(false);
          if (!result.ok) return setError(t(`errors.${result.error}`, { count: 0 }));
          router.refresh();
        }}
        data-testid="central-stock-create"
      >
        {t("inventory.central.create")}
      </Button>
      {error && <p className="text-caption text-danger" role="alert">{error}</p>}
    </div>
  );
}

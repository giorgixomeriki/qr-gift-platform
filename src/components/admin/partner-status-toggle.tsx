"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { adminSetPartnerStatusAction } from "@/lib/partners/actions";

/**
 * Suspending a partner stops every one of their cards from working, so it
 * takes an inline confirmation; reactivating is harmless and immediate.
 */
export function PartnerStatusToggle({ partnerId, status }: { partnerId: string; status: "ACTIVE" | "SUSPENDED" }) {
  const t = useTranslations("admin.partnerDetail");
  const tStatus = useTranslations("enums.partnerStatus");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setPending(true);
    setError(null);
    const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const result = await adminSetPartnerStatusAction(partnerId, next);
    setPending(false);
    setConfirming(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span data-testid="partner-status-badge">
        <Badge tone={status === "ACTIVE" ? "success" : "danger"}>{tStatus(status)}</Badge>
      </span>
      {confirming ? (
        <>
          <span className="text-caption text-ink-2">{t("suspendConfirm")}</span>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
            {tCommon("cancel")}
          </Button>
          <Button size="sm" onClick={apply} loading={pending} className="bg-danger hover:bg-danger" data-testid="partner-status-confirm">
            {t("suspend")}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant={status === "ACTIVE" ? "danger" : "secondary"}
          onClick={() => (status === "ACTIVE" ? setConfirming(true) : apply())}
          loading={pending}
          data-testid="partner-status-toggle"
        >
          {status === "ACTIVE" ? t("suspend") : t("reactivate")}
        </Button>
      )}
      {error && (
        <span className="text-caption text-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { adminSetPartnerStatusAction } from "@/lib/partners/actions";

export function PartnerStatusToggle({ partnerId, status }: { partnerId: string; status: "ACTIVE" | "SUSPENDED" }) {
  const t = useTranslations("admin.partnerDetail");
  const tStatus = useTranslations("enums.partnerStatus");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const result = await adminSetPartnerStatusAction(partnerId, next);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={`rounded px-2 py-0.5 text-xs font-medium ${
          status === "ACTIVE" ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"
        }`}
        data-testid="partner-status-badge"
      >
        {tStatus(status)}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="text-xs text-neutral-400 underline hover:text-neutral-100 disabled:opacity-50"
        data-testid="partner-status-toggle"
      >
        {pending ? "…" : status === "ACTIVE" ? t("suspend") : t("reactivate")}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

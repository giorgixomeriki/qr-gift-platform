"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { control } from "@/components/dashboard/ui";
import { adminTransitionHandoverAction } from "@/lib/qr/handover-actions";

/** Admin resolution of an open handover: cancel (PENDING), reopen / reject (DISPUTED). */
export function HandoverAdminActions({ handoverId, status }: { handoverId: string; status: "PENDING" | "DISPUTED" }) {
  const t = useTranslations("handover");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(transition: "cancel" | "reopen" | "reject") {
    setBusy(transition);
    setError(null);
    const result = await adminTransitionHandoverAction({ handoverId, transition, note: note.trim() || undefined }).catch(() => ({ ok: false as const, error: "unknown" as const }));
    setBusy(null);
    if (!result.ok) return setError(t(`errors.${result.error}`, { count: 0 }));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3" data-testid="handover-admin-actions">
      <input className={control} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t("detail.resolutionPlaceholder")} data-testid="handover-resolution-note" />
      <div className="flex flex-wrap gap-2">
        {status === "PENDING" && (
          <Button variant="secondary" loading={busy === "cancel"} disabled={busy !== null} onClick={() => run("cancel")} data-testid="handover-cancel">
            {t("detail.cancel")}
          </Button>
        )}
        {status === "DISPUTED" && (
          <>
            <Button variant="secondary" loading={busy === "reopen"} disabled={busy !== null} onClick={() => run("reopen")} data-testid="handover-reopen">
              {t("detail.reopen")}
            </Button>
            <Button variant="secondary" loading={busy === "reject"} disabled={busy !== null} onClick={() => run("reject")} data-testid="handover-reject">
              {t("detail.reject")}
            </Button>
          </>
        )}
      </div>
      {status === "PENDING" && <p className="text-caption text-ink-3">{t("detail.cancelHint")}</p>}
      {error && <p className="text-caption text-danger" role="alert">{error}</p>}
    </div>
  );
}

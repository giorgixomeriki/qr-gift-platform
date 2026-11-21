"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MfaEnrollment, useMfaMessage } from "@/components/auth/mfa-forms";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { removeMfaFactorAction } from "@/lib/auth/mfa-actions";

export function MfaFactorsPanel({ factors }: { factors: { id: string; addedOn: string }[] }) {
  const t = useTranslations("auth.mfa");
  const message = useMfaMessage();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(factorId: string) {
    setRemoving(factorId);
    setError(null);
    const r = await removeMfaFactorAction(factorId);
    setRemoving(null);
    if (!r.ok) return setError(message(r.error));
    router.refresh();
  }

  if (adding) return <MfaEnrollment title={t("backupTitle")} doneHref="/admin/security" onCancel={() => setAdding(false)} />;

  return (
    <div className="flex flex-col gap-4" data-testid="mfa-factors">
      <ul className="flex flex-col divide-y divide-line">
        {factors.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-4 py-3" data-testid="mfa-factor">
            <span className="text-body-sm">{t("addedOn", { date: f.addedOn })}</span>
            {factors.length > 1 && (
              <Button type="button" variant="secondary" size="sm" loading={removing === f.id} onClick={() => remove(f.id)} data-testid="mfa-remove">
                {t("remove")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {factors.length === 1 && <Notice>{t("backupRecommended")}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="button" size="md" onClick={() => setAdding(true)} data-testid="mfa-add-backup">
        {t("addBackup")}
      </Button>
    </div>
  );
}

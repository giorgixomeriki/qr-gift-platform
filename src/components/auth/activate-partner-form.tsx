"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { activatePartnerLinkAction } from "@/lib/partners/login-actions";
import { PASSWORD_MAX_LENGTH_PUBLIC, PASSWORD_MIN_LENGTH_PUBLIC } from "@/lib/partners/login-rules";
import { PasswordField } from "./password-field";

/** Choose a password for an emailed activation / reset link, then sign in. */
export function ActivatePartnerForm({ token, recovery }: { token: string; recovery: boolean }) {
  const t = useTranslations("partnerAccess");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH_PUBLIC || password.length > PASSWORD_MAX_LENGTH_PUBLIC) {
      setError(t("errors.weak_password", { min: PASSWORD_MIN_LENGTH_PUBLIC }));
      return;
    }
    if (password !== confirm) {
      setError(t("activate.mismatch"));
      return;
    }
    setPending(true);
    setError(null);
    const result = await activatePartnerLinkAction(token, password);
    if (!result.ok) {
      setPending(false);
      setError(t(`errors.${result.code}`, { min: PASSWORD_MIN_LENGTH_PUBLIC }));
      return;
    }
    window.location.href = "/partner/dashboard";
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" data-testid="activate-partner-form">
      <p className="text-body-sm text-ink-2">{t("activate.passwordRule", { min: PASSWORD_MIN_LENGTH_PUBLIC })}</p>
      <PasswordField id="activate-password" autoComplete="new-password" label={t("activate.passwordLabel")} value={password} onChange={setPassword} testId="activate-password" minLength={PASSWORD_MIN_LENGTH_PUBLIC} />
      <PasswordField id="activate-confirm" autoComplete="new-password" label={t("activate.confirmLabel")} value={confirm} onChange={setConfirm} testId="activate-confirm" minLength={PASSWORD_MIN_LENGTH_PUBLIC} />
      {error && (
        <Notice tone="danger">
          <span data-testid="activate-error">{error}</span>
        </Notice>
      )}
      <Button type="submit" size="lg" block loading={pending} loadingLabel={t("activate.submitting")} data-testid="activate-submit">
        {recovery ? t("activate.submitRecovery") : t("activate.submit")}
      </Button>
    </form>
  );
}

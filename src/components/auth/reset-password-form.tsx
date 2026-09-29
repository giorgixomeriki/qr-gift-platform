"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck, LinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { PasswordField } from "./password-field";

const LOGIN_HREF: Record<string, string> = {
  admin: "/admin/login",
  partner: "/partner/login",
};

const MIN_LENGTH = 6;

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const role = searchParams.get("role") === "admin" ? "admin" : "partner";
  const loginHref = LOGIN_HREF[role]!;
  const linkInvalid = searchParams.get("error") === "invalid";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (updateError) {
      console.error("[resetPassword]", updateError.message);
      setError(/should be different|same/i.test(updateError.message) ? t("passwordSameAsOld") : t("resetFailed"));
      return;
    }
    setSucceeded(true);
  }

  if (linkInvalid) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
          <LinkIcon className="size-6" strokeWidth={1.75} aria-hidden />
        </span>
        <div>
          <h1 className="font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{t("resetPasswordTitle")}</h1>
          <p className="mt-2 text-body-sm text-ink-2" role="alert" data-testid="reset-link-invalid">
            {t("invalidOrExpiredLink")}
          </p>
        </div>
        <ButtonLink href={role === "admin" ? "/admin/forgot-password" : "/partner/forgot-password"} size="lg" block>
          {t("requestNewLink")}
        </ButtonLink>
      </div>
    );
  }

  if (succeeded) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-success-soft text-success">
          <CircleCheck className="size-7" strokeWidth={1.5} aria-hidden />
        </span>
        <div>
          <h1 className="font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{t("resetPasswordTitle")}</h1>
          <p className="mt-2 text-body-sm text-ink-2" role="status" data-testid="reset-success">
            {t("resetSuccessMessage")}
          </p>
        </div>
        <ButtonLink href={loginHref} size="lg" block>
          {t("backToLogin")}
        </ButtonLink>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{t("resetPasswordTitle")}</h1>
        <p className="mt-2 text-body-sm text-ink-2">{t("passwordRule", { min: MIN_LENGTH })}</p>
      </div>
      <PasswordField
        id="new-password"
        autoComplete="new-password"
        minLength={MIN_LENGTH}
        label={t("newPasswordPlaceholder")}
        value={password}
        onChange={setPassword}
        testId="new-password"
      />
      <PasswordField
        id="confirm-password"
        autoComplete="new-password"
        minLength={MIN_LENGTH}
        label={t("confirmPasswordPlaceholder")}
        value={confirmPassword}
        onChange={setConfirmPassword}
        testId="confirm-password"
      />
      {error && (
        <Notice tone="danger">
          <span data-testid="reset-password-error">{error}</span>
        </Notice>
      )}
      <Button type="submit" size="lg" block loading={pending} loadingLabel={t("settingPassword")} data-testid="reset-password-submit">
        {t("setNewPasswordButton")}
      </Button>
      <Link href={loginHref} className="self-center text-label text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
        {t("backToLogin")}
      </Link>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { formatGeorgianMobile, normalizeGeorgianMobile } from "@/lib/partners/contact";
import { requestPartnerPhoneCodeAction, verifyPartnerPhoneCodeAction } from "@/lib/partners/login-actions";

/**
 * Partner sign-in with a Georgian mobile number and an SMS code. The code is
 * sent and checked by Supabase Auth via server actions (rate-limited there);
 * the "code sent" step reads the same whether or not the number is a partner.
 */
export function PhoneLoginForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations("partnerAccess");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const normalized = normalizeGeorgianMobile(phone);
    if (!normalized) {
      setError(t("errors.invalid_phone"));
      return;
    }
    setPending(true);
    setError(null);
    const result = await requestPartnerPhoneCodeAction(normalized);
    setPending(false);
    if (!result.ok) {
      setError(t(`errors.${result.code}`, { min: 0 }));
      return;
    }
    setSentTo(normalized);
    setCode("");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setPending(true);
    setError(null);
    const result = await verifyPartnerPhoneCodeAction(sentTo, code);
    if (!result.ok) {
      setPending(false);
      setError(t(`errors.${result.code}`, { min: 0 }));
      return;
    }
    // Full navigation, same reason as LoginForm: the session cookie was just set.
    window.location.href = redirectTo;
  }

  if (!sentTo) {
    return (
      <form onSubmit={send} className="flex flex-col gap-5" data-testid="phone-login-form">
        <TextField
          id="login-phone"
          type="tel"
          required
          autoComplete="tel-national"
          inputMode="tel"
          label={t("login.phoneLabel")}
          placeholder={t("login.phonePlaceholder")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          data-testid="login-phone"
        />
        {error && (
          <Notice tone="danger">
            <span data-testid="phone-login-error">{error}</span>
          </Notice>
        )}
        <Button type="submit" size="lg" block loading={pending} loadingLabel={t("login.sendingCode")} data-testid="phone-send-code">
          {t("login.sendCode")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="flex flex-col gap-5" data-testid="phone-verify-form">
      <p className="text-body-sm text-ink-2" data-testid="phone-code-sent">
        {t("login.codeSentBody", { phone: formatGeorgianMobile(sentTo) })}
      </p>
      <TextField
        id="login-code"
        required
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        label={t("login.codeLabel")}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="tracking-[0.3em] tabular-nums"
        data-testid="login-code"
      />
      {error && (
        <Notice tone="danger">
          <span data-testid="phone-login-error">{error}</span>
        </Notice>
      )}
      <Button type="submit" size="lg" block loading={pending} loadingLabel={t("login.verifying")} data-testid="phone-verify">
        {t("login.verify")}
      </Button>
      <div className="flex justify-between gap-3 text-label">
        <button type="button" className="text-ink-2 underline underline-offset-4 hover:text-ink" onClick={() => setSentTo(null)}>
          {t("login.changeNumber")}
        </button>
        <button type="button" className="text-ink-2 underline underline-offset-4 hover:text-ink" disabled={pending} onClick={() => void send()}>
          {t("login.resend")}
        </button>
      </div>
    </form>
  );
}

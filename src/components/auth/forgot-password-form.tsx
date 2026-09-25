"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env.public";

/**
 * "Forgot password" request form for the admin/partner login surfaces.
 * Deliberately shows the SAME success message whether or not the email
 * belongs to a real account (Supabase's own resetPasswordForEmail already
 * behaves this way server-side — it never returns a distinguishable "no such
 * user" error) to close the account-enumeration vector end to end, not just
 * at the API layer.
 */
export function ForgotPasswordForm({
  title,
  loginHref,
  role,
}: {
  title: string;
  loginHref: string;
  /** Threaded through the reset link so /reset-password knows which login page to send the user back to. */
  role: "admin" | "partner";
}) {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);

    const supabase = createSupabaseBrowserClient();
    await supabase.auth
      .resetPasswordForEmail(email.trim(), {
        redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/confirm?next=${role}`,
      })
      .catch(() => {
        // Deliberately swallowed — see the doc comment above. A network/rate-limit
        // failure here must not produce a different outcome than success, or the
        // response shape itself becomes an enumeration side-channel.
      });

    setPending(false);
    setSubmitted(true);
  }

  const backLink = (
    <Link
      href={loginHref}
      className="self-center text-label text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
      data-testid="back-to-login"
    >
      {t("backToLogin")}
    </Link>
  );

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-success-soft text-success">
          <MailCheck className="size-7" strokeWidth={1.5} aria-hidden />
        </span>
        <div>
          <h1 className="text-h2">{t("checkInboxTitle")}</h1>
          <p className="mt-2 text-body-sm text-ink-2" role="status" data-testid="reset-email-sent">
            {t("resetEmailSentMessage")}
          </p>
        </div>
        {backLink}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <h1 className="text-h2">{title}</h1>
        <p className="mt-1 text-body-sm text-ink-2">{t("forgotPasswordBody")}</p>
      </div>
      <TextField
        id="forgot-password-email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        label={t("emailLabel")}
        placeholder={t("emailPlaceholder")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        data-testid="forgot-password-email"
      />
      <Button type="submit" size="lg" block loading={pending} loadingLabel={t("sendingLink")} data-testid="forgot-password-submit">
        {t("requestNewLink")}
      </Button>
      {backLink}
    </form>
  );
}

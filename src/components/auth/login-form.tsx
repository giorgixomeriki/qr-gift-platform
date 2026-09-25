"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { PasswordField } from "./password-field";

export function LoginForm({
  title,
  subtitle,
  redirectTo,
  forgotPasswordHref,
}: {
  title: string;
  subtitle?: string;
  redirectTo: string;
  /** Where "Forgot password?" points — the role-specific reset-request page (admin vs partner). */
  forgotPasswordHref: string;
}) {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (signInError) {
      setPending(false);
      // Supabase's messages are English and technical; map the common case to
      // clear, localized copy that doesn't reveal which field was wrong.
      setError(signInError.status === 400 || /invalid/i.test(signInError.message) ? t("invalidCredentials") : t("signInFailed"));
      return;
    }
    // A full navigation, not router.push()+router.refresh(): the browser
    // client's signInWithPassword sets the session cookie client-side, and an
    // immediate client-side transition can race the very next server render
    // reading that cookie before it's fully written (observed directly: a
    // real "Unexpected end of JSON input" server error parsing a
    // partially-propagated Supabase auth cookie). A full page load always
    // sends whatever the browser has already committed — no race possible.
    window.location.href = redirectTo;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <h1 className="text-h2">{title}</h1>
        {subtitle && <p className="mt-1 text-body-sm text-ink-2">{subtitle}</p>}
      </div>
      <TextField
        id="login-email"
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
        data-testid="login-email"
      />
      <PasswordField
        id="login-password"
        autoComplete="current-password"
        label={t("passwordLabel")}
        value={password}
        onChange={setPassword}
        testId="login-password"
      />
      {error && (
        <Notice tone="danger">
          <span data-testid="login-error">{error}</span>
        </Notice>
      )}
      <Button type="submit" size="lg" block loading={pending} loadingLabel={t("loggingIn")} data-testid="login-submit">
        {t("logIn")}
      </Button>
      <Link
        href={forgotPasswordHref}
        className="self-center text-label text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
        data-testid="forgot-password-link"
      >
        {t("forgotPasswordLink")}
      </Link>
    </form>
  );
}

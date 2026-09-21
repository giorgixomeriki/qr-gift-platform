"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm({ title, redirectTo }: { title: string; redirectTo: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setPending(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-lg font-medium text-neutral-100">{title}</h1>
      <input
        type="email"
        required
        autoComplete="email"
        placeholder={t("emailPlaceholder")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        data-testid="login-email"
      />
      <input
        type="password"
        required
        autoComplete="current-password"
        placeholder={t("passwordPlaceholder")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        data-testid="login-password"
      />
      {error && (
        <p className="text-sm text-red-400" data-testid="login-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        data-testid="login-submit"
      >
        {pending ? t("loggingIn") : t("logIn")}
      </button>
    </form>
  );
}

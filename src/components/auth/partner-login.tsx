"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoginForm } from "./login-form";
import { PhoneLoginForm } from "./phone-login-form";

/**
 * Partner sign-in: email + password (unchanged), plus SMS code sign-in when
 * PARTNER_PHONE_AUTH_ENABLED is on. With phone off this renders exactly the
 * previous email form.
 */
export function PartnerLogin({
  title,
  subtitle,
  redirectTo,
  forgotPasswordHref,
  phoneEnabled,
}: {
  title: string;
  subtitle?: string;
  redirectTo: string;
  forgotPasswordHref: string;
  phoneEnabled: boolean;
}) {
  const t = useTranslations("partnerAccess.login");
  const [mode, setMode] = useState<"email" | "phone">("email");

  if (!phoneEnabled) {
    return <LoginForm title={title} subtitle={subtitle} redirectTo={redirectTo} forgotPasswordHref={forgotPasswordHref} />;
  }

  const tab = (value: "email" | "phone", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => setMode(value)}
      className={`min-h-10 flex-1 rounded-sm px-3 text-label transition-colors ${mode === value ? "bg-surface text-ink shadow-xs" : "text-ink-2 hover:text-ink"}`}
      data-testid={`login-tab-${value}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" className="flex gap-1 rounded-md bg-sunken p-1">
        {tab("phone", t("tabPhone"))}
        {tab("email", t("tabEmail"))}
      </div>
      {mode === "email" ? (
        <LoginForm title={title} subtitle={subtitle} redirectTo={redirectTo} forgotPasswordHref={forgotPasswordHref} />
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{title}</h1>
            {subtitle && <p className="mt-2 text-body-sm text-ink-2">{subtitle}</p>}
          </div>
          <PhoneLoginForm redirectTo={redirectTo} />
        </div>
      )}
    </div>
  );
}

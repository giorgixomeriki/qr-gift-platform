"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Password input with a show/hide toggle — reduces failed sign-ins on phones,
 * where typos are hard to see. The toggle sits after the input in tab order,
 * so Tab from the email field still lands directly in the password field.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  testId,
  minLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  testId: string;
  minLength?: number;
}) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block h-12 w-full rounded-md bg-surface pr-12 pl-4 text-base text-ink shadow-xs ring-1 ring-line-strong ring-inset transition-[box-shadow] hover:ring-ink-3 focus:ring-2 focus:ring-ink focus:outline-none"
          data-testid={testId}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-md text-ink-3 transition-colors hover:text-ink"
        >
          {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

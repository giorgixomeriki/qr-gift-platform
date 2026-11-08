"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  confirmMfaEnrollmentAction,
  startMfaEnrollmentAction,
  verifyMfaChallengeAction,
  type EnrollmentResult,
  type MfaErrorCode,
  type MfaResult,
} from "@/lib/auth/mfa-actions";

const ERROR_KEY: Record<MfaErrorCode, "invalidCode" | "rateLimited" | "failed" | "lastFactor"> = {
  INVALID_CODE: "invalidCode",
  RATE_LIMITED: "rateLimited",
  FORBIDDEN: "failed",
  LAST_FACTOR: "lastFactor",
  FAILED: "failed",
};

export function useMfaMessage() {
  const t = useTranslations("auth.mfa");
  return (code: MfaErrorCode) => t(ERROR_KEY[code]);
}

function CodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations("auth.mfa");
  return (
    <TextField
      id="mfa-code"
      required
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      pattern="[0-9]{6}"
      label={t("codeLabel")}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      data-testid="mfa-code"
    />
  );
}

/** A full navigation so the next render reads the new aal2 cookies. */
function goTo(path: string) {
  window.location.href = path;
}

export function MfaEnrollment({ doneHref, title, body, onCancel }: { doneHref: string; title: string; body?: string; onCancel?: () => void }) {
  const t = useTranslations("auth.mfa");
  const message = useMfaMessage();
  const [enrollment, setEnrollment] = useState<EnrollmentResult | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void startMfaEnrollmentAction().then((r) => {
      if (active) setEnrollment(r);
    });
    return () => {
      active = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollment?.ok) return;
    setPending(true);
    setError(null);
    const r: MfaResult = await confirmMfaEnrollmentAction(enrollment.factorId, code);
    if (r.ok) return goTo(doneHref);
    setPending(false);
    setCode("");
    setError(message(r.error));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" data-testid="mfa-enrollment">
      <div>
        <h1 className="font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{title}</h1>
        {body && <p className="mt-2 text-body-sm text-ink-2">{body}</p>}
      </div>
      {!enrollment && <p className="text-body-sm text-ink-2">{t("preparing")}</p>}
      {enrollment && !enrollment.ok && <Notice tone="danger">{message(enrollment.error)}</Notice>}
      {enrollment?.ok && (
        <>
          {/* A data: SVG from Supabase; next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrCode} alt={t("qrAlt")} width={192} height={192} className="mx-auto rounded-md bg-white p-2" data-testid="mfa-qr" />
          <div className="flex flex-col gap-1">
            <span className="text-caption text-ink-2">{t("secretLabel")}</span>
            <code className="break-all text-label select-all" data-testid="mfa-secret">{enrollment.secret}</code>
          </div>
          <CodeField value={code} onChange={setCode} />
          {error && <Notice tone="danger"><span data-testid="mfa-error">{error}</span></Notice>}
          <Button type="submit" size="lg" block loading={pending} loadingLabel={t("verifying")} data-testid="mfa-submit">
            {t("confirm")}
          </Button>
        </>
      )}
      {onCancel && (
        <Button type="button" variant="secondary" size="md" block onClick={onCancel}>
          {t("cancel")}
        </Button>
      )}
    </form>
  );
}

export function MfaChallengeForm({ factors, doneHref }: { factors: { id: string; label: string }[]; doneHref: string }) {
  const t = useTranslations("auth.mfa");
  const message = useMfaMessage();
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await verifyMfaChallengeAction(factorId, code);
    if (r.ok) return goTo(doneHref);
    setPending(false);
    setCode("");
    setError(message(r.error));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" data-testid="mfa-challenge">
      <div>
        <h1 className="font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{t("challengeTitle")}</h1>
        <p className="mt-2 text-body-sm text-ink-2">{t("challengeBody")}</p>
      </div>
      {factors.length > 1 && (
        <label className="flex flex-col gap-2 text-label text-ink">
          {t("factorLabel")}
          <select
            className="h-12 rounded-md bg-surface px-3 text-base ring-1 ring-inset ring-line-strong"
            value={factorId}
            onChange={(e) => setFactorId(e.target.value)}
            data-testid="mfa-factor-select"
          >
            {factors.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </label>
      )}
      <CodeField value={code} onChange={setCode} />
      {error && <Notice tone="danger"><span data-testid="mfa-error">{error}</span></Notice>}
      <Button type="submit" size="lg" block loading={pending} loadingLabel={t("verifying")} data-testid="mfa-submit">
        {t("confirm")}
      </Button>
    </form>
  );
}

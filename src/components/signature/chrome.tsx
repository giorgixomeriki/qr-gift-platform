"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BackIcon, ContinueIcon } from "@/components/customer/icons";
import { WaxSeal } from "@/components/customer/wax-seal";
import { LocaleSwitcher } from "@/components/greeting/locale-switcher";
import { Spark } from "@/components/ui/logo";
import { Spinner } from "@/components/ui/spinner";
import "./signature.css";

/**
 * The Signature Experience's sender chrome (approved Final Polish, ported
 * from the design lab): paper root, masthead, editorial step label, the wine
 * action and its dock. Presentational only — every screen supplies its own
 * real state and actions.
 */

/** The paper root every Signature sender screen sits on. */
export function SigRoot({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`sig ${className}`} data-side="sender">
      {children}
    </div>
  );
}

export function Mast({ start }: { start?: ReactNode }) {
  return (
    <header className="sig-mast">
      <div className="sig-mast__start">{start ?? <Brand />}</div>
      <div className="sig-mast__end">
        <LocaleSwitcher />
      </div>
    </header>
  );
}

export function Brand() {
  return (
    <span className="sig-brand">
      <Spark className="sig-brand__spark" />
      QR <i>Starr</i>
    </span>
  );
}

export function BackButton({ onClick, testId = "wizard-back" }: { onClick: () => void; testId?: string }) {
  const t = useTranslations("wizard");
  return (
    <button type="button" className="sig-back" onClick={onClick} data-testid={testId}>
      <BackIcon size={18} aria-hidden />
      {t("back")}
    </button>
  );
}

const STEP_KEYS = ["theme", "create", "preview"] as const;

/** C's editorial label + A's rail: "02 — Words". */
export function Steps({ step }: { step: (typeof STEP_KEYS)[number] }) {
  const t = useTranslations("wizard.sig");
  const n = STEP_KEYS.indexOf(step) + 1;
  const label = t(`steps.${step}`);
  return (
    <p className="sig-steps">
      <span className="sig-steps__rail" aria-hidden>
        {STEP_KEYS.map((key, i) => (
          <i key={key} data-on={i < n || undefined} />
        ))}
      </span>
      <span className="sr-only">{t("stepLabel", { n, label })}</span>
      <span aria-hidden>
        <b>0{n}</b> — {label}
      </span>
    </p>
  );
}

/** The wine primary action. `busy` never disables: a pressed control always answers the finger (only `disabled` does that). */
export function SigAction({
  children,
  onClick,
  disabled,
  busy,
  className = "",
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <button type="button" className={`sig-cta ${className}`} onClick={onClick} disabled={disabled} aria-busy={busy || undefined} data-testid={testId}>
      {busy && <Spinner className="size-4" />}
      <span>{children}</span>
      {!busy && (
        <span className="sig-cta__arrow" aria-hidden>
          <ContinueIcon size={16} weight="bold" />
        </span>
      )}
    </button>
  );
}

export function Dock({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`sig-dock ${className}`}>{children}</div>;
}

/** The stationery envelope, sealed — the preview window's object (the recipient's opening animates it in its own phase). */
export function SealedEnvelope({ small = false }: { small?: boolean }) {
  return (
    <div className="sig-env" data-state="sealed" data-small={small || undefined} aria-hidden>
      <span className="sig-env__back" />
      <span className="sig-env__sheet" />
      <span className="sig-env__pocket" />
      <span className="sig-env__flap" />
      <span className="sig-env__seal">
        <WaxSeal className="sig-env__wax" />
      </span>
    </div>
  );
}

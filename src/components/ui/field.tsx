"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";

type FieldChrome = {
  label: ReactNode;
  /** Shown after the label in muted text, e.g. "Optional". */
  labelAside?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Rendered bottom-right; used for character counters. */
  meta?: ReactNode;
};

const control =
  "block w-full rounded-md bg-surface px-4 text-base text-ink shadow-xs ring-1 ring-inset ring-line-strong " +
  "placeholder:text-ink-3 transition-[box-shadow,background-color] duration-150 " +
  "hover:ring-ink-3 focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-ink " +
  "aria-invalid:ring-2 aria-invalid:ring-danger disabled:bg-sunken disabled:text-ink-3";

function Chrome({
  id,
  label,
  labelAside,
  hint,
  error,
  meta,
  children,
}: FieldChrome & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-label text-ink">
        <span>{label}</span>
        {labelAside && <span className="text-caption font-normal text-ink-3">{labelAside}</span>}
      </label>
      {children}
      {(error || hint || meta) && (
        <div className="flex items-start justify-between gap-3 text-caption">
          {error ? (
            <p id={`${id}-error`} className="flex items-start gap-1.5 text-danger" role="alert">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          ) : hint ? (
            <p id={`${id}-hint`} className="text-ink-3">
              {hint}
            </p>
          ) : (
            <span />
          )}
          {meta && <span className="shrink-0 tabular-nums text-ink-3">{meta}</span>}
        </div>
      )}
    </div>
  );
}

function describedBy(id: string, { error, hint }: FieldChrome) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export function TextField({
  label,
  labelAside,
  hint,
  error,
  meta,
  className = "",
  id: idProp,
  ...input
}: FieldChrome & ComponentProps<"input">) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <Chrome id={id} label={label} labelAside={labelAside} hint={hint} error={error} meta={meta}>
      <input
        id={id}
        className={`${control} h-12 ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        {...input}
      />
    </Chrome>
  );
}

export function TextArea({
  label,
  labelAside,
  hint,
  error,
  meta,
  className = "",
  id: idProp,
  ...textarea
}: FieldChrome & ComponentProps<"textarea">) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <Chrome id={id} label={label} labelAside={labelAside} hint={hint} error={error} meta={meta}>
      <textarea
        id={id}
        className={`${control} min-h-40 resize-none py-3 leading-relaxed [field-sizing:content] ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        {...textarea}
      />
    </Chrome>
  );
}

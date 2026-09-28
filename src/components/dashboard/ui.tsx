import type { ReactNode } from "react";

/**
 * Dashboard primitives (partner + admin). Same tokens as the consumer
 * surfaces — paper, ink, one accent — but denser and quieter: these are
 * work tools, so hierarchy comes from type and spacing, not decoration.
 */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-caption font-medium text-ink-3">{eyebrow}</p>}
        <h1 className="mt-1 font-serif text-[1.875rem] leading-tight tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1.5 text-body-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  testId,
  flush = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Remove body padding (for edge-to-edge tables). */
  flush?: boolean;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] bg-surface shadow-xs ring-1 ring-line" data-testid={testId}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-h3">{title}</h2>}
            {description && <p className="mt-0.5 text-caption text-ink-3">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

/**
 * A group of related figures as one ledger-like surface divided by hairlines
 * (gap-px over the line colour), rather than a row of separate boxes.
 */
export function StatGroup({ title, children, columns = 4 }: { title?: ReactNode; children: ReactNode; columns?: 3 | 4 }) {
  return (
    <div className="flex flex-col gap-3">
      {title && <h2 className="text-label text-ink-2">{title}</h2>}
      <div
        className={`grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] bg-line shadow-xs ring-1 ring-line max-lg:[&>*:last-child:nth-child(odd)]:col-span-2 ${
          columns === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  testId,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className={`p-4 sm:p-5 ${tone === "accent" ? "bg-ember-soft/60" : "bg-surface"}`} data-testid={testId}>
      <p className="text-caption text-ink-2">{label}</p>
      <p
        className={`mt-2 font-serif text-[1.75rem] leading-none tracking-[-0.01em] tabular-nums ${
          tone === "accent" ? "text-ember-ink" : "text-ink"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-caption text-ink-3">{hint}</p>}
    </div>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
const BADGE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-ember-soft text-ember-ink",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-caption font-medium whitespace-nowrap ${BADGE[tone]}`}>{children}</span>;
}

export function EmptyState({ icon, title, body, testId }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid={testId}>
      {icon && <div className="mb-2 grid size-12 place-items-center rounded-full bg-sunken text-ink-3 [&_svg]:size-5">{icon}</div>}
      <p className="text-label text-ink">{title}</p>
      {body && <p className="max-w-sm text-caption text-ink-3">{body}</p>}
    </div>
  );
}

/** Table styling shared by every dashboard table (horizontal scroll on narrow screens). */
export const table = {
  // relative: keeps absolutely-positioned children (e.g. sr-only header labels)
  // inside the scroll clip instead of widening the whole page on phones.
  wrap: "relative overflow-x-auto",
  table: "w-full text-body-sm",
  thead: "text-left text-caption text-ink-3",
  th: "px-5 py-2.5 font-medium whitespace-nowrap",
  tr: "border-t border-line transition-colors hover:bg-paper",
  td: "px-5 py-3 align-middle",
};

/** Compact form controls for dashboards (40px tall; consumer flow uses 48px). */
export const control =
  "h-10 w-full rounded-md bg-surface px-3 text-body-sm text-ink shadow-xs ring-1 ring-line-strong ring-inset placeholder:text-ink-3 transition-[box-shadow] hover:ring-ink-3 focus:ring-2 focus:ring-ink focus:outline-none disabled:bg-sunken disabled:text-ink-3";
export const fieldLabel = "flex flex-col gap-1.5 text-caption font-medium text-ink-2";

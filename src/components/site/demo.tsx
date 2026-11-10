import { FlaskConical } from "lucide-react";

/**
 * Marks fictional merchant details (MERCHANT_PROFILE=demo). The notice says
 * "DEMO / სატესტო მონაცემები" in both languages; the tag sits next to every
 * individual demo value, so a screenshot of any part of a page still shows
 * that the value is not real.
 */
export function DemoNotice({ notice, body, compact = false }: { notice: string; body: string; compact?: boolean }) {
  return (
    <div
      role="note"
      data-testid="demo-notice"
      className={`flex gap-2.5 rounded-md border border-dashed border-ember/50 bg-ember-soft/70 text-ember-ink ${compact ? "px-3 py-2 text-caption" : "px-4 py-2.5 text-body-sm"}`}
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <strong className="font-semibold tracking-wide">{notice}</strong>
        <span className="text-ink-2"> · {body}</span>
      </p>
    </div>
  );
}

export function DemoTag({ label, title }: { label: string; title: string }) {
  return (
    <span
      data-demo
      title={title}
      className="ml-1.5 inline-flex items-center rounded-full border border-dashed border-ember/60 bg-ember-soft px-1.5 py-px align-[0.1em] text-[0.6875rem] font-semibold leading-tight tracking-wide text-ember-ink"
    >
      {label}
    </span>
  );
}

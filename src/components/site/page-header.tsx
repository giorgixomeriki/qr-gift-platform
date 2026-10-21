import { FileClock } from "lucide-react";
import type { ReactNode } from "react";

/** Eyebrow, title and lead for an information page, plus its draft/effective status. */
export function PageHeader({
  eyebrow,
  title,
  lead,
  status,
  draft,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  /** e.g. "In effect from 1 March 2027"; omitted for pages without one. */
  status?: string;
  /** Present when the page still contains review markers or unpublished details. */
  draft?: { title: string; body: ReactNode };
}) {
  return (
    <header className="border-b border-line pb-10">
      <p className="text-eyebrow text-ember">{eyebrow}</p>
      <h1 className="text-display mt-3 max-w-3xl text-ink">{title}</h1>
      {lead && <p className="mt-5 max-w-2xl text-[1.0625rem] leading-relaxed text-ink-2">{lead}</p>}
      {status && <p className="mt-5 text-caption text-ink-3">{status}</p>}
      {draft && (
        <div role="note" data-testid="draft-banner" className="mt-6 flex max-w-2xl gap-3 rounded-md border border-dashed border-warning/40 bg-warning-soft/70 px-4 py-3 text-body-sm">
          <FileClock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-medium text-ink">{draft.title}</p>
            <p className="mt-0.5 text-ink-2">{draft.body}</p>
          </div>
        </div>
      )}
    </header>
  );
}

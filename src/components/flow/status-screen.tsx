import type { ReactNode } from "react";
import { FlowShell } from "./shell";

/**
 * One consistent layout for every terminal/blocked state on /g/* (not found,
 * unavailable, in progress, errors): an icon, a serif headline, one sentence,
 * and at most one action. Warm, never an error-page dead end.
 */
export function StatusScreen({
  icon,
  title,
  body,
  hint,
  action,
  headerEnd,
}: {
  icon: ReactNode;
  title: ReactNode;
  body: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  headerEnd?: ReactNode;
}) {
  return (
    <FlowShell headerEnd={headerEnd}>
      <div className="stagger flex flex-1 flex-col items-center justify-center py-16 text-center">
        <div className="mb-8 grid size-20 place-items-center rounded-full bg-sunken text-ink-2 [&_svg]:size-8 [&_svg]:stroke-[1.5]">
          {icon}
        </div>
        <h1 className="text-h1 max-w-sm">{title}</h1>
        <p className="mt-3 max-w-sm text-body text-ink-2">{body}</p>
        {hint && <p className="mt-6 max-w-xs rounded-md bg-sunken px-4 py-3 text-body-sm text-ink-2">{hint}</p>}
        {action && <div className="mt-8 w-full max-w-xs">{action}</div>}
      </div>
    </FlowShell>
  );
}

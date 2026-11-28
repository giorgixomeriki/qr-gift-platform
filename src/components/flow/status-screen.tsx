import type { ReactNode } from "react";
import { Brand, SealedEnvelope, SigRoot } from "@/components/signature/chrome";
import "@/components/signature/status.css";

/**
 * One consistent layout for every terminal/blocked state on /g/* (not found,
 * unavailable, in progress, errors) — in the Signature paper: a paper object
 * (the sealed envelope for a greeting still being written, otherwise a paper
 * disc with the state's mark), a serif headline, one sentence, an optional
 * hint slip and at most one action. Warm, never an error-page dead end.
 */
export function StatusScreen({
  icon,
  envelope = false,
  title,
  body,
  hint,
  action,
  headerEnd,
}: {
  icon?: ReactNode;
  /** Show the sealed envelope instead of an icon (a greeting exists but isn't ready to open). */
  envelope?: boolean;
  title: ReactNode;
  body: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  headerEnd?: ReactNode;
}) {
  return (
    <SigRoot>
      <div className="sig-page sig-status-page">
        <header className="sig-mast">
          <div className="sig-mast__start">
            <Brand />
          </div>
          <div className="sig-mast__end">{headerEnd}</div>
        </header>
        <main className="sig-status-screen" data-testid="status-screen">
          {envelope ? (
            <div className="sig-status-screen__env">
              <SealedEnvelope small />
            </div>
          ) : (
            <div className="sig-status-screen__mark" aria-hidden>
              {icon}
            </div>
          )}
          <h1 className="sig-title">{title}</h1>
          <p className="sig-status-screen__body">{body}</p>
          {hint && <p className="sig-status-screen__hint">{hint}</p>}
          {action && <div className="sig-status-screen__action">{action}</div>}
        </main>
      </div>
    </SigRoot>
  );
}

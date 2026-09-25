"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Bottom sheet on phones, centred dialog from 640px up. Built on native
 * <dialog>.showModal() so focus trapping, Escape, inert background and top-layer
 * stacking come from the platform instead of hand-rolled JS.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useTranslations("common");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop area (the dialog itself, outside the panel).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-full w-full items-end justify-center sm:items-center sm:p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="sheet-panel flex max-h-[92dvh] w-full flex-col rounded-t-[var(--radius-xl)] bg-surface text-ink shadow-lg sm:max-w-md sm:rounded-[var(--radius-xl)]">
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
          <header className="flex items-start gap-4 px-6 pt-4 pb-2 sm:pt-6">
            <div className="min-w-0 flex-1">
              <h2 id="sheet-title" className="text-h2">
                {title}
              </h2>
              {description && <p className="mt-1 text-body-sm text-ink-2">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 -mt-1 grid size-10 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              aria-label={t("close")}
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>
          <div className="overflow-y-auto px-6 pt-2 pb-6">{children}</div>
          {footer && (
            <footer className="border-t border-line px-6 pt-4 pb-[max(1rem,var(--safe-bottom))]">{footer}</footer>
          )}
        </div>
      </div>
    </dialog>
  );
}

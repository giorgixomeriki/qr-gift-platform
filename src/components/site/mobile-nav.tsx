"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

type NavLink = { href: string; label: string };

/**
 * The small-screen menu: a disclosure button that opens a full-width panel
 * of every information page. Closes on navigation, on Escape (returning
 * focus to the button) and on an outside click.
 */
export function MobileNav({ primary, legal, labels }: { primary: NavLink[]; legal: NavLink[]; labels: { open: string; close: string; nav: string; legal: string } }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const item = (l: NavLink) => {
    const current = pathname === l.href;
    return (
      <li key={l.href}>
        <Link
          href={l.href}
          aria-current={current ? "page" : undefined}
          className={`flex min-h-11 items-center rounded-md px-3 text-body transition-colors ${current ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink"}`}
        >
          {l.label}
        </Link>
      </li>
    );
  };

  return (
    <div ref={rootRef} className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? labels.close : labels.open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-sunken"
        data-testid="mobile-menu-button"
      >
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full z-30 border-b border-line bg-paper px-page pb-6 pt-2 shadow-md"
        data-testid="mobile-menu"
      >
        <nav aria-label={labels.nav}>
          <ul className="space-y-0.5">{primary.map(item)}</ul>
          <p className="mt-4 px-3 text-eyebrow text-ink-3">{labels.legal}</p>
          <ul className="mt-1 space-y-0.5">{legal.map(item)}</ul>
        </nav>
      </div>
    </div>
  );
}

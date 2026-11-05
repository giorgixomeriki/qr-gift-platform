"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Desktop header links; the current page is marked for assistive tech and visually. */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-1">
      {links.map((l) => {
        const current = pathname === l.href;
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={current ? "page" : undefined}
              className={`relative rounded-full px-3 py-2 text-label transition-colors ${current ? "text-ink" : "text-ink-2 hover:text-ink"}`}
            >
              {l.label}
              {current && <span aria-hidden className="absolute inset-x-3 -bottom-px h-px bg-ember" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

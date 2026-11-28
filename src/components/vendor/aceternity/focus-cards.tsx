"use client";

/*
 * Focus cards — adapted from Aceternity UI "Focus Cards"
 * (https://ui.aceternity.com/components/focus-cards), registry file
 * registry/focus-cards.json, fetched 2026-10-21. Licence: Aceternity UI
 * licence (https://ui.aceternity.com/licence), as for cards-carousel.tsx.
 *
 * Kept: hovering one card softly blurs and recedes the others; the hovered
 * card reveals its caption over a scrim.
 * Changed: cards take a rendered <picture> (no bare <img src>); keyboard
 * focus focuses a card exactly as hover does; the caption is always visible
 * on touch screens (no hover there); styling lives in home.css.
 */
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type FocusCard = { title: string; caption: string; media: ReactNode };

export function FocusCards({ cards, className = "" }: { cards: FocusCard[]; className?: string }) {
  const [active, setActive] = useState<number | null>(null);
  return (
    <ul className={cn("hm-focus", className)} onMouseLeave={() => setActive(null)}>
      {cards.map((card, i) => (
        <li
          key={card.title}
          tabIndex={0}
          onMouseEnter={() => setActive(i)}
          onFocus={() => setActive(i)}
          onBlur={() => setActive(null)}
          className={cn("hm-focus__card", { "is-active": active === i, "is-dimmed": active !== null && active !== i })}
        >
          {card.media}
          <div className="hm-focus__scrim">
            <p className="hm-focus__title">{card.title}</p>
            <p className="hm-focus__caption">{card.caption}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

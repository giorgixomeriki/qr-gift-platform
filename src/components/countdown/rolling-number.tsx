"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number whose digits change in place: each digit sits in its own
 * fixed-width cell (tabular figures, so nothing beside it moves) and only the
 * cells whose digit changed animate. How they animate is the countdown
 * style's business (event-countdown.css: a roll, a dissolve, a curtain);
 * reduced motion swaps instantly.
 *
 * Decorative: the readable value lives on the parent timer's label.
 */
export function RollingNumber({ value, pad = 2, className }: { value: number; pad?: number; className?: string }) {
  const text = String(Math.max(0, Math.floor(value))).padStart(pad, "0");
  return (
    <span className={`rn ${className ?? ""}`} aria-hidden>
      {[...text].map((digit, i) => (
        // Keyed by place from the right, so 100 → 99 keeps the units/tens cells and drops the hundreds.
        <Digit key={text.length - i} digit={digit} />
      ))}
    </span>
  );
}

function Digit({ digit }: { digit: string }) {
  const [shown, setShown] = useState({ now: digit, prev: null as string | null, n: 0 });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setShown((s) => (s.now === digit ? s : { now: digit, prev: s.now, n: s.n + 1 }));
  }, [digit]);
  return (
    <span className="rn__cell">
      {/* Holds the cell's width and height; the animated faces are absolutely placed over it. */}
      <span className="rn__ghost" suppressHydrationWarning>
        {shown.now}
      </span>
      {shown.prev !== null && (
        <span key={`o${shown.n}`} className="rn__face rn__face--out">
          {shown.prev}
        </span>
      )}
      <span key={`i${shown.n}`} className="rn__face rn__face--in" data-first={shown.n === 0 || undefined} suppressHydrationWarning>
        {shown.now}
      </span>
    </span>
  );
}

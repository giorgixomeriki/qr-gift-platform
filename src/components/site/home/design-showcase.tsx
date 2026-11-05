"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { TransitionPanel } from "@/components/vendor/motion-primitives/transition-panel";

type Design = { key: string; name: string; tagline: string; opening: string; image: ReactNode };

/**
 * The six real greeting designs as the section's centrepiece: an editorial
 * numbered list (ARIA tabs: arrows, Home/End) beside a large stage. The
 * stage cross-fades between captures of the actual designs (Motion
 * Primitives TransitionPanel), with the next two designs resting behind it.
 */
export function DesignShowcase({ designs, label, counter }: { designs: Design[]; label: string; counter: string }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const n = designs.length;

  const go = (i: number, focus = false) => {
    const next = (i + n) % n;
    setActive(next);
    if (focus) tabs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, number> = { ArrowDown: active + 1, ArrowRight: active + 1, ArrowUp: active - 1, ArrowLeft: active - 1, Home: 0, End: n - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    go(map[e.key]!, true);
  };
  const behind = [1, 2].map((k) => designs[(active + k) % n]!);

  return (
    <div className="hm-ds">
      <div className="hm-ds__list" role="tablist" aria-label={label} aria-orientation="vertical" onKeyDown={onKey}>
        {designs.map((d, i) => (
          <button
            key={d.key}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-t${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel`}
            tabIndex={i === active ? 0 : -1}
            className="hm-ds__tab"
            onClick={() => go(i)}
            data-testid={`design-tab-${d.key}`}
          >
            <span className="hm-ds__n hm-numeral" aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="hm-ds__name">{d.name}</span>
            <span className="hm-ds__tagline">{d.tagline}</span>
          </button>
        ))}
      </div>
      <div className="hm-ds__stage" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-t${active}`}>
        <div className="hm-ds__behind" aria-hidden>
          {behind.map((d, k) => (
            // keyed by the design, so each change re-mounts the paper and it settles in (home.css)
            <span key={`${d.key}-${k}`} className={`hm-ds__ghost hm-ds__ghost--${k}`}>
              {d.image}
            </span>
          ))}
        </div>
        <TransitionPanel
          activeIndex={active}
          className="hm-ds__front"
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          variants={{ enter: { opacity: 0, x: 24, rotate: 1.5 }, center: { opacity: 1, x: 0, rotate: 0 }, exit: { opacity: 0, x: -24, rotate: -1.5 } }}
        >
          {designs.map((d) => (
            <figure key={d.key} className="hm-ds__card">
              {d.image}
            </figure>
          ))}
        </TransitionPanel>
        <p className="hm-ds__caption" aria-live="polite">
          <span className="hm-numeral">{counter.replace("{n}", String(active + 1)).replace("{total}", String(n))}</span>
          <span className="hm-ds__opening">{designs[active]!.opening}</span>
        </p>
      </div>
    </div>
  );
}

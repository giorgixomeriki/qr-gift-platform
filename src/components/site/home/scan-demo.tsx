"use client";

import { Children, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PhoneShell } from "./objects";
import { BeatProvider } from "./motion";

const BEAT_MS = 5200;

type Beat = { label: string; title: string; text: ReactNode };

/**
 * "After the scan": four moments of opening a greeting, as tabs that drive
 * the phone beside them. It advances on its own only while it is on screen,
 * never under reduced motion, and stops for good the moment someone picks a
 * moment themselves. Tabs follow the ARIA pattern (arrow keys, Home/End).
 */
export function ScanDemo({ beats, screens, labels }: { beats: Beat[]; screens: ReactNode; labels: { tabs: string } }) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const stopped = useRef(false);
  const id = useId();
  const count = beats.length;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || stopped.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([entry]) => setPlaying(!stopped.current && !!entry?.isIntersecting), { threshold: 0.45 });
    io.observe(root);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setActive((a) => (a + 1) % count), BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [playing, active, count]);

  const choose = useCallback((i: number, focus = false) => {
    stopped.current = true;
    setPlaying(false);
    setActive(i);
    if (focus) tabsRef.current[i]?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const map: Record<string, number> = { ArrowDown: active + 1, ArrowRight: active + 1, ArrowUp: active - 1, ArrowLeft: active - 1, Home: 0, End: count - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    choose((map[e.key]! + count) % count, true);
  }

  const marked = Children.toArray(screens).map((s, i) => (
    <div key={i} className="contents" data-beat={i} data-on={i === active || undefined}>
      {s}
    </div>
  ));

  return (
    <div ref={rootRef} className="hm-demo" style={{ ["--hm-beat-ms" as string]: `${BEAT_MS}ms` }}>
      <div className="hm-demo__device" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`} data-active-beat={active}>
        <BeatProvider value={active}>
          <PhoneShell>{marked}</PhoneShell>
        </BeatProvider>
      </div>
      <div className="hm-beats" role="tablist" aria-label={labels.tabs} aria-orientation="vertical" onKeyDown={onKeyDown} data-playing={playing || undefined}>
        {beats.map((b, i) => (
          <button
            key={i}
            ref={(el) => {
              tabsRef.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => choose(i)}
            className="hm-beat"
            data-testid={`demo-beat-${i}`}
          >
            <span className="hm-beat__num hm-numeral" aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="hm-beat__title">{b.title}</span>
            <span className="hm-beat__text hm-body">
              <span>{b.text}</span>
            </span>
            <span className="hm-beat__bar" aria-hidden>
              <i key={`${active}-${playing}`} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

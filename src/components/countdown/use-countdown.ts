"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { countdownParts, countdownPhase, type CountdownParts, type CountdownPhase } from "@/lib/greetings/schedule";

/**
 * A clock that the recipient's device cannot move.
 *
 * Anchored to the server's (database's) `now` when the page rendered, then
 * advanced with performance.now() — a monotonic clock that ignores the
 * device's wall clock — so setting the phone's date forward or back changes
 * nothing. Without a server time (the sender's Preview) it starts from
 * Date.now().
 *
 * Monotonic clocks can stall while a phone sleeps. When the page becomes
 * visible again, the time that passed on the wall clock while hidden is
 * compared with the monotonic time; if the monotonic clock fell behind (it
 * slept), the difference is added. A wall clock changed while hidden can
 * only ever move the countdown forward by up to a week here, never unlock
 * anything: unlocking is decided by the server alone, and the locked screen
 * also re-renders from the server when it returns (scheduled-reveal.tsx).
 *
 * A new `serverNow` (the page was re-rendered) re-anchors the clock.
 */
export function useAnchoredClock(serverNow?: number): () => number {
  const anchor = useRef<{ server: number; perf: number; slept: number } | null>(null);
  if (anchor.current === null || (serverNow !== undefined && anchor.current.server !== serverNow)) {
    anchor.current = { server: serverNow ?? Date.now(), perf: typeof performance !== "undefined" ? performance.now() : 0, slept: 0 };
  }
  useEffect(() => {
    let hiddenWall = 0;
    let hiddenPerf = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenWall = Date.now();
        hiddenPerf = performance.now();
        return;
      }
      if (!hiddenWall || !anchor.current) return;
      const wall = Date.now() - hiddenWall;
      const mono = performance.now() - hiddenPerf;
      const gap = wall - mono;
      if (gap > 2000 && wall < 7 * 24 * 3600 * 1000) anchor.current.slept += gap;
      hiddenWall = 0;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  return useCallback(() => {
    const a = anchor.current!;
    return a.server + (performance.now() - a.perf) + a.slept;
  }, []);
}

/**
 * Remaining time to `targetMs`, re-rendered exactly when the displayed second
 * changes (timers aligned to the boundary, not a drifting 1 s interval) and
 * not at all while the page is hidden. `onZero` fires once when it reaches 0.
 */
export function useCountdown(
  targetMs: number,
  now: () => number,
  { onZero, initialNow }: { onZero?: () => void; initialNow?: number } = {},
): { parts: CountdownParts; phase: CountdownPhase } {
  const [, setTick] = useState(0);
  const firedRef = useRef(false);
  const zeroRef = useRef(onZero);
  zeroRef.current = onZero;
  // Before hydration the server's clock is the only clock: the first paint matches what the server rendered.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    firedRef.current = false;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      const remaining = targetMs - now();
      if (remaining <= 0) {
        setTick((n) => n + 1);
        if (!firedRef.current) {
          firedRef.current = true;
          zeroRef.current?.();
        }
        // Keep ticking slowly after the moment so "today" turns into "celebrated" on a page left open.
        timer = window.setTimeout(schedule, 60_000);
        return;
      }
      setTick((n) => n + 1);
      // Wake just after the next whole second of the remaining time flips.
      const toBoundary = remaining % 1000 || 1000;
      timer = window.setTimeout(schedule, toBoundary + 8);
    };
    schedule();
    const onVisibility = () => document.visibilityState === "visible" && schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [targetMs, now]);

  const current = hydrated || initialNow === undefined ? now() : initialNow;
  return { parts: countdownParts(targetMs - current), phase: countdownPhase(targetMs, current) };
}

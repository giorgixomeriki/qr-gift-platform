"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { attachDepth, disposeScene, sceneContext, type SceneContext, type SceneFn } from "./primitives";
import { loadMotion, type Motion } from "./runtime";

/** Short choreography (a world seen before, rapid switching): same story, faster. */
const SHORT_SPEED = 1.8;
/** Properties scenes may leave inline if interrupted — cleared on teardown (React's own inline styles stay). */
const SCENE_PROPS = "transform,opacity,clipPath,visibility,filter,strokeDashoffset";

let ready: Motion | null = null;
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Plays a scene once when the world becomes active — its signature scene
 * (scenes.ts) or its finale (finales.ts). The world is held quiet
 * (data-scene="pending", CSS; a finale holds its world at the scene's rest
 * with "finale-pending") from before the first paint — so the rest state
 * never flashes — and the timeline is built a frame later, off the input's
 * own frame (or when the runtime arrives; never held longer than 900ms).
 * Interrupting (unmount, a new choice) kills the timeline and restores rest.
 * Reduced motion: no scene (CSS shows the finished world with a short fade).
 *
 * `onRest` is called once the world is at rest after becoming active: when
 * its scene completes, after the reduced-motion fade, or — if the runtime
 * cannot be loaded — once the world has been released to its rest state.
 */
export function useThemeScene(
  ref: RefObject<HTMLElement | null>,
  play: SceneFn,
  active: boolean,
  motion: "full" | "short",
  onRest?: () => void,
  hold: "pending" | "finale-pending" = "pending",
) {
  const onRestRef = useRef(onRest);
  useLayoutEffect(() => {
    onRestRef.current = onRest;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    if (reduceMotion()) {
      const t = window.setTimeout(() => onRestRef.current?.(), 260); // after the 240 ms rest fade
      return () => window.clearTimeout(t);
    }
    let ctx: SceneContext | null = null;
    let tl: ReturnType<Motion["gsap"]["timeline"]> | null = null;
    let cancelled = false;
    let fallback = 0;
    const build = ({ gsap, SplitText }: Motion) => {
      if (cancelled) return;
      window.clearTimeout(fallback);
      ctx = sceneContext(el, gsap, SplitText);
      tl = gsap.timeline({
        onComplete: () => {
          for (const s of ctx!.splits) s.revert();
          ctx!.splits = [];
          el.dataset.scene = "rest";
          onRestRef.current?.();
        },
      });
      play(ctx, tl);
      if (motion === "short") tl.timeScale(SHORT_SPEED);
      el.dataset.scene = "playing";
    };
    // Hold the world quiet now (before paint) and build the scene on the next
    // frame, so the tap that chose it is answered at once — the measuring and
    // splitting never sit inside the input's own frame.
    el.dataset.scene = hold;
    fallback = window.setTimeout(() => delete el.dataset.scene, 900);
    let frame = 0;
    const start = (m: Motion) => {
      ready = m;
      frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => build(m))));
    };
    if (ready) start(ready);
    else
      loadMotion().then(start, () => {
        // No runtime (offline, blocked chunk): the world is shown at rest.
        if (cancelled) return;
        window.clearTimeout(fallback);
        delete el.dataset.scene;
        onRestRef.current?.();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      cancelAnimationFrame(frame);
      if (tl && ctx) {
        // Only real elements (pauses and calls have plain-object targets).
        const targets = tl
          .getChildren(true, true, false)
          .flatMap((t) => (t as { targets: () => unknown[] }).targets())
          .filter((t): t is Element => t instanceof Element);
        tl.kill();
        ctx.gsap.set(targets, { clearProps: SCENE_PROPS });
        disposeScene(ctx);
      }
      delete el.dataset.scene;
    };
  }, [ref, play, active, motion, hold]);
}

/** Pointer depth on the chosen world (light, artwork and paper at their own depths). */
export function useDepth(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || reduceMotion()) return;
    let detach = () => {};
    let cancelled = false;
    void loadMotion().then((m) => {
      ready = m;
      if (!cancelled) detach = attachDepth(el, m.gsap);
    });
    return () => {
      cancelled = true;
      detach();
    };
  }, [ref, enabled]);
}

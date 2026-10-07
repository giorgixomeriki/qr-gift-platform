/**
 * The theme-scene motion runtime: GSAP with the plugins the scenes use,
 * loaded on demand (its own chunk) and registered once. Nothing here runs
 * during the first paint — a world is always rendered at rest by CSS first.
 *
 * GSAP (gsap.com) is free for commercial use, including SplitText and
 * Physics2D (the "GSAP Standard No Charge" licence).
 */
import type { gsap as GsapCore } from "gsap";
import type { SplitText as SplitTextClass } from "gsap/SplitText";

export type Gsap = typeof GsapCore;
export type Split = typeof SplitTextClass;
export type Motion = { gsap: Gsap; SplitText: Split };

let loading: Promise<Motion> | null = null;

export function loadMotion(): Promise<Motion> {
  loading ??= Promise.all([import("gsap"), import("gsap/SplitText"), import("gsap/Physics2DPlugin"), import("gsap/CustomEase")]).then(
    ([{ gsap }, { SplitText }, { Physics2DPlugin }, { CustomEase }]) => {
      gsap.registerPlugin(SplitText, Physics2DPlugin, CustomEase);
      // A hand drawing a sheet; paper coming to rest without overshoot.
      CustomEase.create("qs-hand", "M0,0 C0.55,0 0.25,1 1,1");
      CustomEase.create("qs-settle", "M0,0 C0.2,0.7 0.3,1 1,1");
      return { gsap, SplitText };
    },
  );
  return loading;
}

/** Warm the chunk while the browser is idle, so a later choice starts at once. */
export function prefetchMotion() {
  if (typeof window === "undefined") return;
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  idle(() => void loadMotion());
}

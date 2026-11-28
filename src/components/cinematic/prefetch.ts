import type { Variant } from "./cinematic-interlude";

/** Warm the cinematic modules while the envelope is still sealed (idle time, after first paint). */
export function prefetchCinematic(variant: Variant) {
  void import("./cinematic-interlude");
  void import("./engine");
  if (variant === "C") void import("./memory-galaxy");
}

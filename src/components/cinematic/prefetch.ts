import type { Variant } from "./cinematic-interlude";

/** Warm the cinematic modules while the envelope is still sealed (idle time, after first paint). */
export function prefetchCinematic(variant: Variant) {
  void import("./cinematic-interlude");
  void import("./engine");
  if (variant !== "A" && variant !== "B") void import("./memory-galaxy");
  if (variant === "C2" || variant === "C3") {
    // The petal atlas (decoded later by the interlude; the browser cache serves it then).
    const img = new Image();
    img.src = window.devicePixelRatio > 1 && (navigator.hardwareConcurrency ?? 4) > 4 ? "/lab/cinematic/petals-2048.webp" : "/lab/cinematic/petals-1024.webp";
  }
}

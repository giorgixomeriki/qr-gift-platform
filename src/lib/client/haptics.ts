"use client";

/**
 * A barely-there tick under the finger at the few moments that physically
 * "give" — breaking the seal, starting/stopping a recording. Optional by
 * design (docs/design/QR-STARR-MOTION-LANGUAGE.md: never *relies* on haptics):
 * only where the Vibration API exists (Android Chrome; iOS Safari has none),
 * only on touch screens, and every moment it marks is also answered visually.
 */
export function tick(ms = 8) {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    navigator.vibrate(ms);
  } catch {
    /* unsupported or blocked: the visual answer stands alone */
  }
}

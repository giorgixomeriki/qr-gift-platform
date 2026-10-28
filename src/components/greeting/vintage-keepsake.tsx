"use client";

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import { WaxSeal } from "@/components/customer/wax-seal";
import { Confetti, type ConfettiRef } from "@/components/vendor/magic-ui/confetti";
import { SpinningText } from "@/components/vendor/motion-primitives/spinning-text";
import Stack from "@/components/vendor/react-bits/Stack";
import "@/components/vendor/react-bits/Stack.css";

/**
 * The Luxury Vintage closing keepsakes (composition `keepsake` only). This
 * module is loaded lazily from RevealClosing, so `motion` and
 * `canvas-confetti` never reach the six other worlds' recipients.
 *
 * Third-party components (src/components/vendor/README.md):
 * - React Bits **Stack**: the photos as a pile of mounted prints the
 *   recipient can leaf through (drag, tap, or Enter/Space/arrow keys).
 * - Motion Primitives **SpinningText**: a postmark ring around the wax seal;
 *   it turns once and rests (still under reduced motion).
 * - Magic UI **Confetti** (canvas-confetti): rose petals fall once when the
 *   seal comes into view; never under reduced motion.
 */

export function VintagePrints({ photos, label }: { photos: { id: string; url: string; alt: string }[]; label: string }) {
  return (
    <div className="sx-vintage-prints" data-testid="vintage-prints">
      <Stack
        ariaLabel={label}
        layout="pile"
        visible={3}
        radius={2}
        frame={8}
        frameColor="#f6eedd"
        tilt={18}
        sendToBackOnClick
        cards={photos.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not eligible for next/image
          <img key={p.id} src={p.url} alt={p.alt} draggable={false} />
        ))}
      />
    </div>
  );
}

/** A rose petal for canvas-confetti, from its own path API. */
let petal: confetti.Shape | null = null;
function petalShape() {
  petal ??= confetti.shapeFromPath({ path: "M10 0 C 16 4, 18 12, 10 20 C 2 12, 4 4, 10 0 Z" });
  return petal;
}

export function VintageSeal({ postmark }: { postmark: string }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const confettiRef = useRef<ConfettiRef>(null);

  // Petals once, when the seal is actually seen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void confettiRef.current?.fire({
          shapes: [petalShape()],
          colors: ["#e9c6c0", "#d99a96", "#b8606a", "#c9a466"],
          particleCount: 38,
          spread: 70,
          startVelocity: 18,
          gravity: 0.45,
          drift: 0.4,
          scalar: 1.1,
          ticks: 260,
          origin: { y: 0.35 },
          disableForReducedMotion: true,
        });
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span ref={rootRef} className="sx-vintage-seal" data-testid="vintage-seal">
      <Confetti ref={confettiRef} manualstart className="sx-vintage-seal__petals" aria-hidden />
      <SpinningText className="sx-vintage-seal__ring" radius={8.6} fontSize={0.66} duration={9} transition={{ repeat: 0, duration: 9, ease: "easeOut" }}>
        {postmark}
      </SpinningText>
      <WaxSeal className="sx-vintage-seal__wax" />
    </span>
  );
}

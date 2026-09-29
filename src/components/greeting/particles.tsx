import type { CSSProperties } from "react";
import { SPARK_PATH } from "@/components/ui/logo";
import type { Particle } from "@/lib/themes/registry";

/** Small deterministic PRNG so particle layouts are pure and stable per seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPE: Record<Exclude<Particle, "none">, "petal" | "confetti" | "spark"> = {
  petals: "petal",
  confetti: "confetti",
  sparkles: "spark",
  stars: "spark",
};

/**
 * Decorative only (aria-hidden, pointer-events none, hidden under reduced
 * motion). "burst" fires once from the envelope; "drift" falls gently for two
 * passes then stops — ambient, never a perpetual screensaver.
 */
export function Particles({
  kind,
  colors,
  mode,
  count,
  seed = 7,
}: {
  kind: Particle;
  colors: string[];
  mode: "burst" | "drift";
  count: number;
  seed?: number;
}) {
  if (kind === "none" || colors.length === 0) return null;
  const shape = SHAPE[kind];
  const rand = rng(seed);

  const items = Array.from({ length: count }, (_, i) => {
    const color = colors[i % colors.length]!;
    const size = shape === "confetti" ? 6 + rand() * 6 : shape === "petal" ? 10 + rand() * 10 : 8 + rand() * 12;
    const style: Record<string, string | number> = { color, width: size, height: shape === "confetti" ? size * 0.45 : size };
    if (mode === "burst") {
      const angle = rand() * Math.PI * 2;
      const dist = 120 + rand() * 220;
      style["--dx"] = `${Math.cos(angle) * dist}px`;
      style["--dy"] = `${Math.sin(angle) * dist - 60}px`;
      style["--rot"] = `${(rand() - 0.5) * 720}deg`;
      style["--dur"] = `${900 + rand() * 700}ms`;
    } else {
      style.left = `${rand() * 100}%`;
      style["--sway"] = `${(rand() - 0.5) * 120}px`;
      style["--rot"] = `${(rand() - 0.5) * 540}deg`;
      style["--dur"] = `${9 + rand() * 7}s`;
      style["--delay"] = `${rand() * 6}s`;
      style["--alpha"] = String(0.55 + rand() * 0.4);
    }
    if (shape !== "spark") style.background = color;
    return { key: i, style: style as CSSProperties };
  });

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((p) => (
        <span key={p.key} className="particle" data-mode={mode} data-shape={shape} style={p.style}>
          {shape === "spark" && (
            <svg viewBox="0 0 24 24" className="size-full">
              <path fill="currentColor" d={SPARK_PATH} />
            </svg>
          )}
        </span>
      ))}
    </div>
  );
}

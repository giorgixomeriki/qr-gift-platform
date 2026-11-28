"use client";

/**
 * Cinematic envelope opening (lab prototypes A/B/C).
 *
 * Mounted by GreetingRenderer's `openingInterlude` the moment the seal is
 * pressed, over the production envelope (whose own CSS opening keeps playing
 * underneath). It owns ~3 s of screen, calls `reveal()` when the letter beat
 * should start mounting beneath it (the world's handwriting then plays as in
 * production) and `done()` when it has faded away.
 *
 *   A  Luxury Floral Reveal      golden light → petals burst toward the viewer → letter
 *   B  Golden Stardust Reveal    a helix of gold dust rises, bursts past the viewer → letter
 *   C  Floral + Memory Galaxy    A's petals → a dark galaxy of the sender's photos → letter
 *
 * Orchestration: GSAP (already a dependency) for the DOM layers; the WebGL
 * layer (engine.ts, three.js) is loaded on demand and driven by GSAP's ticker
 * — one loop — then disposed. Skip at any moment. prefers-reduced-motion: no
 * flight, a short glow cross-fade. Weak devices / no WebGL: a CSS fallback.
 */
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import gsap from "gsap";
import type { Engine, Quality } from "./engine";
import { PETALS_DEFAULT, petalDataUrls } from "./textures";
import "./cinematic.css";

const MemoryGalaxy = lazy(() => import("./memory-galaxy"));

export type Variant = "A" | "B" | "C" | "C2" | "C3";
export type QualityPref = "auto" | "high" | "mid" | "lite";
export type CinematicMetrics = {
  variant: Variant;
  quality: Quality | "lite" | "reduced";
  /** Press → done (ms), excluding time spent holding in the galaxy. */
  durationMs: number;
  /** Press → letter begins mounting (ms). */
  revealMs: number;
  /** Press → first WebGL frame (ms); null when no WebGL ran. */
  firstFrameMs: number | null;
  frames: number;
  fps: number;
  p95FrameMs: number;
  longFrames: number;
  degraded: boolean;
  skipped: boolean;
  heapMB: number | null;
  gl: ReturnType<Engine["info"]> | null;
};

declare global {
  interface Window {
    __cinematic?: CinematicMetrics[];
  }
}

const WEIGHTS: Record<string, [number, number, number, number]> = {
  romantic: [5, 4, 2, 1],
  "luxury-vintage": [5, 3, 3, 1],
  wedding: [1, 1, 4, 5],
  elegant: [3, 2, 3, 3],
  birthday: [2, 4, 3, 2],
  celebration: [2, 4, 3, 3],
  minimal: [1, 1, 3, 5],
};

function detectQuality(pref: QualityPref): Quality | "lite" {
  if (pref !== "auto") return pref;
  try {
    const c = document.createElement("canvas");
    if (!(c.getContext("webgl2") || c.getContext("webgl"))) return "lite";
  } catch {
    return "lite";
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  if (nav.connection?.saveData || cores <= 2 || mem <= 2) return "lite";
  if (cores <= 4 || mem <= 4) return "mid";
  return "high";
}

export default function CinematicInterlude({
  variant,
  themeKey,
  photos,
  phrases,
  centerLabel,
  quality: qualityPref = "auto",
  forceReduced = false,
  galaxyHoldMs,
  labels,
  petalAtlas = { high: "/lab/cinematic/petals-2048.webp", mid: "/lab/cinematic/petals-1024.webp" },
  reveal,
  done,
  onMetrics,
}: {
  variant: Variant;
  themeKey: string;
  photos: { url: string; alt: string }[];
  phrases: string[];
  centerLabel?: string;
  quality?: QualityPref;
  forceReduced?: boolean;
  /** C: how long the galaxy waits before the letter (the recipient can go on sooner). */
  galaxyHoldMs?: number;
  labels: { skip: string; openLetter: string };
  /** C2/C3: the photoreal petal atlas (high, mid). */
  petalAtlas?: { high: string; mid: string };
  reveal: () => void;
  done: () => void;
  onMetrics?: (m: CinematicMetrics) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const galaxyRef = useRef<HTMLDivElement>(null);
  const liteRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<(skipped: boolean) => void>(() => {});
  const proceedRef = useRef<() => void>(() => {});
  const [mode] = useState<{ q: Quality | "lite"; reduced: boolean }>(() => ({
    q: typeof window === "undefined" ? "high" : detectQuality(qualityPref),
    reduced: forceReduced || (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
  }));
  const [holding, setHolding] = useState(false);
  const [showGalaxy, setShowGalaxy] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [litePetals, setLitePetals] = useState<string[] | null>(null);
  const film = variant === "C2" || variant === "C3";

  useEffect(() => {
    const root = rootRef.current!;
    const env = document.querySelector(".sx-env")?.getBoundingClientRect();
    const o = env ? { x: env.left + env.width / 2, y: env.top + env.height * 0.22 } : { x: window.innerWidth / 2, y: window.innerHeight * 0.5 };
    setOrigin(o);
    root.style.setProperty("--ox", `${o.x}px`);
    root.style.setProperty("--oy", `${o.y}px`);
    const mouthPx = env ? env.width * 0.82 : 240;

    const t0 = performance.now();
    let revealedAt = 0;
    let holdStarted = 0;
    let heldMs = 0;
    let finished = false;
    let engine: Engine | null = null;
    let firstFrame: number | null = null;
    let degraded = false;
    const frameTimes: number[] = [];
    let lastFrame = 0;
    let hiddenAt = 0;
    let hiddenMs = 0;
    const timers: number[] = [];
    const tls: gsap.core.Timeline[] = [];
    const galaxyOn = variant === "C" || film;
    const webgl = mode.q !== "lite" && !mode.reduced;
    const glow = { v: 0 };
    const fieldOp = { v: 0 };

    const doReveal = () => {
      if (revealedAt) return;
      revealedAt = performance.now();
      reveal();
    };
    const clock = () => (performance.now() - t0 - hiddenMs) / 1000;

    const tick = () => {
      if (!engine || document.hidden) return;
      const now = performance.now();
      if (firstFrame === null) firstFrame = now - t0;
      else frameTimes.push(now - lastFrame);
      lastFrame = now;
      engine.render(clock(), glow.v, fieldOp.v);
      // Adaptive: if the first ~24 frames run long, halve the work once.
      if (!degraded && frameTimes.length === 24) {
        const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        if (avg > 24) {
          degraded = true;
          engine.degrade();
        }
      }
    };

    const finish = (skipped: boolean) => {
      if (finished) return;
      finished = true;
      if (holdStarted) heldMs += performance.now() - holdStarted;
      doReveal();
      gsap.ticker.remove(tick);
      tls.forEach((t) => t.kill());
      timers.forEach((t) => window.clearTimeout(t));
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      const m: CinematicMetrics = {
        variant,
        quality: mode.reduced ? "reduced" : mode.q,
        durationMs: Math.round(performance.now() - t0 - heldMs - hiddenMs),
        revealMs: Math.round(revealedAt - t0 - (galaxyOn ? heldMs : 0)),
        firstFrameMs: firstFrame === null ? null : Math.round(firstFrame),
        frames: frameTimes.length,
        fps: frameTimes.length ? Math.round((1000 * frameTimes.length) / frameTimes.reduce((a, b) => a + b, 0)) : 0,
        p95FrameMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)]! * 10) / 10 : 0,
        longFrames: frameTimes.filter((f) => f > 34).length,
        degraded,
        skipped,
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
        gl: engine?.info() ?? null,
      };
      engine?.dispose();
      engine = null;
      (window.__cinematic ??= []).push(m);
      onMetrics?.(m);
      done();
    };
    finishRef.current = (skipped) => {
      if (finished) return;
      doReveal();
      gsap.to(root, { opacity: 0, duration: 0.22, ease: "power1.out", onComplete: () => finish(skipped) });
    };

    // ---------- reduced motion: a short glow cross-fade, galaxy (C) shown still ----------
    if (mode.reduced) {
      const tl = gsap.timeline();
      tls.push(tl);
      tl.fromTo(lightRef.current, { opacity: 0 }, { opacity: 0.9, duration: 0.2 }, 0);
      if (galaxyOn) {
        tl.to(veilRef.current, { opacity: 1, duration: 0.25 }, 0.1);
        tl.call(() => setShowGalaxy(true), [], 0.3);
        tl.call(() => beginHold(), [], 0.35);
      } else {
        tl.call(doReveal, [], 0.25);
        tl.to(root, { opacity: 0, duration: 0.3 }, 0.3);
        tl.call(() => finish(false), [], 0.62);
      }
    } else {
      buildTimeline();
    }

    function beginHold() {
      holdStarted = performance.now();
      setHolding(true);
      const hold = galaxyHoldMs ?? (photos.length ? 6500 : 3800);
      timers.push(window.setTimeout(() => proceedRef.current(), hold));
    }
    proceedRef.current = () => {
      if (!holdStarted || finished) return;
      heldMs = performance.now() - holdStarted;
      holdStarted = 0;
      setHolding(false);
      const out = gsap.timeline();
      tls.push(out);
      if (film && !mode.reduced) {
        // Dolly through the photographs toward a warm light; the letter is already beneath it.
        out.to(galaxyRef.current, { scale: 1.3, opacity: 0, duration: 0.8, ease: "power2.in" }, 0);
        out.to(canvasRef.current, { opacity: 0, duration: 0.65, ease: "power1.in" }, 0.05);
        out.to(fieldOp, { v: 0, duration: 0.65 }, 0);
        out.fromTo(lightRef.current, { opacity: 0, scale: 0.6 }, { opacity: 0.75, scale: 1.4, duration: 0.45, ease: "sine.in" }, 0.05);
        out.call(doReveal, [], 0.3);
        out.to(veilRef.current, { opacity: 0, duration: 0.65, ease: "power1.inOut" }, 0.4);
        out.to(lightRef.current, { opacity: 0, duration: 0.5, ease: "sine.out" }, 0.55);
        out.call(() => finish(false), [], 1.08);
        return;
      }
      out.to(galaxyRef.current, { scale: mode.reduced ? 1 : 1.5, opacity: 0, duration: mode.reduced ? 0.3 : 0.75, ease: "power2.in" }, 0);
      out.to(fieldOp, { v: 0, duration: 0.6 }, 0);
      out.call(doReveal, [], 0.25);
      out.to(veilRef.current, { opacity: 0, duration: 0.6, ease: "power1.inOut" }, 0.35);
      out.to(lightRef.current, { opacity: 0, duration: 0.4 }, 0.3);
      out.call(() => finish(false), [], 1.0);
    };

    function buildTimeline() {
      const tl = gsap.timeline();
      tls.push(tl);
      // Stage 1: the seal gives and the flap opens (production CSS beneath); a warm light rises from the envelope.
      tl.fromTo(lightRef.current, { opacity: 0, scale: 0.35 }, { opacity: 1, scale: 1, duration: 0.55, ease: "sine.out" }, 0.12);
      tl.to(glow, { v: 1, duration: 0.6 }, 0.2);
      if (variant === "B") {
        tl.to(lightRef.current, { scale: 1.8, duration: 1.0, ease: "sine.inOut" }, 0.6);
        tl.to(fieldOp, { v: 0.85, duration: 0.6 }, 0.85);
        tl.fromTo(veilRef.current, { opacity: 0 }, { opacity: 0.88, duration: 0.5, ease: "sine.in" }, 0.95);
        tl.fromTo(flashRef.current, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1.6, duration: 0.55, ease: "power2.in" }, 1.0);
        tl.call(doReveal, [], 1.55);
        tl.to(lightRef.current, { opacity: 0, duration: 0.5 }, 1.55);
        tl.to(flashRef.current, { opacity: 0, scale: 2.4, duration: 1.0, ease: "power2.out" }, 1.6);
        tl.to(veilRef.current, { opacity: 0, duration: 1.0, ease: "power1.inOut" }, 1.65);
        tl.to(fieldOp, { v: 0, duration: 0.8 }, 2.0);
        tl.call(() => finish(false), [], 3.0);
        return;
      }
      if (film) {
        // Interior light holds while the petals rise out of the mouth; the night opens from the
        // envelope outward (an iris, not a full-screen fade); the photographs arrive in it.
        tl.to(lightRef.current, { scale: 1.3, opacity: 0.9, duration: 0.9, ease: "sine.inOut" }, 0.6);
        tl.fromTo(veilRef.current, { opacity: 1, "--r": "0vmax" }, { "--r": "170vmax", duration: 1.15, ease: "power2.in" }, 0.8);
        tl.to(fieldOp, { v: variant === "C3" ? 0.55 : 0.8, duration: 1.2 }, 1.3);
        tl.call(() => setShowGalaxy(true), [], variant === "C3" ? 1.6 : 1.45);
        tl.to(lightRef.current, { opacity: 0, duration: 0.8 }, 1.45);
        tl.to(glow, { v: 0, duration: 0.9 }, 1.5);
        tl.call(() => beginHold(), [], 2.3);
        return;
      }
      // Stage 2: petals burst toward the viewer (engine timing: start 0.42 s); the veil hides the change of scene.
      tl.to(lightRef.current, { scale: 1.5, opacity: 0.85, duration: 0.8, ease: "sine.inOut" }, 0.65);
      if (variant === "A") {
        tl.fromTo(veilRef.current, { opacity: 0 }, { opacity: 0.86, duration: 0.55, ease: "sine.in" }, 0.95);
        tl.call(doReveal, [], 1.55);
        tl.to(lightRef.current, { opacity: 0, duration: 0.6 }, 1.4);
        tl.to(glow, { v: 0, duration: 0.8 }, 1.4);
        tl.to(veilRef.current, { opacity: 0, duration: 1.0, ease: "power1.inOut" }, 1.7);
        tl.call(() => finish(false), [], 3.0);
        return;
      }
      // C — Stage 3: the petals clear into a dark galaxy of photographs.
      tl.fromTo(veilRef.current, { opacity: 0 }, { opacity: 1, duration: 0.55, ease: "sine.in" }, 0.95);
      tl.to(fieldOp, { v: 0.9, duration: 1.0 }, 1.25);
      tl.call(() => setShowGalaxy(true), [], 1.3);
      tl.to(lightRef.current, { opacity: 0, duration: 0.7 }, 1.35);
      tl.to(glow, { v: 0, duration: 0.8 }, 1.4);
      tl.call(() => beginHold(), [], 2.3);
    }

    // ---------- WebGL layer (lazy) or CSS fallback ----------
    if (webgl) {
      const atlas = film
        ? new Promise<HTMLImageElement | null>((res) => {
            const img = new Image();
            img.decoding = "async";
            img.onload = () => res(img);
            img.onerror = () => res(null);
            img.src = mode.q === "high" ? petalAtlas.high : petalAtlas.mid;
          })
        : Promise.resolve(null);
      void Promise.all([import("./engine"), atlas]).then(([{ createEngine }, image]) => {
        if (finished || !canvasRef.current) return;
        const high = mode.q === "high";
        const c3 = variant === "C3";
        try {
          engine = createEngine({
            film: image
              ? {
                  image,
                  burst: c3 ? (high ? 64 : 44) : high ? 170 : 100,
                  drift: c3 ? (high ? 18 : 12) : high ? 60 : 36,
                  macro: c3 ? (high ? 7 : 5) : 0,
                  start: 0.4,
                  spread: c3 ? 0.7 : 0.55,
                  end: 2.9,
                  macroEnd: 600,
                  focus: c3 ? 6.6 : 6.0,
                  dof: c3 ? 1.0 : 0.7,
                  breeze: c3 ? 0.8 : 1.0,
                  // Film looks lean on burgundy and deep red; ivory is an accent.
                  weights: (WEIGHTS[themeKey] ?? WEIGHTS.romantic!).map((w, i) => w * [1.3, 1.1, 0.8, 0.55][i]!) as [number, number, number, number],
                  mouthPx,
                  cameraPush: c3 ? 1.3 : 0.5,
                  dust: c3 ? 0.45 : 0.8,
                }
              : undefined,
            canvas: canvasRef.current,
            quality: mode.q as Quality,
            origin: o,
            palette: PETALS_DEFAULT,
            weights: WEIGHTS[themeKey] ?? WEIGHTS.romantic!,
            petals: variant !== "B",
            stream: true,
            field: variant !== "A",
            petalWindow: { start: 0.42, spread: 0.55, push: galaxyOn ? 1.15 : 1, end: galaxyOn ? 2.9 : 3.0 },
            streamWindow:
              variant === "B"
                ? { start: 0.22, spread: 0.85, burst: 1.0, end: 2.9 }
                : { start: 0.25, spread: 0.6, burst: 0.85, end: 2.3 },
          });
        } catch {
          engine = null;
          return;
        }
        gsap.ticker.add(tick);
      });
    } else if (!mode.reduced && variant !== "B") {
      setLitePetals(film ? [petalAtlas.mid] : petalDataUrls(PETALS_DEFAULT, 96));
    }

    const onVis = () => {
      if (document.hidden) {
        hiddenAt = performance.now();
        tls.forEach((t) => t.pause());
      } else if (hiddenAt) {
        hiddenMs += performance.now() - hiddenAt;
        hiddenAt = 0;
        lastFrame = performance.now();
        tls.forEach((t) => t.resume());
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const onResize = () => engine?.resize();
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
      gsap.ticker.remove(tick);
      tls.forEach((t) => t.kill());
      timers.forEach((t) => window.clearTimeout(t));
      engine?.dispose();
      engine = null;
    };
    // The interlude runs once per mount; its inputs are fixed for that run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CSS fallback petals (no WebGL): a dozen compositor-only animations.
  useEffect(() => {
    const host = liteRef.current;
    if (!litePetals || !host) return;
    const anims: Animation[] = [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (let i = 0; i < 16; i++) {
      const el = document.createElement("span");
      el.className = "ci-lite__petal";
      if (litePetals.length === 1) {
        // Film looks: the real petal atlas as a sprite sheet (8 × 4 tiles).
        el.style.backgroundImage = `url(${litePetals[0]})`;
        el.style.backgroundSize = "800% 400%";
        el.style.backgroundPosition = `${((i * 3) % 8) * (100 / 7)}% ${((i % 4) * 100) / 3}%`;
        el.style.height = "48px";
      } else el.style.backgroundImage = `url(${litePetals[i % 4]})`;
      host.appendChild(el);
      const a = (i / 16) * Math.PI * 2;
      const dx = Math.cos(a) * W * (0.4 + (i % 3) * 0.15);
      const dy = Math.sin(a) * H * 0.35 - H * 0.1;
      const s = 1.4 + (i % 4) * 0.7;
      anims.push(
        el.animate(
          [
            { transform: `translate3d(${origin.x}px, ${origin.y}px, 0) rotate3d(1,0.4,0.2,0deg) scale(0.2)`, opacity: 0 },
            { opacity: 1, offset: 0.15 },
            { transform: `translate3d(${origin.x + dx}px, ${origin.y + dy}px, 0) rotate3d(1,0.4,0.2,${200 + i * 37}deg) scale(${s})`, opacity: 0 },
          ],
          { duration: 1700 + (i % 5) * 160, delay: 420 + i * 30, easing: "cubic-bezier(.35,.05,.6,1)", fill: "both" },
        ),
      );
    }
    return () => {
      anims.forEach((x) => x.cancel());
      host.replaceChildren();
    };
  }, [litePetals, origin]);

  // C: the galaxy arrives (scale/opacity) once mounted.
  useEffect(() => {
    if (!showGalaxy || !galaxyRef.current) return;
    gsap.fromTo(galaxyRef.current, { opacity: 0, scale: mode.reduced ? 1 : 0.7 }, { opacity: 1, scale: 1, duration: mode.reduced ? 0.25 : 1.1, ease: "power2.out" });
  }, [showGalaxy, mode.reduced]);

  return (
    <div ref={rootRef} className="ci" data-variant={variant} data-quality={mode.reduced ? "reduced" : mode.q} data-testid="cinematic-interlude" style={{} as CSSProperties}>
      <div ref={veilRef} className="ci-veil" aria-hidden />
      <div ref={lightRef} className="ci-light" aria-hidden />
      <canvas ref={canvasRef} className="ci-canvas" aria-hidden />
      {variant === "B" && <div ref={flashRef} className="ci-flash" aria-hidden />}
      {litePetals && <div ref={liteRef} className="ci-lite" aria-hidden />}
      {mode.q === "lite" && (variant === "C" || film) && <div className="ci-stars" aria-hidden />}
      {showGalaxy && (
        <div ref={galaxyRef} className="ci-galaxy">
          <Suspense fallback={null}>
            <MemoryGalaxy photos={photos} phrases={phrases} centerLabel={centerLabel} autoRotate={!mode.reduced} look={film ? "print" : "classic"} />
          </Suspense>
        </div>
      )}
      <div className="ci-controls">
        <button type="button" className="ci-skip" onClick={() => finishRef.current(true)} data-testid="cinematic-skip">
          {labels.skip}
        </button>
        {holding && (
          <button type="button" className="ci-continue" onClick={() => proceedRef.current()} data-testid="cinematic-open-letter">
            {labels.openLetter}
          </button>
        )}
      </div>
    </div>
  );
}

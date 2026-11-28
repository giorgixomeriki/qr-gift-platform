"use client";

/*
 * Memory Galaxy — adapted from React Bits "DomeGallery"
 * https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Components/DomeGallery/DomeGallery.tsx
 * Copyright (c) 2026 David Haz — MIT + Commons Clause (see ./LICENSES.md).
 * Used as part of this application; the component is not sold or redistributed on its own.
 *
 * Kept from the original: the sphere geometry (CSS custom-property tile placement,
 * `computeItemBaseRotation`, translateZ(-radius) sphere), the ResizeObserver radius fit,
 * the @use-gesture drag with clamped vertical rotation and the inertia loop.
 * Changed for QR STARR: sparse tiles (only the sender's photos, never repeated to fill
 * the sphere, plus phrase and gilt-frame tiles), tiles visible from both sides with
 * depth dimming, a slow auto-drift that yields to the hand, a lighter tap-to-enlarge,
 * no remote default images, `cg-` class names, transparent stage over the WebGL field.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useGesture } from "@use-gesture/react";
import "./memory-galaxy.css";

export type GalaxyTile =
  | { kind: "photo"; src: string; alt: string }
  | { kind: "phrase"; text: string }
  | { kind: "frame" };

type Placed = GalaxyTile & { x: number; y: number; sizeX: number; sizeY: number };

const SEGMENTS = 20;
const MAX_VERTICAL = 14;
const DRAG_SENSITIVITY = 22;
const DRAG_DAMPENING = 0.6;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const wrapAngleSigned = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

function computeItemBaseRotation(offsetX: number, offsetY: number, sizeX: number, sizeY: number, segments: number) {
  const unit = 360 / segments / 2;
  return { rotateY: unit * (offsetX + (sizeX - 1) / 2), rotateX: unit * (offsetY - (sizeY - 1) / 2) };
}

/**
 * A ring around the equator (offsets in half-segments; 40 = a full turn). Photos take
 * the largest places, evenly spaced; phrases sit between them; small gilt frames
 * complete the ring so the sphere never looks empty, without repeating a photo.
 */
function placeTiles(photos: GalaxyTile[], phrases: GalaxyTile[]): Placed[] {
  const out: Placed[] = [];
  const turn = SEGMENTS * 2;
  const n = photos.length;
  photos.forEach((p, i) => out.push({ ...p, x: Math.round((i * turn) / n) - 1, y: 0, sizeX: 2.5, sizeY: 3.2 }));
  const taken = (x: number) => out.some((t) => Math.abs(wrapAngleSigned(((t.x - x) * 360) / turn)) < 30);
  const phraseSlots = [34, 9, 24, 16, 3, 29, 12];
  const ys = [-4, 3, -5, 4, -4, 3, -5];
  let pi = 0;
  for (let k = 0; k < phraseSlots.length && pi < phrases.length; k++) {
    const x = phraseSlots[k]!;
    if (n && taken(x)) continue;
    out.push({ ...phrases[pi]!, x, y: ys[k]!, sizeX: 3.6, sizeY: 1.3 });
    pi++;
  }
  const frameSlots: [number, number][] = [
    [5, 3], [11, -4], [17, 5], [23, -5], [29, 4], [34, -3], [38, 5], [2, -5], [13, 1], [27, -1],
  ];
  for (const [x, y] of frameSlots) {
    if (out.length >= 14) break;
    if (out.some((t) => Math.abs(wrapAngleSigned(((t.x - x) * 360) / turn)) < 14 && Math.abs(t.y - y) < 4)) continue;
    out.push({ kind: "frame", x, y, sizeX: 1, sizeY: 1 });
  }
  return out;
}

export function MemoryGalaxy({
  photos,
  phrases,
  autoRotate = true,
  centerLabel,
}: {
  photos: { url: string; alt: string }[];
  phrases: string[];
  autoRotate?: boolean;
  centerLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sphereRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef({ x: -5, y: 22 });
  const startRotRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const inertiaRAF = useRef<number | null>(null);
  const lastInteraction = useRef(0);
  const [focused, setFocused] = useState<{ src: string; alt: string } | null>(null);

  const items = useMemo(
    () =>
      placeTiles(
        photos.slice(0, 3).map((p) => ({ kind: "photo" as const, src: p.url, alt: p.alt })),
        phrases.map((text) => ({ kind: "phrase" as const, text })),
      ),
    [photos, phrases],
  );
  const bases = useMemo(() => items.map((it) => computeItemBaseRotation(it.x, it.y, it.sizeX, it.sizeY, SEGMENTS)), [items]);
  const faceRefs = useRef<(HTMLDivElement | null)[]>([]);

  const applyTransform = useCallback(
    (xDeg: number, yDeg: number) => {
      const el = sphereRef.current;
      if (el) el.style.transform = `translateZ(calc(var(--radius) * -1)) rotateX(${xDeg}deg) rotateY(${yDeg}deg)`;
      // Each tile turns to face the viewer (floating cards, never edge-on or mirrored);
      // tiles on the far side of the ring are smaller by perspective and dimmer.
      bases.forEach((b, i) => {
        const face = faceRefs.current[i];
        if (!face) return;
        const facing = Math.cos(((b.rotateY + yDeg) * Math.PI) / 180);
        // (opacity on the face, not the 3D item: opacity flattens preserve-3d children)
        face.style.opacity = (0.3 + 0.7 * Math.pow((facing + 1) / 2, 1.4)).toFixed(3);
        face.style.transform = `rotateX(${-b.rotateX}deg) rotateY(${-(b.rotateY + yDeg)}deg) rotateX(${-xDeg}deg)`;
      });
    },
    [bases],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]!.contentRect;
      const w = Math.max(1, cr.width);
      const h = Math.max(1, cr.height);
      const minDim = Math.min(w, h);
      const aspect = w / h;
      const basis = aspect >= 1.3 ? Math.min(w * 0.55, h) : minDim;
      const radius = clamp(basis * 0.74, 200, 520);
      root.style.setProperty("--radius", `${Math.round(radius)}px`);
      applyTransform(rotationRef.current.x, rotationRef.current.y);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [applyTransform]);

  const stopInertia = useCallback(() => {
    if (inertiaRAF.current) cancelAnimationFrame(inertiaRAF.current);
    inertiaRAF.current = null;
  }, []);

  const startInertia = useCallback(
    (vx: number, vy: number) => {
      const MAX_V = 1.4;
      let vX = clamp(vx, -MAX_V, MAX_V) * 80;
      let vY = clamp(vy, -MAX_V, MAX_V) * 80;
      let frames = 0;
      const d = DRAG_DAMPENING;
      const frictionMul = 0.94 + 0.055 * d;
      const stopThreshold = 0.015 - 0.01 * d;
      const maxFrames = Math.round(90 + 270 * d);
      const step = () => {
        vX *= frictionMul;
        vY *= frictionMul;
        if ((Math.abs(vX) < stopThreshold && Math.abs(vY) < stopThreshold) || ++frames > maxFrames) {
          inertiaRAF.current = null;
          return;
        }
        const nextX = clamp(rotationRef.current.x - vY / 200, -MAX_VERTICAL, MAX_VERTICAL);
        const nextY = wrapAngleSigned(rotationRef.current.y + vX / 200);
        rotationRef.current = { x: nextX, y: nextY };
        applyTransform(nextX, nextY);
        lastInteraction.current = performance.now();
        inertiaRAF.current = requestAnimationFrame(step);
      };
      stopInertia();
      inertiaRAF.current = requestAnimationFrame(step);
    },
    [applyTransform, stopInertia],
  );

  useGesture(
    {
      onDragStart: ({ event }) => {
        if (focused) return;
        stopInertia();
        const evt = event as PointerEvent;
        draggingRef.current = true;
        movedRef.current = false;
        startRotRef.current = { ...rotationRef.current };
        startPosRef.current = { x: evt.clientX, y: evt.clientY };
      },
      onDrag: ({ event, last, velocity = [0, 0], direction = [0, 0], movement }) => {
        if (focused || !draggingRef.current || !startPosRef.current) return;
        const evt = event as PointerEvent;
        const dx = evt.clientX - startPosRef.current.x;
        const dy = evt.clientY - startPosRef.current.y;
        if (!movedRef.current && dx * dx + dy * dy > 16) movedRef.current = true;
        const nextX = clamp(startRotRef.current.x - dy / DRAG_SENSITIVITY, -MAX_VERTICAL, MAX_VERTICAL);
        const nextY = wrapAngleSigned(startRotRef.current.y + dx / DRAG_SENSITIVITY);
        rotationRef.current = { x: nextX, y: nextY };
        applyTransform(nextX, nextY);
        lastInteraction.current = performance.now();
        if (last) {
          draggingRef.current = false;
          let vx = velocity[0] * direction[0];
          let vy = velocity[1] * direction[1];
          if (Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001 && Array.isArray(movement)) {
            vx = clamp((movement[0] / DRAG_SENSITIVITY) * 0.02, -1.2, 1.2);
            vy = clamp((movement[1] / DRAG_SENSITIVITY) * 0.02, -1.2, 1.2);
          }
          if (Math.abs(vx) > 0.005 || Math.abs(vy) > 0.005) startInertia(vx, vy);
        }
      },
    },
    { target: mainRef, eventOptions: { passive: true } },
  );

  // Slow drift, yielding to the hand for 2.5 s after any touch; stops when hidden or unmounted.
  useEffect(() => {
    if (!autoRotate) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (!draggingRef.current && !inertiaRAF.current && !focused && now - lastInteraction.current > 2500 && !document.hidden) {
        const r = rotationRef.current;
        r.y = wrapAngleSigned(r.y - dt * 0.009);
        applyTransform(r.x, r.y);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate, applyTransform, focused]);

  useEffect(() => () => stopInertia(), [stopInertia]);

  const openTile = (it: Placed) => {
    if (movedRef.current || it.kind !== "photo") return;
    setFocused({ src: it.src, alt: it.alt });
  };

  return (
    <div ref={rootRef} className="cg-root" style={{ "--segments": SEGMENTS } as CSSProperties} data-testid="memory-galaxy">
      <div ref={mainRef} className="cg-main">
        <div className="cg-core" aria-hidden>
          <span className="cg-core__glow" />
          {centerLabel && <span className="cg-core__label">{centerLabel}</span>}
        </div>
        <div className="cg-stage">
          <div ref={sphereRef} className="cg-sphere">
            {items.map((it, i) => (
              <div
                key={`${it.kind}-${it.x}-${it.y}`}
                className="cg-item"
                data-kind={it.kind}
                style={{ "--offset-x": it.x, "--offset-y": it.y, "--item-size-x": it.sizeX, "--item-size-y": it.sizeY } as CSSProperties}
              >
                <div
                  ref={(n) => {
                    faceRefs.current[i] = n;
                  }}
                  className="cg-face"
                  role={it.kind === "photo" ? "button" : undefined} tabIndex={it.kind === "photo" ? 0 : -1} aria-label={it.kind === "photo" ? it.alt : undefined} onClick={() => openTile(it)} onKeyDown={(e) => e.key === "Enter" && openTile(it)}>
                  {it.kind === "photo" && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed media URL (same as the photo beat), not next/image
                    <img src={it.src} alt="" draggable={false} decoding="async" />
                  )}
                  {it.kind === "phrase" && <span className="cg-phrase">{it.text}</span>}
                  {it.kind === "frame" && <span className="cg-frame" />}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="cg-vignette" aria-hidden />
      </div>
      {focused && (
        <button type="button" className="cg-viewer" onClick={() => setFocused(null)} aria-label="Close">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed media URL */}
          <img src={focused.src} alt={focused.alt} />
        </button>
      )}
    </div>
  );
}

export default MemoryGalaxy;

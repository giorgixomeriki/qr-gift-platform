"use client";

import { useEffect, useRef, useState } from "react";
import { WaxSeal } from "./wax-seal";

const DIR = "/customer/illustrations";

/** One photographic layer, art-directed exactly like the photograph itself. */
function SceneLayer({ name, className, lazy }: { name: string; className: string; lazy?: boolean }) {
  const img = `${DIR}/${name}`;
  return (
    <picture>
      <source media="(min-width: 1024px)" type="image/avif" srcSet={`${img}-desktop-1200.avif 1200w, ${img}-desktop-1800.avif 1800w`} sizes="70vw" />
      <source media="(min-width: 1024px)" type="image/webp" srcSet={`${img}-desktop-1200.webp 1200w, ${img}-desktop-1800.webp 1800w`} sizes="70vw" />
      <source type="image/avif" srcSet={`${img}-mobile-640.avif 640w, ${img}-mobile-960.avif 960w, ${img}-mobile-1280.avif 1280w`} sizes="100vw" />
      <source type="image/webp" srcSet={`${img}-mobile-640.webp 640w, ${img}-mobile-960.webp 960w, ${img}-mobile-1280.webp 1280w`} sizes="100vw" />
      <img
        src={`${img}-mobile-960.webp`}
        alt=""
        width={960}
        height={840}
        decoding="async"
        // The photograph is the page's LCP; the card layers only matter for
        // motion — lazy keeps them off the critical path (and unloaded under
        // reduced motion, where CSS removes them from layout).
        {...(lazy ? { loading: "lazy" as const } : { fetchPriority: "high" as const })}
        className={className}
      />
    </picture>
  );
}

/** The card's lift out of the envelope, in cqw: along the card, away from the flap. */
const LIFT = { x: -0.2525 * 1.6, y: 0.9676 * 1.6 };
const CARD_MS = 700;
/** Earliest start, and the latest at which a lift still reads as the entrance. */
const CARD_EARLIEST = 160;
const CARD_LATEST = 700;
/** The seal comes down this long after the card starts, landing as the card settles. */
const SEAL_AFTER_CARD = 560;

/**
 * Screen #1's signature scene: a real photograph of a blank card tucked
 * under a kraft envelope flap in window light (Unsplash, see
 * public/customer/LICENSES.md), with QR Starr's own layers on top — the
 * card's words set live in HTML (so KA/EN are real type, never baked into
 * the image) and the QR Starr wax seal where the flap meets the card.
 *
 * The card is also its own layer, cut from the same photograph: its edge
 * hidden under the flap is reconstructed, and so is what lies under its
 * edges. At rest the layers reproduce the photograph pixel for pixel, so the
 * card can lift a few millimetres out of the envelope and settle home before
 * the seal is pressed — without a seam. If the layers aren't decoded in time
 * (slow network, late hydration) the card simply doesn't move; the rest of
 * the entrance is CSS and never waits (globals.css, .cx-scene: one timeline).
 *
 * At the photograph's top-right edge (desktop), a sprig of dried gypsophila
 * sits between the lens and the table, out of focus: it is registered to
 * the photograph (never over the stationery) and settles and fades with it.
 *
 * On pointer devices the seal's highlight follows the viewer by a few units —
 * a reflection responding, never the photograph moving. `leaving` (and the
 * primary action's hover/focus, via CSS) reach into the scene; the card
 * layer carries a view-transition name for the later bridge into the theme
 * picker.
 *
 * Decorative — hidden from assistive tech; the page's headline carries the
 * meaning.
 */
export function EntryScene({ line, leaving = false, className = "" }: { line: string; leaving?: boolean; className?: string }) {
  const sceneRef = useRef<HTMLElement>(null);
  const [layers, setLayers] = useState<"pending" | "ready">("pending");

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;

    // The CSS timeline's origin — first paint of the scene. The veil's own
    // animation says how long ago that was.
    const now = () => Number(document.timeline.currentTime ?? performance.now());
    const veil = scene.querySelector(".cx-scene__veil")?.getAnimations()[0];
    const origin = now() - Number(veil?.currentTime ?? 0);

    const imgs = [...scene.querySelectorAll<HTMLImageElement>(".cx-scene__card-photo, .cx-scene__under")];
    Promise.all(imgs.map((img) => img.decode()))
      .then(() => {
        if (cancelled) return;
        setLayers("ready");
        const at = now() - origin;
        if (at > CARD_LATEST) return; // too late to belong to the entrance: stay still
        const start = Math.max(at, CARD_EARLIEST);
        scene.style.setProperty("--cx-press", `${Math.round(start + SEAL_AFTER_CARD)}ms`);

        const move = scene.querySelector<HTMLElement>(".cx-scene__card-move")!;
        const photo = scene.querySelector<HTMLElement>(".cx-scene__card-photo")!;
        const under = scene.querySelector<HTMLElement>(".cx-scene__under")!;
        const timing = { duration: CARD_MS, delay: start - at };
        // Lifted and drawn out (ease-in-out), then pushed home, settling by
        // friction (ease-out) — no overshoot.
        move.animate(
          [
            { transform: "none", easing: "cubic-bezier(0.45, 0, 0.35, 1)" },
            { transform: `translate(${LIFT.x}cqw, ${LIFT.y}cqw)`, offset: 0.4, easing: "cubic-bezier(0.2, 0.7, 0.25, 1)" },
            { transform: "none" },
          ],
          timing,
        );
        // Off the table it throws its own shadow; on it, the photograph's.
        photo.animate(
          [
            { filter: "drop-shadow(0 0 0 rgb(60 35 25 / 0))" },
            { filter: "drop-shadow(0.4cqw 0.9cqw 1.4cqw rgb(60 35 25 / 0.22))", offset: 0.4 },
            { filter: "drop-shadow(0 0 0 rgb(60 35 25 / 0))" },
          ],
          { ...timing, easing: "ease-in-out" },
        );
        // What lies under the card is only shown while it's away; the
        // photograph's own contact shadow returns as it touches down.
        under.animate([{ opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { ...timing, fill: "backwards" });
      })
      .catch(() => {});

    // The seal's reflection follows a mouse pointer, a few units at most.
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = scene.getBoundingClientRect();
        const clamp = (v: number) => Math.max(-1, Math.min(1, v)).toFixed(3);
        scene.style.setProperty("--cx-lx", clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
        scene.style.setProperty("--cx-ly", clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
      });
    };
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (finePointer) window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <figure
      ref={sceneRef}
      className={`cx-scene ${className}`}
      aria-hidden
      data-testid="entry-hero"
      data-layers={layers}
      data-leaving={leaving || undefined}
    >
      <div className="cx-scene__stage">
        <SceneLayer name="entry-stationery" className="cx-scene__photo" />
        <SceneLayer name="entry-under" className="cx-scene__under" lazy />
        <div className="cx-scene__card">
          <div className="cx-scene__card-move">
            <SceneLayer name="entry-card" className="cx-scene__card-photo" lazy />
            <p className="cx-scene__words">
              <span>{line}</span>
            </p>
          </div>
        </div>
        <WaxSeal className="cx-scene__seal" />
        {/* Dried gypsophila nearer the lens than the table, out of focus at
            the photograph's top-right edge (desktop crop only; CSS). */}
        <span className="cx-scene__botanical" />
      </div>
      <span className="cx-scene__veil" />
      <span className="cx-scene__weather" />
    </figure>
  );
}

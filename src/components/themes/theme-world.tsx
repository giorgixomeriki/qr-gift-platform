"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { SPARK_PATH } from "@/components/ui/logo";
import type { ThemeKey } from "@/lib/themes/registry";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";
import { COMPOSITIONS, type CompositionId, type FinaleId } from "@/lib/templates/vocabulary";
import { FINALE_LAYERS } from "./finale-layers";
import { FINALE_SCENES } from "./scenes/finales";
import { SCENES } from "./scenes/scenes";
import { useDepth, useThemeScene } from "./scenes/use-scene";
import "./theme-world.css";

/**
 * One template's world as the recipient will meet it: its authored
 * composition (layout, artwork, material, scene — chosen by
 * `world.composition`, never by template id) in the template's palette and
 * type: its ground and material, its artwork, the opening line (the
 * template's real localized opening) and the card with the message. Live
 * HTML type, never baked into images.
 *
 * Each composition has its own layout (theme-world.css, "Theme worlds"), laid
 * out in container-query units so the same world works from a 280px phone
 * card to a large desktop stage. Decorative: callers expose the theme
 * through their own accessible controls (aria-hidden here).
 *
 * Artwork is adapted from professional sources rather than drawn here:
 * Romantic's honeysuckle and Wedding's olive are period engravings (Wellcome
 * Collection 1775, CC BY 4.0; W. H. Fitch 1874, public domain) used as
 * masks so they print in each world's ink (public/customer/LICENSES.md).
 *
 * `active` plays the world's scene once (scenes/scenes.ts — a miniature
 * story told with GSAP over these same elements, ending on the CSS rest
 * state); `motion="short"` plays it faster. `interactive` lets the chosen
 * world answer the pointer with depth. Real footage (Romantic's leaf
 * shadows, Celebration's night sky) loads only when its scene plays; at rest
 * a still of its last frame stands in. `near` applies the world's own
 * typefaces and artwork only near the viewport.
 *
 * The recipient reveal uses the same world with a real message: `sealed`
 * holds it closed (its ground only) until it is opened; `onRest` reports
 * when its scene has come to rest; `onFit` reports whether the message fits
 * on the card — when it does not, the card shows its beginning under a soft
 * fade (data-overflow) and the reveal presents the whole letter. `finale`
 * presents the world closing the greeting (the reveal's ending beat): it
 * starts at the rest its scene left it in and, when `active`, plays the
 * finale (scenes/finales.ts) to the finale's resting state (CSS).
 */
export function ThemeWorld({
  themeKey,
  version,
  opening,
  message,
  active = false,
  motion = "full",
  near = true,
  interactive = false,
  sealed = false,
  finale,
  fit = false,
  onRest,
  onFit,
  className = "",
  style,
}: {
  themeKey: ThemeKey;
  /** A specific template version (a sent greeting's); latest when omitted. */
  version?: number;
  opening: string;
  message: string;
  active?: boolean;
  motion?: "full" | "short";
  near?: boolean;
  interactive?: boolean;
  sealed?: boolean;
  /** Present the world closing with this finale (it must be authored for the world's composition). */
  finale?: FinaleId;
  /** Fit a real (possibly long) message to the card — implied by `onFit`. */
  fit?: boolean;
  onRest?: () => void;
  onFit?: (fits: boolean) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const world = getThemeWorld(themeKey, version);
  const c = world.composition;
  const ref = useRef<HTMLDivElement>(null);
  useThemeScene(ref, finale ? FINALE_SCENES[finale] : SCENES[c], active, motion, onRest, finale ? "finale-pending" : "pending");
  const FinaleLayer = finale && FINALE_LAYERS[finale];
  useDepth(ref, interactive && near);
  useMessageFit(ref, message, near, COMPOSITIONS[c].messageLines, fit || !!onFit, onFit);
  useHeadlineFit(ref, opening, near, !!finale);
  return (
    <div
      ref={ref}
      className={`tw tw--${c} ${className}`}
      style={{ ...worldVars(world), ...style }}
      data-active={active || undefined}
      data-motion={active ? motion : undefined}
      data-near={near || undefined}
      data-sealed={sealed || undefined}
      data-finale={finale}
      aria-hidden
    >
      <div className="tw__ground" />
      {c === "quiet-light" && <span className="tw__dusk" />}
      <WorldArtwork composition={c} />
      <p className="tw__opening">{opening}</p>
      <div className="tw__card" data-depth="-0.6">
        {c === "vellum" && (
          <span className="tw__press">
            <span className="tw__engraving" />
            <span className="tw__sheen" />
          </span>
        )}
        {c === "vellum" && <span className="tw__vellum" />}
        {c === "just-words" && <span className="tw__point" />}
        {c === "just-words" && <span className="tw__hairline" />}
        {c === "ink-and-stone" && (
          <span className="tw__frame">
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
        <p className="tw__message">{message}</p>
        {FinaleLayer && <FinaleLayer />}
        <svg viewBox="0 0 24 24" className="tw__mark">
          <path d={SPARK_PATH} />
        </svg>
        {c === "quiet-light" && <span className="tw__vellum" />}
        {c === "vellum" && (
          <span className="tw__veil">
            <span className="tw__seal">
              <svg viewBox="0 0 24 24">
                <path d={SPARK_PATH} />
              </svg>
            </span>
          </span>
        )}
      </div>
      {c === "paper-party" && <span className="tw__dot tw__dot--c" />}
      {c === "paper-party" && <PaperBits />}
      {c === "quiet-light" && (
        <>
          <span className="tw__leaves" />
          <video className="tw__leaves-film" data-src="/customer/scenes/romantic-leaves.mp4" muted playsInline preload="none" tabIndex={-1} />
        </>
      )}
      {c === "ink-and-stone" && (
        <>
          <span className="tw__shutter tw__shutter--l" />
          <span className="tw__shutter tw__shutter--r" />
          <span className="tw__slit" />
        </>
      )}
    </div>
  );
}

/**
 * Does the message fit on the card? Each composition's card is designed for
 * a number of lines (`messageLines`); the message is measured against that
 * in its own type (layout sizes, unaffected by the scene's transforms) and
 * re-measured once the world's typefaces have loaded. When it does not fit,
 * the card keeps its beginning (--msg-max, data-overflow).
 */
function useMessageFit(ref: React.RefObject<HTMLDivElement | null>, message: string, near: boolean, lines: number, enabled: boolean, onFit?: (fits: boolean) => void) {
  const onFitRef = useRef(onFit);
  useLayoutEffect(() => {
    onFitRef.current = onFit;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let alive = true;
    const measure = () => {
      const msg = el.querySelector<HTMLElement>(".tw__message");
      if (!alive || !msg) return;
      delete el.dataset.overflow;
      msg.style.removeProperty("--msg-max");
      const style = getComputedStyle(msg);
      const fs = parseFloat(style.fontSize);
      const lh = style.lineHeight.endsWith("px") ? parseFloat(style.lineHeight) : (parseFloat(style.lineHeight) || 1.3) * fs;
      const room = lines * lh;
      const fits = msg.scrollHeight <= room + lh * 0.25;
      if (!fits) {
        el.dataset.overflow = "";
        msg.style.setProperty("--msg-max", `${room}px`);
      }
      onFitRef.current?.(fits);
    };
    measure();
    const msg = el.querySelector<HTMLElement>(".tw__message");
    if (msg) void whenFontLoaded(msg).then(measure);
    return () => {
      alive = false;
    };
  }, [ref, message, near, lines, enabled]);
}

/**
 * Resolves once the element's own face is loaded for its own text. A face is
 * fetched only when text first uses it, so `document.fonts.ready` can resolve
 * before a world's typeface has even been requested — measuring then would
 * use the fallback's metrics.
 */
function whenFontLoaded(el: HTMLElement): Promise<unknown> {
  if (!document.fonts) return Promise.resolve();
  const cs = getComputedStyle(el);
  return document.fonts.load(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, el.textContent || "a").catch(() => undefined);
}

/**
 * A closing line set in the world's headline slot can be one long word
 * ("Congratulations!") where the opening line had two short ones. Scale it
 * down until its longest word fits the slot, so a word never breaks.
 */
function useHeadlineFit(ref: React.RefObject<HTMLDivElement | null>, text: string, near: boolean, enabled: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    const line = el?.querySelector<HTMLElement>(".tw__opening");
    if (!el || !line || !enabled) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      line.style.removeProperty("font-size");
      // Words never break here: measured unbroken, scaled until the longest fits.
      line.style.overflowWrap = "normal";
      for (let i = 0; i < 12 && line.scrollWidth > line.clientWidth + 0.5; i++) {
        const over = line.scrollWidth / Math.max(line.clientWidth, 1);
        line.style.fontSize = `${(parseFloat(getComputedStyle(line).fontSize) / Math.max(over, 1.02)) * 0.98}px`;
      }
    };
    measure();
    void whenFontLoaded(line).then(measure);
    return () => {
      alive = false;
    };
  }, [ref, text, near, enabled]);
}

/**
 * Birthday's cut paper: where each piece lands after the burst (cqw), its
 * shape and colour. The pieces frame the composition — none crosses the type.
 */
const BITS: { s: "circle" | "tri" | "strip"; c: string; w: number; x: number; y: number; r: number }[] = [
  { s: "circle", c: "--w-card", w: 3.4, x: 12, y: 16, r: 0 },
  { s: "tri", c: "--w-accent-3", w: 5, x: 78, y: 70, r: 25 },
  { s: "strip", c: "--w-accent-2", w: 9, x: 6, y: 60, r: -30 },
  { s: "circle", c: "--w-accent", w: 4.2, x: 22, y: 113, r: 0 },
  { s: "tri", c: "--w-card", w: 4, x: 60, y: 8, r: -15 },
  { s: "strip", c: "--w-card", w: 7, x: 88, y: 26, r: 60 },
  { s: "circle", c: "--w-accent-3", w: 2.6, x: 45, y: 74, r: 0 },
  { s: "tri", c: "--w-accent-2", w: 4.4, x: 30, y: 84, r: 70 },
  { s: "strip", c: "--w-accent-3", w: 8, x: 66, y: 120, r: 15 },
  { s: "circle", c: "--w-card", w: 2.2, x: 94, y: 98, r: 0 },
  { s: "tri", c: "--w-accent", w: 3.6, x: 4, y: 96, r: -40 },
  { s: "strip", c: "--w-accent", w: 6, x: 40, y: 6, r: -70 },
];

function PaperBits() {
  return BITS.map((b, i) => (
    <span
      key={i}
      className={`tw__bit tw__bit--${b.s}`}
      style={{ "--bx": `${b.x}cqw`, "--by": `${b.y}cqw`, "--bw": `${b.w}cqw`, "--br": `${b.r}deg`, "--bc": `var(${b.c})` } as CSSProperties}
    />
  ));
}

function WorldArtwork({ composition }: { composition: CompositionId }) {
  switch (composition) {
    case "quiet-light":
      return (
        <>
          <span className="tw__light" data-depth="2" />
          <span className="tw__engraving" data-depth="0.8" />
        </>
      );
    case "paper-party":
      return (
        <>
          <span className="tw__disc" />
          <span className="tw__arc" />
          <svg viewBox="0 0 200 60" className="tw__streamer" preserveAspectRatio="none">
            <path d="M0 30 C 20 6, 40 6, 60 30 S 100 54, 120 30 S 160 6, 180 30 L 200 30 L 200 44 L 180 44 C 160 20, 140 20, 120 44 S 80 68, 60 44 S 20 20, 0 44 Z" />
          </svg>
          <span className="tw__dot tw__dot--a" />
          <span className="tw__dot tw__dot--b" />
        </>
      );
    case "vellum":
      return null;
    case "signal":
      return (
        <>
          <span className="tw__sky" />
          <video className="tw__sky-film" data-src="/customer/scenes/celebration-sky.mp4" muted playsInline preload="none" tabIndex={-1} />
          <span className="tw__flash" />
          <Burst />
          <span className="tw__streak" />
          <svg viewBox="0 0 24 24" className="tw__focus"><path d={SPARK_PATH} /></svg>
          <svg viewBox="0 0 24 24" className="tw__spark tw__spark--a"><path d={SPARK_PATH} /></svg>
          <svg viewBox="0 0 24 24" className="tw__spark tw__spark--b"><path d={SPARK_PATH} /></svg>
          <svg viewBox="0 0 24 24" className="tw__spark tw__spark--c"><path d={SPARK_PATH} /></svg>
        </>
      );
    case "ink-and-stone":
      return <span className="tw__rule" />;
    case "just-words":
      return null;
  }
}

/** Celebration's controlled light burst: hairlines radiating from low left. */
function Burst() {
  const lines = Array.from({ length: 26 }, (_, i) => {
    const a = (-88 + i * (82 / 25)) * (Math.PI / 180);
    const len = [78, 52, 96, 64, 88, 46, 104, 70][i % 8]!;
    const r0 = 10;
    return {
      x1: 22 + Math.cos(a) * r0,
      y1: 104 + Math.sin(a) * r0,
      x2: 22 + Math.cos(a) * (r0 + len),
      y2: 104 + Math.sin(a) * (r0 + len),
      alt: i % 3 === 1,
      i,
    };
  });
  return (
    <svg viewBox="0 0 100 125" className="tw__burst" preserveAspectRatio="xMinYMax slice">
      {lines.map((l) => (
        <line
          key={l.i}
          x1={l.x1.toFixed(2)}
          y1={l.y1.toFixed(2)}
          x2={l.x2.toFixed(2)}
          y2={l.y2.toFixed(2)}
          pathLength={1}
          className={l.alt ? "tw__ray tw__ray--alt" : "tw__ray"}
          style={{ "--i": l.i } as CSSProperties}
        />
      ))}
    </svg>
  );
}

/**
 * The world's compact signature for selectors: a miniature of the world's
 * own material and artwork (its engraving, cut paper, burst, frame or point),
 * so a seal previews an identity rather than a colour swatch.
 */
export function ThemeSeal({ themeKey, className = "" }: { themeKey: ThemeKey; className?: string }) {
  const world = getThemeWorld(themeKey);
  return (
    <span className={`tw-seal tw-seal--${world.composition} ${className}`} style={worldVars(world)} aria-hidden>
      <SealArt composition={world.composition} />
    </span>
  );
}

function SealArt({ composition }: { composition: CompositionId }) {
  switch (composition) {
    case "quiet-light":
      return <i className="tw-seal__engraving" />;
    case "vellum":
      return (
        <i className="tw-seal__card">
          <i className="tw-seal__engraving" />
        </i>
      );
    case "paper-party":
      return (
        <svg viewBox="0 0 40 40" focusable="false">
          <circle cx="25" cy="16" r="11" fill="var(--w-accent)" style={{ filter: "drop-shadow(0.6px 1.2px 0 rgb(var(--w-shadow) / 0.3))" }} />
          <path d="M-2 33 A 15 15 0 0 1 22 30" stroke="var(--w-accent-2)" strokeWidth="5.5" fill="none" style={{ filter: "drop-shadow(0.6px 1.2px 0 rgb(var(--w-shadow) / 0.28))" }} />
          <path d="M4 9 C 8 5, 12 5, 16 9 S 24 13, 28 9" stroke="var(--w-accent-3)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "signal":
      return (
        <svg viewBox="0 0 40 40" focusable="false">
          {Array.from({ length: 11 }, (_, i) => {
            const a = (-86 + i * 8) * (Math.PI / 180);
            const len = [26, 19, 30, 22, 28, 17, 31, 21, 27, 18, 25][i]!;
            return <line key={i} x1={8 + Math.cos(a) * 4} y1={34 + Math.sin(a) * 4} x2={8 + Math.cos(a) * len} y2={34 + Math.sin(a) * len} stroke={i % 3 === 1 ? "var(--w-accent-2)" : "var(--w-accent)"} strokeWidth="0.7" strokeLinecap="round" />;
          })}
          <path d={SPARK_PATH} fill="var(--w-accent)" transform="translate(26 7) scale(0.32)" />
        </svg>
      );
    case "ink-and-stone":
      return (
        <svg viewBox="0 0 40 40" focusable="false">
          <line x1="12" y1="0" x2="12" y2="40" stroke="var(--w-rule)" strokeWidth="0.6" />
          <rect x="17" y="7" width="15" height="26" fill="var(--w-card)" />
          <rect x="18.6" y="8.6" width="11.8" height="22.8" fill="none" stroke="var(--w-ink)" strokeOpacity="0.35" strokeWidth="0.4" />
          <line x1="20" y1="21" x2="28" y2="21" stroke="var(--w-ink)" strokeOpacity="0.35" strokeWidth="0.4" />
        </svg>
      );
    case "just-words":
      return (
        <svg viewBox="0 0 40 40" focusable="false">
          <rect x="9" y="8" width="22" height="24" fill="var(--w-card)" />
          <circle cx="13" cy="18.5" r="1.25" fill="var(--w-accent)" />
          <line x1="16" y1="18.5" x2="26.5" y2="18.5" stroke="var(--w-ink)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="16" y1="22.5" x2="22.5" y2="22.5" stroke="var(--w-ink)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

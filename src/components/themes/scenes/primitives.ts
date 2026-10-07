/**
 * Theme-scene primitives: small, reusable pieces of choreography that each
 * world's scene composes (scenes.ts) — and that the editor, preview and the
 * recipient reveal can reuse with the same elements later.
 *
 * Every primitive adds tweens to a GSAP timeline at a given time and only
 * ever animates FROM an offset state TO the element's natural rest (identity
 * transforms, CSS opacity), so the CSS rest state is always the final frame.
 * Worlds keep their resting tilt/offset in CSS `rotate`/`translate`, which
 * GSAP's transform composes with rather than replaces.
 */
import type { Gsap, Split } from "./runtime";

type Timeline = ReturnType<Gsap["timeline"]>;
type SplitInstance = InstanceType<Split>;

export type SceneContext = {
  el: HTMLElement;
  gsap: Gsap;
  SplitText: Split;
  /** Container-query width units → px for this world. */
  cq: (v: number) => number;
  splits: SplitInstance[];
  films: HTMLVideoElement[];
};

/** A scene: tweens added to a timeline over a world's elements (scenes.ts, finales.ts). */
export type SceneFn = (ctx: SceneContext, tl: Timeline) => void;

export function sceneContext(el: HTMLElement, gsap: Gsap, SplitText: Split): SceneContext {
  const w = el.clientWidth;
  return { el, gsap, SplitText, cq: (v) => (v * w) / 100, splits: [], films: [] };
}

/** Undo everything a scene created (split text, playing films). */
export function disposeScene(ctx: SceneContext) {
  for (const s of ctx.splits) s.revert();
  for (const v of ctx.films) v.pause();
}

export const q = <T extends Element = HTMLElement>(ctx: SceneContext, sel: string) => ctx.el.querySelector<T>(sel);
export const qa = <T extends Element = HTMLElement>(ctx: SceneContext, sel: string) => [...ctx.el.querySelectorAll<T>(sel)];

/**
 * Settle into the finale: the world's elements travel from where its scene
 * left them to the finale's resting state — which is CSS
 * (`.tw[data-finale=…]` rules, inactive while the world is held
 * "finale-pending"), the same state reduced motion shows directly. Both ends
 * are read from the stylesheet, so the CSS stays the single source of truth;
 * the inline values are cleared at the end.
 */
export function settleIntoFinale(
  ctx: SceneContext,
  tl: Timeline,
  at: number,
  targets: (Element | null)[],
  props: string[],
  { duration, ease = "power1.inOut", stagger = 0 }: { duration: number; ease?: string; stagger?: number },
) {
  const els = targets.filter((t): t is HTMLElement => t instanceof HTMLElement);
  if (!els.length) return;
  const read = () => els.map((t) => Object.fromEntries(props.map((p) => [p, getComputedStyle(t).getPropertyValue(p)])));
  const hold = ctx.el.dataset.scene;
  const from = read();
  ctx.el.dataset.scene = "measuring";
  const to = read();
  ctx.el.dataset.scene = hold;
  els.forEach((t, i) => {
    const camel = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
    tl.fromTo(t, camel(from[i]!), { ...camel(to[i]!), duration, ease, clearProps: props.join(",") }, at + i * stagger);
  });
}

/** A pause — anticipation is part of the choreography. */
export function hold(tl: Timeline, seconds: number) {
  tl.to({}, { duration: seconds });
}

/**
 * Real footage as a light layer (e.g. leaf shadows swaying at a window).
 * The film loads only when its scene plays; it plays once and then holds its
 * last frame — the scene comes to rest with it.
 */
export function playFilm(ctx: SceneContext, tl: Timeline, at: number, video: HTMLVideoElement | null, { fadeTo, fadeFor }: { fadeTo: number; fadeFor: number }) {
  if (!video) return;
  ctx.films.push(video);
  tl.call(
    () => {
      if (!video.src && video.dataset.src) video.src = video.dataset.src;
      video.currentTime = 0;
      void video.play().catch(() => {});
    },
    undefined,
    at,
  );
  tl.fromTo(video, { opacity: 0 }, { opacity: fadeTo, duration: fadeFor, ease: "power1.inOut" }, at);
}

/** ThemeLight — the room starts at dusk; a light travels across it and comes to rest. */
export function themeLight(ctx: SceneContext, tl: Timeline, at: number, { dusk, light, travel = 30 }: { dusk?: Element | null; light?: Element | null; travel?: number }) {
  const { cq } = ctx;
  if (dusk) tl.fromTo(dusk, { opacity: 0.8 }, { opacity: 0, duration: 2.4, ease: "power1.out" }, at);
  if (light) tl.from(light, { opacity: 0, x: cq(-travel), rotation: -6, duration: 2.2, ease: "power2.out" }, at);
}

/** Growth — artwork appears as if it were drawn or grew from one edge. */
export function grow(tl: Timeline, at: number, target: Element | null, from: "bottom" | "right" | "top", duration = 2) {
  if (!target) return;
  const start = { bottom: "inset(100% 0 0 0)", right: "inset(0 0 0 100%)", top: "inset(0 0 100% 0)" }[from];
  tl.fromTo(target, { clipPath: start }, { clipPath: "inset(0% 0% 0% 0%)", duration, ease: "power2.inOut", clearProps: "clipPath" }, at);
}

/** Ink — lines (or words) of type rise from their own baselines behind a mask. */
export function inkLines(ctx: SceneContext, tl: Timeline, at: number, targets: Element[], { stagger = 0.18, duration = 1.1 } = {}) {
  const split = new ctx.SplitText(targets, { type: "lines", mask: "lines" });
  ctx.splits.push(split);
  tl.from(split.lines, { yPercent: 105, duration, stagger, ease: "power3.out" }, at);
}

/** VellumReveal — a sealed vellum sheet: the seal is pressed, then the sheet is drawn up and away. */
export function vellumReveal(ctx: SceneContext, tl: Timeline, at: number, { sheet, seal }: { sheet: Element | null; seal: Element | null }) {
  if (!sheet) return at;
  const { cq } = ctx;
  tl.set(sheet, { visibility: "visible" }, 0);
  if (seal) {
    tl.from(seal, { scale: 1.3, opacity: 0, duration: 0.7, ease: "power2.out" }, at)
      .to(seal, { scale: 0.88, duration: 0.18, ease: "power2.in" }, at + 0.95)
      .to(seal, { scale: 1, duration: 0.5, ease: "back.out(3)" }, at + 1.13);
  }
  const drawAt = at + (seal ? 1.6 : 0.3);
  tl.to(sheet, { y: cq(-140), scale: 1.05, duration: 1.8, ease: "qs-hand" }, drawAt).set(sheet, { clearProps: "all" });
  return drawAt;
}

/** A band of light passing across a surface once (letterpress catching light). */
export function sheen(tl: Timeline, at: number, band: Element | null, width: number) {
  if (!band) return;
  tl.fromTo(band, { x: 0, opacity: 1 }, { x: width * 2.4, duration: 1.7, ease: "power1.inOut" }, at).set(band, { opacity: 0 });
}

/**
 * PaperBurst — cut-paper pieces fly from an origin under real 2D physics
 * (velocity, angle, gravity) and then land in their designed places, so the
 * burst ends as a composed layout rather than scattered confetti.
 */
export function paperBurst(ctx: SceneContext, tl: Timeline, at: number, pieces: HTMLElement[], origin: { x: number; y: number }) {
  const { gsap, cq, el } = ctx;
  const box = el.getBoundingClientRect();
  pieces.forEach((p, i) => {
    const r = p.getBoundingClientRect();
    const dx = box.left + cq(origin.x) - (r.left + r.width / 2);
    const dy = box.top + cq(origin.y) - (r.top + r.height / 2);
    tl.set(p, { x: dx, y: dy, scale: 0, rotation: 0 }, 0)
      .to(p, { scale: 1, duration: 0.15 }, at + i * 0.01)
      .to(p, { physics2D: { velocity: gsap.utils.random(cq(70), cq(120)), angle: gsap.utils.random(200, 340), gravity: cq(260) }, rotation: gsap.utils.random(-220, 220), duration: 0.45, ease: "none" }, at + 0.03)
      .to(p, { x: 0, y: 0, rotation: 0, duration: 0.6, ease: "back.out(1.8)" }, at + 0.48 + i * 0.012);
  });
}

/** StarrIgnition — a tiny Starr appears, holds its breath, and ignites with a flash of light. Returns the ignition time. */
export function starrIgnition(ctx: SceneContext, tl: Timeline, at: number, { starr, flash }: { starr: Element | null; flash: Element | null }) {
  const ignite = at + 0.95;
  if (starr) {
    tl.fromTo(starr, { scale: 0, opacity: 0 }, { scale: 0.45, opacity: 1, duration: 0.6, ease: "power2.out" }, at)
      .to(starr, { scale: 0.38, duration: 0.35, ease: "power1.inOut" }, at + 0.6)
      .to(starr, { scale: 1.9, rotation: 90, duration: 0.25, ease: "power3.out" }, ignite)
      .to(starr, { scale: 1, rotation: 0, duration: 0.8, ease: "back.out(2)" }, ignite + 0.25);
  }
  if (flash) {
    // The glow settles to its resting strength (CSS), not to nothing.
    const rest = Number(getComputedStyle(flash).opacity);
    tl.fromTo(flash, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: "power3.out" }, ignite)
      .to(flash, { scale: 1.4, opacity: Math.max(rest, 0.35), duration: 1.4, ease: "power2.out" }, ignite + 0.25)
      .to(flash, { scale: 1, opacity: rest, duration: 1.2, clearProps: "transform,opacity" }, ignite + 1.65);
  }
  return ignite;
}

/** Light reveals type: characters come out of a blur, as if appearing through the light. */
export function throughLight(ctx: SceneContext, tl: Timeline, at: number, target: Element | null) {
  if (!target) return;
  const split = new ctx.SplitText(target, { type: "words,chars" });
  ctx.splits.push(split);
  tl.from(split.chars, { opacity: 0, filter: "blur(6px)", duration: 0.7, stagger: 0.035, ease: "power2.out", clearProps: "filter" }, at);
}

/** EditorialShutters — a slit of light, then two panels part to reveal the subject. */
export function editorialShutters(tl: Timeline, at: number, { left, right, slit }: { left: Element | null; right: Element | null; slit: Element | null }) {
  if (!left || !right) return at;
  tl.set([left, right], { visibility: "visible" }, 0);
  if (slit) tl.set(slit, { visibility: "visible" }, 0).fromTo(slit, { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.9, ease: "power2.inOut" }, at);
  const open = at + 1.05;
  tl.to(left, { xPercent: -100, duration: 1.6, ease: "expo.inOut" }, open).to(right, { xPercent: 100, duration: 1.6, ease: "expo.inOut" }, open);
  if (slit) tl.to(slit, { opacity: 0, scaleX: 8, duration: 0.6, ease: "power2.out" }, open + 0.05);
  tl.set([left, right, slit].filter(Boolean), { clearProps: "all" }, open + 1.7);
  return open;
}

/** A fine frame drawn edge by edge (top, right, bottom, left). */
export function drawFrame(tl: Timeline, at: number, edges: Element[], duration = 1.6) {
  const [t, r, b, l] = edges;
  const each = duration / 4;
  if (!t || !r || !b || !l) return;
  tl.from(t, { scaleX: 0, transformOrigin: "left", duration: each, ease: "none" }, at)
    .from(r, { scaleY: 0, transformOrigin: "top", duration: each, ease: "none" }, at + each)
    .from(b, { scaleX: 0, transformOrigin: "right", duration: each, ease: "none" }, at + each * 2)
    .from(l, { scaleY: 0, transformOrigin: "bottom", duration: each, ease: "power1.out" }, at + each * 3);
}

/**
 * KineticWords "equilibrium" — the point lands at the centre, the words
 * appear one by one in a centred line, then the whole message travels to its
 * resting composition (a precomputed FLIP: centred → rest).
 */
export function equilibrium(ctx: SceneContext, tl: Timeline, at: number, { message, point }: { message: HTMLElement | null; point: HTMLElement | null }) {
  if (!message) return;
  const split = new ctx.SplitText(message, { type: "words" });
  ctx.splits.push(split);
  const words = split.words as HTMLElement[];
  const rest = words.map((w) => w.getBoundingClientRect());
  const saved = message.style.cssText;
  message.style.textAlign = "center";
  message.style.left = message.style.right = "10cqw";
  const centred = words.map((w) => w.getBoundingClientRect());
  message.style.cssText = saved;
  const box = ctx.el.getBoundingClientRect();
  tl.set(words, { opacity: 0, x: (i: number) => centred[i]!.left - rest[i]!.left, y: (i: number) => centred[i]!.top - rest[i]!.top }, 0);
  if (point) {
    const p = point.getBoundingClientRect();
    tl.set(point, { x: box.left + box.width / 2 - p.left - p.width / 2, y: ctx.cq(-12), scale: 0 }, 0)
      .to(point, { scale: 1.8, duration: 0.55, ease: "back.out(3)" }, at)
      .to(point, { scale: 1, duration: 0.5, ease: "power2.out" }, at + 0.55);
  }
  tl.to(words[0] ?? [], { opacity: 1, duration: 0.9, ease: "power2.out" }, at + 0.85)
    .to(words.slice(1), { opacity: 1, duration: 0.9, stagger: 0.3, ease: "power2.out" }, at + 1.4)
    .to(words, { x: 0, y: 0, duration: 1.2, ease: "power3.inOut" }, at + 2.4);
  if (point) tl.to(point, { x: 0, y: 0, duration: 1.2, ease: "power3.inOut" }, at + 2.4);
}

/**
 * Depth under the hand: layers follow the pointer a few points, each at its
 * own depth (`data-depth`, in cqw at the edge) — light most, paper least.
 * Drives two custom properties on the world (--px, --py), which CSS turns
 * into each layer's `translate`, so it composes with scene tweens instead of
 * fighting them. Only while the pointer moves; no loop at rest.
 */
export function attachDepth(el: HTMLElement, gsap: Gsap) {
  if (!el.querySelector("[data-depth]")) return () => {};
  const px = gsap.quickTo(el, "--px", { duration: 0.9, ease: "power3.out" });
  const py = gsap.quickTo(el, "--py", { duration: 0.9, ease: "power3.out" });
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    px((e.clientX - r.left) / r.width - 0.5);
    py((e.clientY - r.top) / r.height - 0.5);
  };
  const leave = () => {
    px(0);
    py(0);
  };
  el.addEventListener("pointermove", move, { passive: true });
  el.addEventListener("pointerleave", leave);
  return () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerleave", leave);
  };
}

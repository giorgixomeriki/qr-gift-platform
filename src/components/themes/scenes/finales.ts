/**
 * The finales (lib/templates/vocabulary.ts FINALES): how each world closes
 * the greeting in the reveal's ending beat. A finale starts from the world
 * at the rest its signature scene left it in — the sender's words still on
 * the card — and ends on the finale's resting state, which is CSS
 * (theme-world.css, "Finales"; reduced motion shows it directly). The
 * template's closing line takes the world's headline slot (.tw__opening).
 */
import type { FinaleId } from "@/lib/templates/vocabulary";
import { drawFrame, inkLines, q, qa, settleIntoFinale, starrIgnition, throughLight, type SceneFn } from "./primitives";

/** Romantic — evening falls: dusk returns, the window light withdraws, the card keeps the last light while the closing words are inked. */
const eveningFalls: SceneFn = (ctx, tl) => {
  settleIntoFinale(ctx, tl, 0.3, [q(ctx, ".tw__dusk"), q(ctx, ".tw__light"), q(ctx, ".tw__leaves")], ["opacity"], { duration: 2.8 });
  const opening = q(ctx, ".tw__opening");
  if (opening?.textContent) inkLines(ctx, tl, 1.3, [opening], { stagger: 0.28, duration: 1.5 });
  tl.from(q(ctx, ".tw__mark"), { scale: 0, rotation: -60, duration: 0.9, ease: "back.out(2.4)" }, 2.9);
};

/** Birthday — paper encore: the closing words drop in, the cut paper hops once, a rosette snaps onto the card. */
const paperEncore: SceneFn = (ctx, tl) => {
  const { cq, gsap } = ctx;
  const opening = q(ctx, ".tw__opening");
  if (opening?.textContent) {
    const split = new ctx.SplitText(opening, { type: "words" });
    ctx.splits.push(split);
    tl.from(split.words, { yPercent: -120, opacity: 0, rotation: () => gsap.utils.random(-12, 12), duration: 0.7, stagger: 0.09, ease: "back.out(2.2)" }, 0.25);
  }
  tl.to(qa(ctx, ".tw__bit"), { y: () => -cq(gsap.utils.random(3, 7)), duration: 0.2, ease: "power2.out", stagger: 0.025, yoyo: true, repeat: 1 }, 0.95)
    .to(qa(ctx, ".tw__dot"), { scale: 1.3, duration: 0.18, ease: "power2.out", stagger: 0.05, yoyo: true, repeat: 1 }, 1.05)
    .fromTo(q(ctx, ".tw-finale"), { scale: 0, rotation: -160, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.75, ease: "back.out(2.4)", clearProps: "transform,opacity" }, 1.55)
    .from(q(ctx, ".tw__mark"), { scale: 0, rotation: -120, duration: 0.6, ease: "back.out(3)" }, 1.9);
};

/** Wedding — vellum close: the closing line is printed, the vellum is drawn back over the card, the seal is pressed shut. */
const vellumClose: SceneFn = (ctx, tl) => {
  const { cq } = ctx;
  const opening = q(ctx, ".tw__opening");
  if (opening?.textContent) inkLines(ctx, tl, 0.3, [opening], { stagger: 0.16, duration: 1.1 });
  const veil = q(ctx, ".tw__veil");
  const seal = q(ctx, ".tw__seal");
  if (veil) tl.fromTo(veil, { y: cq(-140), scale: 1.05 }, { y: 0, scale: 1, duration: 1.9, ease: "qs-hand", clearProps: "transform" }, 1.5);
  if (seal) {
    tl.fromTo(seal, { scale: 1.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "power2.out" }, 3.2)
      .to(seal, { scale: 0.88, duration: 0.18, ease: "power2.in" }, 3.75)
      .to(seal, { scale: 1, duration: 0.5, ease: "back.out(3)", clearProps: "transform,opacity" }, 3.93);
  }
};

/** Celebration — afterglow: three small Starrs ignite in turn, then the Starr; the rays redraw; the closing words come through the light; a glow remains. */
const afterglow: SceneFn = (ctx, tl) => {
  const { cq } = ctx;
  [q(ctx, ".tw__spark--c"), q(ctx, ".tw__spark--b"), q(ctx, ".tw__spark--a")].forEach((spark, i) => {
    if (!spark) return;
    const at = 0.25 + i * 0.3;
    tl.to(spark, { scale: 2.3, rotation: 90, duration: 0.22, ease: "power3.out" }, at).to(spark, { scale: 1, rotation: 0, duration: 0.7, ease: "back.out(2.2)" }, at + 0.22);
  });
  const ignite = starrIgnition(ctx, tl, 0.9, { starr: q(ctx, ".tw__focus"), flash: null });
  settleIntoFinale(ctx, tl, ignite, [q(ctx, ".tw__flash")], ["opacity"], { duration: 1.4, ease: "power2.out" });
  tl.fromTo(qa(ctx, ".tw__ray"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.8, stagger: 0.014, ease: "power3.out" }, ignite + 0.05);
  const card = q(ctx, ".tw__card");
  if (card) tl.to(card, { y: -cq(1.6), duration: 0.32, ease: "power2.out", yoyo: true, repeat: 1 }, ignite + 0.1);
  const opening = q(ctx, ".tw__opening");
  if (opening?.textContent) throughLight(ctx, tl, ignite + 0.45, opening);
};

/** Elegant — gallery doors: the graphite doors glide in and stop at the card's edges; the closing words are set; the frame is drawn. */
const galleryDoors: SceneFn = (ctx, tl) => {
  const { cq } = ctx;
  const left = q(ctx, ".tw__shutter--l");
  const right = q(ctx, ".tw__shutter--r");
  // From fully open (off the page) to the card's edges — the same stops as the
  // CSS resting state (which GSAP folds into its own transform while it runs,
  // so the positions are given explicitly and kept).
  if (left) tl.fromTo(left, { x: cq(-50.5) }, { x: cq(-20.5), duration: 2.2, ease: "expo.inOut" }, 0.3);
  if (right) tl.fromTo(right, { x: cq(50.5) }, { x: cq(40.5), duration: 2.2, ease: "expo.inOut" }, 0.3);
  const opening = q(ctx, ".tw__opening");
  if (opening?.textContent) inkLines(ctx, tl, 1.7, [opening], { stagger: 0.12, duration: 1.1 });
  drawFrame(tl, 2.1, qa(ctx, ".tw__frame i"), 1.3);
};

/** Minimal — full stop: the label and the rule withdraw; the point travels to the end of the message and becomes its full stop. */
const fullStop: SceneFn = (ctx, tl) => {
  settleIntoFinale(ctx, tl, 0.2, [q(ctx, ".tw__hairline"), q(ctx, ".tw__opening")], ["opacity"], { duration: 1 });
  const point = q(ctx, ".tw__point");
  const message = q(ctx, ".tw__message");
  if (!point || !message) return;
  // The last line of the message that is visible on the card (a long one is clamped).
  const range = document.createRange();
  range.selectNodeContents(message);
  const bottom = message.getBoundingClientRect().bottom + 1;
  // By each line's midpoint: tight display leading lets glyph boxes reach past the element.
  const lines = [...range.getClientRects()].filter((r) => r.width > 0 && (r.top + r.bottom) / 2 <= bottom);
  const last = lines[lines.length - 1];
  if (!last) return;
  const p = point.getBoundingClientRect();
  let x: number;
  let y: number;
  if (ctx.el.dataset.overflow !== undefined) {
    // The card holds only the beginning of a long letter: the point closes the card beneath it, at the margin.
    x = message.getBoundingClientRect().left - p.left;
    y = last.bottom + last.height * 0.6 - p.height / 2 - p.top;
  } else {
    x = last.right + p.width * 0.9 - p.left;
    y = last.top + last.height * 0.72 - p.height / 2 - p.top;
  }
  tl.to(point, { x, y: y - ctx.cq(4), duration: 0.9, ease: "power2.inOut" }, 1.0)
    .to(point, { y, duration: 0.45, ease: "back.out(2)" }, 1.9)
    .fromTo(point, { scale: 1 }, { scale: 1.6, duration: 0.14, ease: "power2.out", yoyo: true, repeat: 1 }, 2.0);
};

export const FINALE_SCENES: Record<FinaleId, SceneFn> = {
  "evening-falls": eveningFalls,
  "paper-encore": paperEncore,
  "vellum-close": vellumClose,
  afterglow,
  "gallery-doors": galleryDoors,
  "full-stop": fullStop,
};

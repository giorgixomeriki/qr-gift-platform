/**
 * The signature scenes of the six launch compositions (docs/design/QR-STARR-MOTION-LANGUAGE.md). Each is a
 * miniature story — arrival, anticipation, reveal, peak, rest — composed
 * from the primitives, ending exactly on the world's CSS rest state.
 * Chosen from 18 directions (docs/visual-walkthrough/theme-picker-immersive/README.md).
 */
import type { CompositionId } from "@/lib/templates/vocabulary";
import {
  drawFrame,
  editorialShutters,
  equilibrium,
  grow,
  hold,
  inkLines,
  paperBurst,
  playFilm,
  q,
  qa,
  sheen,
  starrIgnition,
  themeLight,
  throughLight,
  vellumReveal,
  type SceneContext,
} from "./primitives";
import type { Gsap } from "./runtime";

type Timeline = ReturnType<Gsap["timeline"]>;

/** Romantic — "Leaves at the window": dusk; window light and real leaf shadows enter; the honeysuckle grows; the card is set down; the words are inked. */
function romantic(ctx: SceneContext, tl: Timeline) {
  const { cq } = ctx;
  hold(tl, 0.35);
  themeLight(ctx, tl, 0.35, { dusk: q(ctx, ".tw__dusk"), light: q(ctx, ".tw__light") });
  playFilm(ctx, tl, 0.6, q<HTMLVideoElement>(ctx, ".tw__leaves-film"), { fadeTo: 0.55, fadeFor: 1.6 });
  grow(tl, 1.0, q(ctx, ".tw__engraving"), "bottom", 2);
  tl.from(q(ctx, ".tw__opening"), { opacity: 0, y: cq(2), duration: 1.2, ease: "power2.out" }, 1.4)
    .from(q(ctx, ".tw__card"), { opacity: 0, y: cq(10), rotation: -4.5, duration: 1.4, ease: "qs-settle" }, 1.8)
    .from(q(ctx, ".tw__vellum"), { opacity: 0, y: cq(6), duration: 1, ease: "power2.out" }, 2.5);
  inkLines(ctx, tl, 2.6, [q(ctx, ".tw__message")!], { stagger: 0.22 });
  tl.from(q(ctx, ".tw__mark"), { scale: 0, rotation: -90, duration: 0.8, ease: "back.out(3)" }, 3.6);
}

/** Wedding — "The vellum ritual": sealed vellum; the seal is pressed; the sheet is drawn away; the olive appears; light passes over the letterpress; the words; the band. */
function wedding(ctx: SceneContext, tl: Timeline) {
  const { cq } = ctx;
  const drawn = vellumReveal(ctx, tl, 0.3, { sheet: q(ctx, ".tw__veil"), seal: q(ctx, ".tw__seal") });
  grow(tl, drawn + 0.6, q(ctx, ".tw__engraving"), "right", 1.8);
  sheen(tl, drawn + 1.0, q(ctx, ".tw__sheen"), ctx.el.clientWidth);
  inkLines(ctx, tl, drawn + 1.1, [q(ctx, ".tw__opening")!, q(ctx, ".tw__message")!], { stagger: 0.16, duration: 1 });
  tl.from(q(ctx, ".tw__mark"), { scale: 0, duration: 0.6, ease: "back.out(3)" }, drawn + 1.6).from(
    q(ctx, ".tw__vellum"),
    { opacity: 0, y: cq(-6), duration: 0.9, ease: "power2.out" },
    drawn + 2.2,
  );
}

/** Birthday — "Paper party": a quiet stage; the pieces arrive; the words drop in; the card is tossed; a burst of cut paper lands in place. */
function birthday(ctx: SceneContext, tl: Timeline) {
  const { cq, gsap } = ctx;
  const split = new ctx.SplitText(q(ctx, ".tw__opening")!, { type: "words" });
  ctx.splits.push(split);
  hold(tl, 0.25);
  tl.from(q(ctx, ".tw__disc"), { x: cq(40), y: cq(-10), scale: 0.4, opacity: 0, duration: 0.8, ease: "back.out(1.6)" }, 0.25)
    .from(q(ctx, ".tw__arc"), { x: cq(-20), y: cq(20), rotation: -50, opacity: 0, duration: 0.8, ease: "back.out(1.4)" }, 0.4)
    .fromTo(q(ctx, ".tw__streamer"), { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.5, ease: "power2.out", clearProps: "clipPath" }, 0.55)
    .from(split.words, { yPercent: -120, opacity: 0, rotation: () => gsap.utils.random(-12, 12), duration: 0.7, stagger: 0.09, ease: "back.out(2.2)" }, 0.75)
    .from(q(ctx, ".tw__card"), { x: cq(14), y: cq(-50), rotation: 19, opacity: 0, duration: 0.75, ease: "back.out(1.7)" }, 1.25);
  paperBurst(ctx, tl, 1.85, qa(ctx, ".tw__bit"), { x: 66, y: 96 });
  tl.from(qa(ctx, ".tw__dot"), { scale: 0, duration: 0.5, stagger: 0.06, ease: "back.out(3)" }, 2.4).from(
    q(ctx, ".tw__mark"),
    { scale: 0, rotation: -120, duration: 0.6, ease: "back.out(3)" },
    2.6,
  );
}

/** Celebration — "Night of the Starr": darkness; the sky appears; a tiny Starr; ignition; rays travel; a streak of light; the words appear through the light; sparks; stillness. */
function celebration(ctx: SceneContext, tl: Timeline) {
  const { cq } = ctx;
  tl.from(q(ctx, ".tw__sky"), { opacity: 0, duration: 2.2, ease: "power1.inOut" }, 0.2);
  playFilm(ctx, tl, 0.2, q<HTMLVideoElement>(ctx, ".tw__sky-film"), { fadeTo: 1, fadeFor: 2.2 });
  const ignite = starrIgnition(ctx, tl, 0.8, { starr: q(ctx, ".tw__focus"), flash: q(ctx, ".tw__flash") });
  tl.fromTo(qa(ctx, ".tw__ray"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.9, stagger: 0.018, ease: "power3.out" }, ignite + 0.05);
  const streak = q(ctx, ".tw__streak");
  if (streak) tl.fromTo(streak, { opacity: 1, x: 0, y: 0 }, { x: cq(70), y: cq(-108), opacity: 0, duration: 0.9, ease: "power2.in" }, ignite + 0.25);
  throughLight(ctx, tl, ignite + 0.5, q(ctx, ".tw__opening"));
  tl.from(q(ctx, ".tw__card"), { opacity: 0, y: cq(26), rotation: 9, duration: 1, ease: "back.out(1.3)" }, ignite + 0.95).from(
    qa(ctx, ".tw__spark"),
    { opacity: 0, scale: 0, duration: 0.6, stagger: 0.12, ease: "back.out(3)" },
    ignite + 1.35,
  );
}

/** Elegant — "Shutters": two graphite panels hold the world closed; a slit of light; they part; the card is revealed; the rule, the words, the frame. */
function elegant(ctx: SceneContext, tl: Timeline) {
  const open = editorialShutters(tl, 0.4, { left: q(ctx, ".tw__shutter--l"), right: q(ctx, ".tw__shutter--r"), slit: q(ctx, ".tw__slit") });
  tl.from(q(ctx, ".tw__card"), { scale: 1.04, duration: 2, ease: "power3.out" }, open + 0.15).from(
    q(ctx, ".tw__rule"),
    { scaleY: 0, transformOrigin: "top", duration: 1, ease: "power2.inOut" },
    open + 0.75,
  );
  inkLines(ctx, tl, open + 1.15, [q(ctx, ".tw__opening")!, q(ctx, ".tw__message")!], { stagger: 0.12 });
  drawFrame(tl, open + 1.45, qa(ctx, ".tw__frame i"));
  tl.from(q(ctx, ".tw__mark"), { opacity: 0, duration: 0.8 }, open + 2.6);
}

/** Minimal — "Equilibrium": one point; one word; the next; the layout finds its balance; the opening line is inked last. */
function minimal(ctx: SceneContext, tl: Timeline) {
  equilibrium(ctx, tl, 0.4, { message: q(ctx, ".tw__message"), point: q(ctx, ".tw__point") });
  tl.from(q(ctx, ".tw__opening"), { opacity: 0, duration: 0.9 }, 3.6).from(q(ctx, ".tw__hairline"), { scaleX: 0, transformOrigin: "left", duration: 1.1, ease: "power2.inOut" }, 3.3);
}

/** One signature scene per authored composition — every template set in a composition shares its story. */
export const SCENES: Record<CompositionId, (ctx: SceneContext, tl: Timeline) => void> = {
  "quiet-light": romantic,
  vellum: wedding,
  "paper-party": birthday,
  signal: celebration,
  "ink-and-stone": elegant,
  "just-words": minimal,
};

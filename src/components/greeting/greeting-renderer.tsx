"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spark } from "@/components/ui/logo";
import { themeVars, type ThemeConfig } from "@/lib/themes/registry";
import { Envelope } from "./envelope";
import { Particles } from "./particles";
import { VoicePlayer } from "./voice-player";

export type GreetingRenderContent = {
  message: string | null;
  photos: { id: string; url: string }[];
  video: { url: string } | null;
  audio: { url: string } | null;
};

type Beat =
  | { kind: "opening" }
  | { kind: "message" }
  | { kind: "photo"; index: number }
  | { kind: "video" }
  | { kind: "audio" }
  | { kind: "ending" };

/** How long each entrance choreography runs before the first content beat appears (see globals.css). */
const OPENING_MS: Record<ThemeConfig["entrance"], number> = {
  envelope: 1700,
  balloons: 900,
  fade: 850,
};
const REVEAL: Record<ThemeConfig["entrance"], string> = { envelope: "envelope", balloons: "burst", fade: "fade" };

const ACCENT_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-accent)]";

/**
 * The single renderer both Preview (Phase 2) and the Recipient Experience
 * (Phase 3) use — see architecture note in Phase 2 plan §10/§11. Never fork
 * this into a "simplified preview" version: `mode` only changes what chrome
 * surrounds it (sender controls vs nothing), never the actual
 * opening/reveal/content/ending sequence a recipient will see.
 *
 * Paced as a sequence of full-screen "beats" (sealed envelope → message →
 * each photo → video → voice → ending), so on a phone each moment gets the
 * whole screen and the recipient controls the pace.
 *
 * Content is passed in fully resolved (signed URLs already generated
 * server-side) — this component does no data fetching or authorization of
 * its own. Theme copy (opening/ending line) is localized here via next-intl,
 * keyed by theme.key — see messages/{locale}.json's `themes` namespace.
 */
export function GreetingRenderer({
  theme,
  content,
  mode,
  senderControls,
  senderBanner,
  chrome,
  embedded = false,
  onBeatChange,
  onContentPlayed,
}: {
  theme: ThemeConfig;
  content: GreetingRenderContent;
  mode: "preview" | "recipient";
  /** Ending-beat-only, Preview mode only — the Activate CTA and its controls. */
  senderControls?: React.ReactNode;
  /**
   * Persistent top banner shown regardless of beat, independent of `mode` —
   * used for the post-activation "this is your own gift" success banner in
   * recipient mode (Phase 3 §8), never for a genuine recipient.
   */
  senderBanner?: React.ReactNode;
  /** Floating top-left control shown on every beat. */
  chrome?: React.ReactNode;
  /** Fill a parent flex container instead of the whole viewport (used inside the Preview layer). */
  embedded?: boolean;
  /** Notified whenever the visible beat changes (Preview uses it to decide which action leads). */
  onBeatChange?: (kind: Beat["kind"]) => void;
  /** Fired at most once per beat visit when the recipient actually plays video/audio (Phase 3 §14). */
  onContentPlayed?: (type: "video" | "audio") => void;
}) {
  const t = useTranslations("greeting");
  const tt = useTranslations("themes");

  const beats = useMemo<Beat[]>(() => {
    const list: Beat[] = [{ kind: "opening" }];
    if (content.message) list.push({ kind: "message" });
    content.photos.forEach((_, index) => list.push({ kind: "photo", index }));
    if (content.video) list.push({ kind: "video" });
    if (content.audio) list.push({ kind: "audio" });
    list.push({ kind: "ending" });
    return list;
  }, [content]);

  const [beatIndex, setBeatIndex] = useState(0);
  const [opening, setOpening] = useState(false);
  const [runId, setRunId] = useState(0);
  const beat = beats[beatIndex] ?? beats[0]!;
  const playedRef = useRef<Set<string>>(new Set());
  const stageRef = useRef<HTMLDivElement>(null);

  function advance() {
    setBeatIndex((i) => Math.min(i + 1, beats.length - 1));
  }
  function goBack() {
    setBeatIndex((i) => Math.max(1, i - 1));
  }
  function open() {
    if (opening) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setOpening(true);
    window.setTimeout(
      () => {
        setOpening(false);
        setRunId((n) => n + 1);
        advance();
      },
      reduce ? 50 : OPENING_MS[theme.entrance],
    );
  }
  function restart() {
    playedRef.current = new Set();
    setBeatIndex(0);
  }
  function notifyPlayed(type: "video" | "audio") {
    const key = `${type}-${beatIndex}`;
    if (playedRef.current.has(key)) return;
    playedRef.current.add(key);
    onContentPlayed?.(type);
  }

  useEffect(() => {
    onBeatChange?.(beat.kind);
  }, [beat.kind, onBeatChange]);

  // Move focus to each new beat so keyboard and screen-reader users follow the story.
  useEffect(() => {
    if (beatIndex > 0) stageRef.current?.focus({ preventScroll: true });
  }, [beatIndex]);

  const isOpening = beat.kind === "opening";
  const isEnding = beat.kind === "ending";
  const endingLine = tt(`${theme.key}.ending`);
  const contentBeats = beats.length - 1; // everything after the opening

  return (
    <div
      className={`gift relative isolate flex w-full flex-col overflow-hidden ${embedded ? "min-h-0 flex-1" : "min-h-dvh"}`}
      style={themeVars(theme)}
      data-testid="greeting-renderer"
      data-mode={mode}
      data-beat={beat.kind}
      data-stage={isOpening ? (opening ? "opening" : "closed") : "open"}
      data-reveal={REVEAL[theme.entrance]}
    >
      {!isOpening && theme.particle !== "none" && (
        <Particles
          key={`drift-${runId}`}
          kind={theme.particle}
          colors={theme.palette.particleColors}
          mode="drift"
          count={theme.particle === "confetti" ? 16 : 12}
          seed={runId + 3}
        />
      )}

      <header className="relative z-20 flex flex-col gap-3 px-4 pt-[max(0.875rem,var(--safe-top))]">
        <div className="flex min-h-9 items-center gap-3">
          {chrome}
          {!isOpening && (
            <div className="flex flex-1 gap-1" role="presentation">
              {Array.from({ length: contentBeats }, (_, i) => (
                <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--g-ink)_18%,transparent)]">
                  <span
                    className="block h-full rounded-full bg-[var(--g-ink)] transition-transform duration-500 ease-out"
                    style={{ transform: `scaleX(${i < beatIndex ? 1 : 0})`, transformOrigin: "left" }}
                  />
                </span>
              ))}
            </div>
          )}
        </div>
        {senderBanner && (
          <div className="flex justify-center" data-testid="sender-banner">
            {senderBanner}
          </div>
        )}
      </header>

      <div
        ref={stageRef}
        tabIndex={-1}
        className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-6 outline-none"
      >
        {isOpening && (
          <OpeningBeat
            openingLine={tt(`${theme.key}.opening`)}
            tapToOpen={t("tapToOpen")}
            openLabel={t("open")}
            onOpen={open}
            disabled={opening}
          />
        )}

        {beat.kind === "message" && content.message && <MessageBeat key="message" text={content.message} />}

        {beat.kind === "photo" && content.photos[beat.index] && (
          <PhotoBeat
            key={`photo-${beat.index}`}
            url={content.photos[beat.index]!.url}
            tilt={beat.index % 2 === 0 ? -1.5 : 1.5}
            alt={t("photoAlt", { n: beat.index + 1, total: content.photos.length })}
          />
        )}

        {beat.kind === "video" && content.video && (
          <div key="video" className="animate-rise w-full" data-testid="greeting-video-beat">
            <video
              src={`${content.video.url}#t=0.1`}
              controls
              preload="metadata"
              playsInline
              onPlay={() => notifyPlayed("video")}
              aria-label={t("videoLabel")}
              className="max-h-[62dvh] w-full rounded-[var(--radius-lg)] bg-black shadow-lg ring-1 ring-[var(--g-line)]"
            />
          </div>
        )}

        {beat.kind === "audio" && content.audio && (
          <div key="audio" className="animate-rise flex w-full flex-col items-center gap-8 text-center" data-testid="greeting-audio-beat">
            <p className="font-serif text-[clamp(1.75rem,1.3rem+2vw,2.25rem)] leading-tight">{t("listen")}</p>
            <div className="w-full text-left">
              <VoicePlayer src={content.audio.url} durationMs={null} title={t("voiceTitle")} onPlay={() => notifyPlayed("audio")} />
            </div>
          </div>
        )}

        {isEnding && (
          <div key={`ending-${runId}`} className="animate-rise flex w-full flex-col items-center gap-8 text-center" data-testid="greeting-ending-beat">
            <Spark className="animate-pop size-10 text-[var(--g-accent)]" />
            {endingLine && <p className="font-serif text-[clamp(2rem,1.4rem+3vw,3rem)] leading-[1.08] [text-wrap:balance]">{endingLine}</p>}
            <button
              type="button"
              onClick={restart}
              className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-label text-[var(--g-ink)] ring-1 ring-[var(--g-line)] transition-colors hover:bg-[var(--g-card)] ${ACCENT_FOCUS}`}
              data-testid="greeting-replay"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t("replay")}
            </button>
            {mode === "preview" && senderControls}
          </div>
        )}
      </div>

      <footer className="relative z-20 px-6 pt-2 pb-[max(1.25rem,calc(var(--safe-bottom)+0.75rem))]">
        {!isOpening && !isEnding && (
          <div className="mx-auto flex max-w-sm items-center gap-3">
            {beatIndex > 1 && (
              <button
                type="button"
                onClick={goBack}
                aria-label={t("previous")}
                className={`grid size-13 shrink-0 place-items-center rounded-md text-[var(--g-ink)] ring-1 ring-[var(--g-line)] transition-colors hover:bg-[var(--g-card)] ${ACCENT_FOCUS}`}
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={advance}
              className={`h-13 flex-1 rounded-md bg-[var(--g-accent)] px-6 text-base font-medium text-[var(--g-on-accent)] shadow-md transition-transform active:scale-[0.98] ${ACCENT_FOCUS}`}
              data-testid="greeting-continue"
            >
              {t("continue")}
            </button>
          </div>
        )}
        {isEnding && mode === "recipient" && (
          <p className="flex items-center justify-center gap-1.5 text-caption text-[var(--g-ink-soft)]">
            <Spark className="size-3 text-[var(--g-accent)]" />
            {t("madeWith")}
          </p>
        )}
      </footer>

      {opening && theme.entrance === "balloons" && (
        <Particles kind={theme.particle === "none" ? "confetti" : theme.particle} colors={theme.palette.particleColors} mode="burst" count={46} />
      )}
    </div>
  );
}

function OpeningBeat({
  openingLine,
  tapToOpen,
  openLabel,
  onOpen,
  disabled,
}: {
  openingLine: string;
  tapToOpen: string;
  openLabel: string;
  onOpen: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-between gap-8 text-center">
      <p className="gift-closed-ui animate-fade max-w-xs pt-4 font-serif text-[clamp(1.5rem,1.2rem+1.6vw,2rem)] leading-tight [text-wrap:balance]">
        {openingLine}
      </p>
      {/* The envelope is a large pointer target; the labelled button below is the accessible control. */}
      <button type="button" onClick={onOpen} disabled={disabled} tabIndex={-1} aria-hidden className="animate-rise [animation-delay:120ms]">
        <div className="envelope-float">
          <Envelope />
        </div>
      </button>
      <div className="gift-closed-ui animate-rise flex w-full max-w-xs flex-col items-center gap-3 [animation-delay:240ms]">
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled}
          className={`h-13 w-full rounded-md bg-[var(--g-accent)] px-6 text-base font-medium text-[var(--g-on-accent)] shadow-md transition-transform active:scale-[0.98] ${ACCENT_FOCUS}`}
          data-testid="greeting-tap-to-open"
        >
          {openLabel}
        </button>
        <p className="text-caption text-[var(--g-ink-soft)]">{tapToOpen}</p>
      </div>
    </div>
  );
}

function MessageBeat({ text }: { text: string }) {
  // Short notes read as a centred statement; anything longer reads as a letter.
  const long = text.length > 100 || text.includes("\n");
  return (
    <div className="flex w-full justify-center" data-testid="greeting-message-beat">
      {/* The message is presented on the card itself — the same paper the envelope held. */}
      <article className="paper-card card-arrive flex max-h-[68dvh] min-h-[min(52dvh,28rem)] w-full max-w-[26rem] flex-col items-center overflow-y-auto px-8 pt-10 pb-10 sm:px-10">
        <Spark className="size-5 shrink-0 text-[var(--g-seal)]" />
        <p
          className={`mt-6 w-full font-serif whitespace-pre-wrap text-[var(--g-paper-ink)] [text-wrap:pretty] ${
            long
              ? "my-auto text-left text-[clamp(1.125rem,1rem+0.5vw,1.3125rem)] leading-[1.62]"
              : "my-auto text-center text-[clamp(1.5rem,1.2rem+1.4vw,2rem)] leading-[1.32]"
          }`}
        >
          {text}
        </p>
      </article>
    </div>
  );
}

function PhotoBeat({ url, tilt, alt }: { url: string; tilt: number; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="animate-rise flex w-full justify-center" data-testid="greeting-photo-beat">
      <figure className="relative rounded-[6px] bg-[#fffdf9] p-2.5 pb-10 shadow-lg" style={{ transform: `rotate(${tilt}deg)` }}>
        {!loaded && <div className="skeleton absolute inset-2.5 bottom-10 rounded-[3px]" aria-hidden />}
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not eligible for next/image's remote optimizer allowlist */}
        <img
          src={url}
          alt={alt}
          onLoad={() => setLoaded(true)}
          className={`block max-h-[58dvh] max-w-full rounded-[3px] object-contain transition-opacity duration-500 ${
            loaded ? "opacity-100" : "min-h-64 min-w-56 opacity-0"
          }`}
        />
      </figure>
    </div>
  );
}

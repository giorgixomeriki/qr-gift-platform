"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { preload } from "react-dom";
import { ChevronLeft, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { prefetchMotion } from "@/components/themes/scenes/runtime";
import { ThemeWorld } from "@/components/themes/theme-world";
import { Spark, SPARK_PATH } from "@/components/ui/logo";
import { DEFAULT_TEMPLATE_ID, getTemplate, restAssets } from "@/lib/templates/catalog";
import { roomVars } from "@/lib/templates/room";
import { COMPOSITIONS } from "@/lib/templates/vocabulary";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";
import { VoicePlayer } from "./voice-player";
import "./reveal.css";

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

/** The seal gives under the finger before the world opens. */
const SEAL_PRESS_MS = 180;
/** If a scene never reports rest (a stalled runtime), the letter still arrives this long after the scene should have ended. */
const REST_GRACE_MS = 1800;

/**
 * The single renderer both Preview and the Recipient Experience use. Never
 * fork it into a "simplified preview": `mode` only changes the chrome around
 * it, never what the recipient sees.
 *
 * The greeting is told inside the template's **world** — the same authored
 * composition the sender chose on Screen #2 (components/themes/), in its own
 * room — so what is picked is what is received:
 *
 * - **Opening:** the world, sealed (its ground, the template's opening line,
 *   a seal in the world's accent). Opening it plays the world's signature
 *   scene with the sender's own message on the card.
 * - **Message:** a message that fits the card is read there. A longer one
 *   (up to 600 characters) keeps its beginning on the card, and once the
 *   scene comes to rest the whole letter rises in the world's paper, ink and
 *   type.
 * - **Photos, video, voice:** one beat each, framed as the composition
 *   frames media (`mediaFrame`: vellum mount, cut-paper slip, deckle mount,
 *   full bleed, inset hairline, plain).
 * - **Ending:** the world returns, the sender's words still on its card, and
 *   closes with its own **finale** (the template's `finale`: evening falls,
 *   paper encore, vellum close, afterglow, gallery doors, full stop), the
 *   template's closing line set in the world's headline. Then replay.
 *
 * Paced as full-screen beats so on a phone each moment has the whole screen
 * and the recipient sets the pace; the world is decorative (aria-hidden), so
 * every word in it is also present as real text. Reduced motion: no scenes,
 * worlds and letters fade in at rest. Content arrives fully resolved (signed
 * URLs generated server-side); this component fetches and authorizes nothing.
 */
export function GreetingRenderer({
  themeKey,
  themeVersion,
  content,
  mode,
  senderControls,
  senderBanner,
  chrome,
  embedded = false,
  onBeatChange,
  onContentPlayed,
}: {
  themeKey: string;
  /** The exact template version to render (a sent greeting's frozen version); latest when omitted. */
  themeVersion?: number;
  content: GreetingRenderContent;
  mode: "preview" | "recipient";
  /** Ending-beat-only, Preview mode only — the Activate CTA and its controls. */
  senderControls?: React.ReactNode;
  /**
   * Persistent top banner shown regardless of beat, independent of `mode` —
   * used for the post-activation "this is your own gift" success banner in
   * recipient mode, never for a genuine recipient.
   */
  senderBanner?: React.ReactNode;
  /** Floating top-left control shown on every beat. */
  chrome?: React.ReactNode;
  /** Fill a parent flex container instead of the whole viewport (used inside the Preview layer). */
  embedded?: boolean;
  /** Notified whenever the visible beat changes (Preview uses it to decide which action leads). */
  onBeatChange?: (kind: Beat["kind"]) => void;
  /** Fired at most once per beat visit when the recipient actually plays video/audio. */
  onContentPlayed?: (type: "video" | "audio") => void;
}) {
  const t = useTranslations("greeting");
  const tt = useTranslations("themes");
  const locale = useLocale();
  const template = (themeVersion !== undefined && getTemplate(themeKey, themeVersion)) || getTemplate(themeKey) || getTemplate(DEFAULT_TEMPLATE_ID)!;
  const world = getThemeWorld(template.id, template.version);
  const composition = COMPOSITIONS[world.composition];

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
  const [pressing, setPressing] = useState(false);
  /** Bumped each time the greeting is opened, so the world's scene plays again on replay. */
  const [runId, setRunId] = useState(0);
  /** The message does not fit the card: it is presented as a letter once the world is at rest. */
  const [long, setLong] = useState(false);
  const [atRest, setAtRest] = useState(false);
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
    if (pressing) return;
    setPressing(true);
    window.setTimeout(() => {
      setPressing(false);
      setAtRest(false);
      setRunId((n) => n + 1);
      advance();
    }, SEAL_PRESS_MS);
  }
  function restart() {
    playedRef.current = new Set();
    setAtRest(false);
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

  // While the world is sealed, fetch the scene runtime so opening it starts at once.
  useEffect(() => prefetchMotion(), []);

  // Safety: the letter must arrive even if a scene never reports rest.
  const onMessage = beat.kind === "message";
  useEffect(() => {
    if (!onMessage || atRest) return;
    const timer = window.setTimeout(() => setAtRest(true), composition.sceneMs + REST_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [onMessage, atRest, runId, composition.sceneMs]);

  // The world's rest-state assets and typefaces, asked for up front (its largest paint).
  for (const { asset, high } of restAssets(template)) {
    preload(asset.href, { as: "image", type: asset.type, ...(high && { fetchPriority: "high" }), ...("crossOrigin" in asset && { crossOrigin: "anonymous" }) });
  }
  preload(world.fontFiles.latin, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  if (locale === "ka") preload(world.fontFiles.georgian, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });

  const isOpening = beat.kind === "opening";
  const isEnding = beat.kind === "ending";
  const openingLine = tt(`${template.id}.opening`);
  const endingLine = tt(`${template.id}.ending`);
  const contentBeats = beats.length - 1; // everything after the opening

  return (
    <div
      className={`reveal relative isolate flex w-full flex-col overflow-hidden ${embedded ? "min-h-0 flex-1" : "h-dvh"}`}
      style={{ ...worldVars(world), ...roomVars(template.spec.room) } as CSSProperties}
      data-testid="greeting-renderer"
      data-mode={mode}
      data-beat={beat.kind}
      data-stage={isOpening ? (pressing ? "opening" : "closed") : "open"}
      data-room={template.spec.room.dark ? "dark" : "light"}
      data-composition={world.composition}
    >
      <header className="relative z-20 flex flex-col gap-3 px-4 pt-[max(0.875rem,var(--safe-top))]">
        <div className="flex min-h-9 items-center gap-3">
          {chrome}
          {!isOpening && (
            <div className="flex flex-1 gap-1" role="presentation">
              {Array.from({ length: contentBeats }, (_, i) => (
                <span key={i} className="reveal__progress">
                  <span style={{ transform: `scaleX(${i < beatIndex ? 1 : 0})` }} />
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

      <div ref={stageRef} tabIndex={-1} className="reveal__stage relative z-10 flex flex-1 flex-col items-center justify-center outline-none">
        {isOpening && (
          <div className="reveal__frame">
            <ThemeWorld key="sealed" themeKey={template.id} version={template.version} opening={openingLine} message={content.message ?? ""} sealed className="reveal__world" />
            {/* The world's closed state: its opening line and a seal in its accent. The seal is a
                large pointer target; the labelled Open button below is the accessible control. */}
            <div className="reveal__cover">
              <p className="reveal__opening">{openingLine}</p>
              <button type="button" className="reveal__seal" onClick={open} disabled={pressing} tabIndex={-1} aria-hidden data-pressed={pressing || undefined}>
                <svg viewBox="0 0 24 24">
                  <path d={SPARK_PATH} />
                </svg>
              </button>
            </div>
          </div>
        )}

        {beat.kind === "message" && content.message && (
          <div key={`message-${runId}`} className="reveal__frame" data-testid="greeting-message-beat" data-reading={(long && atRest) || undefined}>
            <ThemeWorld
              themeKey={template.id}
              version={template.version}
              opening={openingLine}
              message={content.message}
              active
              onFit={(fits) => setLong(!fits)}
              onRest={() => setAtRest(true)}
              className="reveal__world"
            />
            {long ? (
              atRest && (
                <article className="reveal__letter" tabIndex={0} aria-label={t("letterLabel")} data-testid="greeting-letter">
                  <Spark className="reveal__letter-mark" />
                  <p>{content.message}</p>
                </article>
              )
            ) : (
              <p className="sr-only">{content.message}</p>
            )}
          </div>
        )}

        {beat.kind === "photo" && content.photos[beat.index] && (
          <MediaFrame key={`photo-${beat.index}`} frame={world.mediaFrame} index={beat.index} testId="greeting-photo-beat">
            <Photo url={content.photos[beat.index]!.url} alt={t("photoAlt", { n: beat.index + 1, total: content.photos.length })} />
          </MediaFrame>
        )}

        {beat.kind === "video" && content.video && (
          <MediaFrame key="video" frame={world.mediaFrame} index={0} testId="greeting-video-beat" still>
            <video
              src={`${content.video.url}#t=0.1`}
              controls
              preload="metadata"
              playsInline
              onPlay={() => notifyPlayed("video")}
              aria-label={t("videoLabel")}
              className="reveal__video"
            />
          </MediaFrame>
        )}

        {beat.kind === "audio" && content.audio && (
          <div key="audio" className="reveal__audio reveal-enter" data-testid="greeting-audio-beat">
            <p className="reveal__line">{t("listen")}</p>
            <div className="reveal__audio-card">
              <VoicePlayer src={content.audio.url} durationMs={null} title={t("voiceTitle")} onPlay={() => notifyPlayed("audio")} />
            </div>
          </div>
        )}

        {isEnding && (
          <div key={`ending-${runId}`} className="reveal__frame" data-testid="greeting-ending-beat" data-finale={template.spec.finale}>
            <ThemeWorld
              themeKey={template.id}
              version={template.version}
              opening={endingLine}
              message={content.message ?? ""}
              finale={template.spec.finale}
              active
              fit
              className="reveal__world"
            />
            {endingLine && <p className="sr-only">{endingLine}</p>}
          </div>
        )}
      </div>

      <footer className="relative z-20 px-6 pt-2 pb-[max(1.25rem,calc(var(--safe-bottom)+0.75rem))]">
        {isOpening && (
          <div className="mx-auto flex max-w-xs flex-col items-center gap-3">
            <button type="button" onClick={open} disabled={pressing} className="reveal__primary w-full" data-testid="greeting-tap-to-open">
              {t("open")}
            </button>
            <p className="reveal__hint">{t("tapToOpen")}</p>
          </div>
        )}
        {!isOpening && !isEnding && (
          <div className="mx-auto flex max-w-sm items-center gap-3">
            {beatIndex > 1 && (
              <button type="button" onClick={goBack} aria-label={t("previous")} className="reveal__ghost reveal__ghost--square">
                <ChevronLeft className="size-5" aria-hidden />
              </button>
            )}
            <button type="button" onClick={advance} className="reveal__primary flex-1" data-testid="greeting-continue">
              {t("continue")}
            </button>
          </div>
        )}
        {isEnding && (
          <div className="reveal-enter mx-auto flex max-w-sm flex-col items-center gap-3">
            <button type="button" onClick={restart} className="reveal__ghost" data-testid="greeting-replay">
              <RotateCcw className="size-4" aria-hidden />
              {t("replay")}
            </button>
            {mode === "preview" && senderControls}
            {mode === "recipient" && (
              <p className="reveal__hint flex items-center justify-center gap-1.5">
                <Spark className="size-3 text-[var(--w-accent)]" />
                {t("madeWith")}
              </p>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}

/** A photo or video, framed the way the world frames media (reveal.css, [data-frame]). */
function MediaFrame({ frame, index, testId, still = false, children }: { frame: string; index: number; testId: string; still?: boolean; children: React.ReactNode }) {
  return (
    <div className="reveal__media reveal-enter" data-testid={testId}>
      <figure className="reveal__mount" data-frame={frame} data-side={still ? undefined : index % 2 === 0 ? "l" : "r"}>
        {children}
      </figure>
    </div>
  );
}

function Photo({ url, alt }: { url: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <span className="skeleton reveal__photo-skeleton" aria-hidden />}
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not eligible for next/image's remote optimizer allowlist */}
      <img src={url} alt={alt} onLoad={() => setLoaded(true)} className="reveal__photo" data-loaded={loaded || undefined} />
    </>
  );
}

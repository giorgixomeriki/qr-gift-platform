"use client";

import { useState, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import type { ThemeConfig } from "@/lib/themes/registry";

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

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current";

/**
 * The single renderer both Preview (Phase 2) and the Recipient Experience
 * (Phase 3) use — see architecture note in Phase 2 plan §10/§11. Never fork
 * this into a "simplified preview" version: `mode` only changes what chrome
 * surrounds it (sender controls vs nothing), never the actual
 * opening/reveal/content/ending sequence a recipient will see.
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
  const beat = beats[beatIndex] ?? beats[0]!;
  const playedRef = useRef<Set<string>>(new Set());

  function advance() {
    setBeatIndex((i) => Math.min(i + 1, beats.length - 1));
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

  const endingLine = tt(`${theme.key}.ending`);

  return (
    <div
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-6 py-[max(1.5rem,env(safe-area-inset-top))] text-center"
      style={{
        background: theme.palette.backgroundGradient,
        color: theme.palette.text,
        fontFamily: theme.fontFamily,
      }}
      data-testid="greeting-renderer"
      data-mode={mode}
      data-beat={beat.kind}
    >
      <DecorativeLayer variant={theme.decorative} accent={theme.palette.accent} />

      {senderBanner && (
        <div className="absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))]" data-testid="sender-banner">
          {senderBanner}
        </div>
      )}

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8">
        {beat.kind === "opening" && (
          <OpeningBeat theme={theme} onTap={advance} entrance={theme.entrance} openingLine={tt(`${theme.key}.opening`)} tapToOpen={t("tapToOpen")} />
        )}

        {beat.kind === "message" && content.message && (
          <MessageBeat text={content.message} theme={theme} onTap={advance} continueLabel={t("continue")} />
        )}

        {beat.kind === "photo" && content.photos[beat.index] && (
          <PhotoBeat url={content.photos[beat.index]!.url} onTap={advance} continueLabel={t("continue")} />
        )}

        {beat.kind === "video" && content.video && (
          <VideoBeat url={content.video.url} onTap={advance} onPlay={() => notifyPlayed("video")} continueLabel={t("continue")} />
        )}

        {beat.kind === "audio" && content.audio && (
          <AudioBeat url={content.audio.url} theme={theme} onTap={advance} onPlay={() => notifyPlayed("audio")} continueLabel={t("continue")} />
        )}

        {beat.kind === "ending" && (
          <EndingBeat theme={theme} mode={mode} onRestart={restart} senderControls={senderControls} endingLine={endingLine} replayLabel={t("replay")} />
        )}
      </div>

      {beat.kind !== "opening" && beat.kind !== "ending" && (
        <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-10 flex -translate-x-1/2 gap-1.5" role="presentation">
          {beats.map((b, i) => (
            <span
              key={i}
              className="h-1 w-4 rounded-full transition-opacity"
              style={{ background: theme.palette.accent, opacity: i <= beatIndex ? 1 : 0.25 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DecorativeLayer({ variant, accent }: { variant: ThemeConfig["decorative"]; accent: string }) {
  if (variant === "none") return null;
  const symbol = variant === "hearts" ? "♥" : "●";
  // Kept deliberately sparse and low-opacity (Phase 4 §2: "avoid excessive
  // gradients... and generic AI-style decoration") — this is ambient texture,
  // never something a reader has to visually filter out to read the content.
  const pieces = Array.from({ length: 7 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {pieces.map((_, i) => (
        <span
          key={i}
          className="greeting-anim-drift absolute select-none"
          style={{
            left: `${(i * 41) % 100}%`,
            top: "-10%",
            color: accent,
            opacity: 0.22,
            fontSize: variant === "hearts" ? "1.25rem" : "0.5rem",
            animationDuration: `${9 + (i % 5) * 2}s`,
            animationDelay: `${i * 0.7}s`,
          }}
        >
          {symbol}
        </span>
      ))}
    </div>
  );
}

/** Plain-stroke entrance glyphs matched to theme.entrance — no emoji, per the "not an AI-generated landing page" design direction. */
function EntranceIcon({ entrance, color }: { entrance: ThemeConfig["entrance"]; color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="h-16 w-16" aria-hidden="true">
      {entrance === "envelope" ? (
        <g>
          <rect x="2.5" y="5.5" width="19" height="13" rx="1.5" />
          <path d="M3 6.5l9 7 9-7" />
        </g>
      ) : entrance === "balloons" ? (
        <g>
          <ellipse cx="9" cy="8" rx="5" ry="6" />
          <ellipse cx="17" cy="11" rx="4" ry="5" />
          <path d="M9 14v7M9 21l-1.5 2M9 21l1.5 2" />
          <path d="M17 16v5M17 21l-1.2 1.6M17 21l1.2 1.6" />
        </g>
      ) : (
        <g>
          <path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M19 5l-3.5 3.5M8.5 15.5L5 19" />
        </g>
      )}
    </svg>
  );
}

function OpeningBeat({
  theme,
  onTap,
  entrance,
  openingLine,
  tapToOpen,
}: {
  theme: ThemeConfig;
  onTap: () => void;
  entrance: ThemeConfig["entrance"];
  openingLine: string;
  tapToOpen: string;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={`greeting-anim-rise-in flex flex-col items-center gap-8 ${FOCUS_RING}`}
      data-testid="greeting-tap-to-open"
      aria-label={tapToOpen}
    >
      <span className="greeting-anim-float">
        <EntranceIcon entrance={entrance} color={theme.palette.accent} />
      </span>
      <span className="text-xl font-medium leading-snug">{openingLine}</span>
      <span
        className="rounded-full border px-6 py-2.5 text-sm font-medium"
        style={{ borderColor: theme.palette.accent, color: theme.palette.accent }}
      >
        {tapToOpen}
      </span>
    </button>
  );
}

function BeatShell({ children, onTap, testId, continueLabel }: { children: React.ReactNode; onTap: () => void; testId: string; continueLabel: string }) {
  return (
    <div className="greeting-anim-rise-in flex w-full flex-col items-center gap-8" data-testid={testId}>
      {children}
      <button type="button" onClick={onTap} className={`text-sm underline opacity-80 ${FOCUS_RING}`} data-testid="greeting-continue">
        {continueLabel}
      </button>
    </div>
  );
}

function MessageBeat({ text, theme, onTap, continueLabel }: { text: string; theme: ThemeConfig; onTap: () => void; continueLabel: string }) {
  return (
    <BeatShell onTap={onTap} testId="greeting-message-beat" continueLabel={continueLabel}>
      <p className="whitespace-pre-wrap text-2xl leading-relaxed" style={{ color: theme.palette.text }}>
        {text}
      </p>
    </BeatShell>
  );
}

function PhotoBeat({ url, onTap, continueLabel }: { url: string; onTap: () => void; continueLabel: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <BeatShell onTap={onTap} testId="greeting-photo-beat" continueLabel={continueLabel}>
      <div className="relative max-h-[60vh] w-full overflow-hidden rounded-2xl shadow-2xl">
        {!loaded && <div className="absolute inset-0 animate-pulse bg-white/5" aria-hidden="true" />}
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not eligible for next/image's remote optimizer allowlist */}
        <img
          src={url}
          alt=""
          onLoad={() => setLoaded(true)}
          className={`max-h-[60vh] w-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      </div>
    </BeatShell>
  );
}

function VideoBeat({ url, onTap, onPlay, continueLabel }: { url: string; onTap: () => void; onPlay?: () => void; continueLabel: string }) {
  return (
    <BeatShell onTap={onTap} testId="greeting-video-beat" continueLabel={continueLabel}>
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        onPlay={onPlay}
        className="max-h-[60vh] w-full rounded-2xl bg-black/40 shadow-2xl"
      />
    </BeatShell>
  );
}

function AudioBeat({
  url,
  theme,
  onTap,
  onPlay,
  continueLabel,
}: {
  url: string;
  theme: ThemeConfig;
  onTap: () => void;
  onPlay?: () => void;
  continueLabel: string;
}) {
  return (
    <BeatShell onTap={onTap} testId="greeting-audio-beat" continueLabel={continueLabel}>
      <div className="flex flex-col items-center gap-4">
        <svg viewBox="0 0 24 24" fill="none" stroke={theme.palette.accent} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
        <audio src={url} controls preload="metadata" onPlay={onPlay} style={{ accentColor: theme.palette.accent }} />
      </div>
    </BeatShell>
  );
}

function EndingBeat({
  theme,
  mode,
  onRestart,
  senderControls,
  endingLine,
  replayLabel,
}: {
  theme: ThemeConfig;
  mode: "preview" | "recipient";
  onRestart: () => void;
  senderControls?: React.ReactNode;
  endingLine: string;
  replayLabel: string;
}) {
  return (
    <div className="greeting-anim-fade-in flex flex-col items-center gap-6" data-testid="greeting-ending-beat">
      {endingLine && <p className="text-lg font-medium">{endingLine}</p>}
      <button
        type="button"
        onClick={onRestart}
        className={`rounded-full border px-6 py-2.5 text-sm ${FOCUS_RING}`}
        style={{ borderColor: theme.palette.accent, color: theme.palette.accent }}
        data-testid="greeting-replay"
      >
        {replayLabel}
      </button>
      {mode === "preview" && senderControls}
    </div>
  );
}

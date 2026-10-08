"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";

function fmt(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const BARS = 36;

/**
 * Themed voice-note player. Seeking uses a real <input type=range> laid over
 * the waveform, so it's keyboard- and screen-reader-operable.
 *
 * The control shows the audio's real state, never a guess: the tap is
 * answered at once (`pending`), a spinner shows while the audio is actually
 * buffering (the first play over mobile data, or a stall), Pause only once it
 * is really playing. While playing, the waveform follows `currentTime` every
 * frame — `timeupdate` alone arrives only ~4 times a second, so the bars
 * stepped behind the voice.
 */
export function VoicePlayer({
  src,
  durationMs,
  title,
  onPlay,
  variant = "themed",
}: {
  src: string;
  durationMs: number | null;
  title: string;
  onPlay?: () => void;
  variant?: "themed" | "plain";
}) {
  const t = useTranslations("greeting");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  /** Asked to play, not yet audibly playing (starting, or buffering mid-way). */
  const [pending, setPending] = useState(false);
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const total = durationMs ?? mediaDuration ?? 0;

  // Stable pseudo-waveform derived from the URL-independent duration.
  const bars = useMemo(() => {
    let s = Math.max(1, Math.round(total / 97));
    return Array.from({ length: BARS }, (_, i) => {
      s = (s * 9301 + 49297) % 233280;
      const r = s / 233280;
      const envelope = Math.sin((i / (BARS - 1)) * Math.PI) * 0.55 + 0.45;
      return 0.22 + envelope * (0.35 + r * 0.43);
    });
  }, [total]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setPosition(a.currentTime * 1000);
    const onMeta = () => {
      if (Number.isFinite(a.duration)) {
        setMediaDuration(a.duration * 1000);
        return;
      }
      // MediaRecorder WebM files (Chrome/Android) report duration=Infinity
      // until the whole file has been read. Seeking far past the end forces
      // the browser to compute it; then jump back to the start.
      const probe = () => {
        a.removeEventListener("timeupdate", probe);
        if (Number.isFinite(a.duration)) setMediaDuration(a.duration * 1000);
        a.currentTime = 0;
      };
      a.addEventListener("timeupdate", probe);
      a.currentTime = 1e101;
    };
    const onEnd = () => {
      setPlaying(false);
      setPending(false);
      setPosition(0);
    };
    const onPause = () => {
      setPlaying(false);
      setPending(false);
    };
    const onPlaying = () => {
      setPlaying(true);
      setPending(false);
    };
    const onWaiting = () => {
      if (!a.paused) setPending(true);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("ended", onEnd);
    a.addEventListener("pause", onPause);
    a.addEventListener("playing", onPlaying);
    a.addEventListener("waiting", onWaiting);
    return () => {
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("playing", onPlaying);
    };
  }, []);

  // Frame-accurate progress while audible.
  useEffect(() => {
    const a = audioRef.current;
    if (!playing || !a) return;
    let frame = 0;
    const follow = () => {
      setPosition(a.currentTime * 1000);
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const progress = total > 0 ? Math.min(1, position / total) : 0;

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      setPending(true);
      // A refused play (autoplay policy, a decode error) must not leave the control saying "loading".
      a.play().catch(() => setPending(false));
      onPlay?.();
    } else a.pause();
  }

  const themed = variant === "themed";

  return (
    <div
      className={`flex items-center gap-4 rounded-[var(--radius-lg)] p-4 ${
        themed ? "bg-[var(--g-card)] ring-1 ring-[var(--g-line)] backdrop-blur-sm" : "bg-sunken"
      }`}
    >
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing || pending ? t("pause") : t("play")}
        aria-busy={pending || undefined}
        className={`grid size-14 shrink-0 place-items-center rounded-full shadow-sm transition-transform duration-150 active:scale-90 ${
          themed ? "bg-[var(--g-accent)] text-[var(--g-on-accent)]" : "bg-primary text-ink-inverse"
        }`}
      >
        {pending ? (
          <Spinner className="size-6" />
        ) : playing ? (
          <Pause className="size-6" fill="currentColor" strokeWidth={0} />
        ) : (
          <Play className="ml-0.5 size-6" fill="currentColor" strokeWidth={0} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`line-clamp-2 text-label ${themed ? "text-[var(--g-ink)]" : "text-ink"}`}>{title}</p>
        <div className="relative mt-2 h-8">
          <div className="flex h-full items-center gap-[3px]" aria-hidden>
            {bars.map((h, i) => {
              const on = (i + 0.5) / BARS <= progress;
              return (
                <span
                  key={i}
                  className="wave-bar flex-1 rounded-full"
                  style={{
                    height: `${h * 100}%`,
                    background: themed
                      ? on
                        ? "var(--g-accent)"
                        : "color-mix(in oklab, var(--g-ink) 22%, transparent)"
                      : on
                        ? "var(--ink)"
                        : "var(--line-strong)",
                  }}
                />
              );
            })}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(total))}
            step={100}
            value={Math.round(position)}
            aria-label={t("seek")}
            aria-valuetext={`${fmt(position)} / ${fmt(total)}`}
            onChange={(e) => {
              const a = audioRef.current;
              if (!a) return;
              a.currentTime = Number(e.target.value) / 1000;
              setPosition(Number(e.target.value));
            }}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
        </div>
      </div>
      <span className={`shrink-0 text-caption tabular-nums ${themed ? "text-[var(--g-ink-soft)]" : "text-ink-3"}`}>
        {fmt(playing || position > 0 ? position : total)}
      </span>
    </div>
  );
}

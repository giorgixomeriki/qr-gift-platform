"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useWaveformPeaks } from "@/lib/client/waveform";
import { signedUrlLifetimeMs } from "@/lib/storage/signed-url-expiry";
import { useTranslations } from "next-intl";

function fmt(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const BARS = 36;

/** A signed URL is swapped for a fresh one this long before it expires, so a tap always plays a valid URL synchronously. */
const REFRESH_EARLY_MS = 90_000;
/** Proactive renewals are at most this often (a load error may still renew once at any time). */
const RENEW_FLOOR_MS = 60_000;


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
 *
 * The voice lives in private Storage behind a short-lived signed URL, signed
 * when the page rendered; the player is often reached much later (a long
 * reading, a locked phone, a replay). With `refreshSrc` it keeps its URL
 * valid: it swaps in a fresh one shortly before expiry and when the page
 * comes back to the foreground — so a tap still starts playback inside the
 * user's gesture, as iOS requires — and recovers once from a load error.
 * If the voice still can't load, it says so and offers a retry; it never
 * fails silently.
 */
export function VoicePlayer({
  src,
  durationMs,
  title,
  onPlay,
  refreshSrc,
  variant = "themed",
}: {
  src: string;
  /** Returns a fresh signed URL for this voice (null when none can be issued). */
  refreshSrc?: () => Promise<string | null>;
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
  const pendingRef = useRef(false);
  pendingRef.current = pending;
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const total = durationMs ?? mediaDuration ?? 0;
  /** The URL actually loaded: `src`, or a fresher signing of it. */
  const [liveSrc, setLiveSrc] = useState(src);
  /** When this page received `liveSrc` (its own clock): the URL is valid for its lifetime from here. */
  const receivedAt = useRef(Date.now());
  const lastRenewAt = useRef(0);
  const expiresAt = () => {
    const lifetime = signedUrlLifetimeMs(liveSrc);
    return lifetime === null ? null : receivedAt.current + lifetime;
  };
  /** The voice could not be loaded, even with a fresh URL. */
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const renewing = useRef<Promise<string | null> | null>(null);
  const resumeAt = useRef(0);
  /** The listener asked to play while a fresh URL was being fetched: play once that URL has loaded (not the old one). */
  const playAfterLoad = useRef(false);

  useEffect(() => {
    receivedAt.current = Date.now();
    setLiveSrc(src);
    setFailed(false);
    retried.current = false;
  }, [src]);

  /** One request at a time; the new URL replaces the old one (keeping the listener's place). */
  const renew = useCallback(() => {
    if (!refreshSrc) return Promise.resolve(null);
    lastRenewAt.current = Date.now();
    renewing.current ??= refreshSrc()
      .catch(() => null)
      .then((url) => {
        renewing.current = null;
        if (url) {
          resumeAt.current = audioRef.current?.currentTime ?? 0;
          receivedAt.current = Date.now();
          setLiveSrc(url);
        }
        return url;
      });
    return renewing.current;
  }, [refreshSrc]);

  // Keep the URL fresh: shortly before it expires (never mid-playback), and on return to the foreground.
  useEffect(() => {
    const lifetime = signedUrlLifetimeMs(liveSrc);
    if (!refreshSrc || lifetime === null) return;
    let timer = 0;
    const check = () => {
      window.clearTimeout(timer);
      const due = Math.max(receivedAt.current + lifetime - REFRESH_EARLY_MS, lastRenewAt.current + RENEW_FLOOR_MS) - Date.now();
      if (due > 0) {
        timer = window.setTimeout(check, due);
        return;
      }
      if (audioRef.current && !audioRef.current.paused) {
        timer = window.setTimeout(check, 30_000);
        return;
      }
      void renew();
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [liveSrc, refreshSrc, renew]);

  // A load error (typically an expired URL): fetch a fresh one once, then resume what the listener asked for.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onError = () => {
      const wanted = !!pendingRef.current;
      setPending(false);
      if (!refreshSrc || retried.current) {
        playAfterLoad.current = false;
        return setFailed(true);
      }
      retried.current = true;
      if (wanted) {
        playAfterLoad.current = true;
        setPending(true);
      }
      void renew().then((url) => {
        if (url) return;
        playAfterLoad.current = false;
        setPending(false);
        setFailed(true);
      });
    };
    const onLoaded = () => {
      setFailed(false);
      retried.current = false;
      if (resumeAt.current > 0) {
        a.currentTime = resumeAt.current;
        resumeAt.current = 0;
      }
      if (playAfterLoad.current) {
        playAfterLoad.current = false;
        // Outside the tap now: a browser may refuse (iOS); the control then simply waits for the next tap, on a valid URL.
        a.play().catch(() => setPending(false));
      }
    };
    a.addEventListener("error", onError);
    a.addEventListener("loadedmetadata", onLoaded);
    return () => {
      a.removeEventListener("error", onError);
      a.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [refreshSrc, renew]);

  // The note's real loudness (decoded in the browser); a level line until it is known.
  const peaks = useWaveformPeaks(liveSrc, BARS);
  const bars = peaks ?? Array.from({ length: BARS }, () => 0.12);

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
      setFailed(false);
      // Already expired (a page left open for long, timers asleep): sign again, then play.
      const until = expiresAt();
      if (refreshSrc && until !== null && until - Date.now() < 15_000) {
        setPending(true);
        retried.current = true;
        playAfterLoad.current = true;
        void renew().then((url) => {
          if (url) return;
          playAfterLoad.current = false;
          setPending(false);
          setFailed(true);
        });
        onPlay?.();
        return;
      }
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
      <audio ref={audioRef} src={liveSrc} preload="metadata" data-testid="voice-audio" />
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
          <div className="flex h-full items-center gap-[3px]" aria-hidden data-waveform={peaks ? "real" : "pending"}>
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
        {failed && (
          <p role="alert" className={`mt-1 text-caption ${themed ? "text-[var(--g-ink)]" : "text-ink"}`} data-testid="voice-unavailable">
            {t("voiceUnavailable")}{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                setFailed(false);
                retried.current = false;
                void (refreshSrc ? renew() : Promise.resolve(null)).then((url) => {
                  if (!url) audioRef.current?.load();
                });
              }}
              data-testid="voice-retry"
            >
              {t("voiceRetry")}
            </button>
          </p>
        )}
      </div>
      <span className={`shrink-0 text-caption tabular-nums ${themed ? "text-[var(--g-ink-soft)]" : "text-ink-3"}`}>
        {fmt(playing || position > 0 ? position : total)}
      </span>
    </div>
  );
}

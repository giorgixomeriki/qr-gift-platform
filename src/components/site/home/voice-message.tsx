"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "@phosphor-icons/react/dist/csr/Play";
import { Pause } from "@phosphor-icons/react/dist/csr/Pause";
import type WaveSurfer from "wavesurfer.js";

/**
 * A personal voice message, played by wavesurfer.js (BSD-3-Clause,
 * https://wavesurfer.xyz). The waveform is the real recording's own peaks
 * (computed from the file at build time, public/site/media/*.peaks.json),
 * so nothing is decoded until someone presses play and nothing pretends to
 * be audio that isn't there. The library is imported only when the player
 * comes near the screen; the audio file is fetched only on first play.
 *
 * Accessibility: the play button names its state; a native range input
 * over the waveform seeks with the keyboard and reports the time; the
 * waveform canvas itself is decorative.
 */
export function VoiceMessage({
  src,
  peaks,
  duration,
  title,
  credit,
  labels,
}: {
  src: string;
  peaks: number[];
  duration: number;
  title: string;
  credit: string;
  labels: { play: string; pause: string; seek: string };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      async ([entry]) => {
        if (!entry?.isIntersecting || wsRef.current) return;
        io.disconnect();
        const { default: WS } = await import("wavesurfer.js");
        if (cancelled || !waveRef.current || !audioRef.current) return;
        const css = getComputedStyle(root);
        const ws = WS.create({
          container: waveRef.current,
          media: audioRef.current,
          peaks: [peaks],
          duration,
          height: "auto",
          barWidth: 3,
          barGap: 3,
          barRadius: 3,
          normalize: true,
          cursorWidth: 0,
          interact: true,
          dragToSeek: true,
          waveColor: css.getPropertyValue("--vm-wave").trim() || "rgba(246,235,225,.35)",
          progressColor: css.getPropertyValue("--vm-progress").trim() || "#f6ebe1",
        });
        ws.on("timeupdate", (t) => setTime(t));
        ws.on("play", () => setPlaying(true));
        ws.on("pause", () => setPlaying(false));
        ws.on("finish", () => setPlaying(false));
        wsRef.current = ws;
        setReady(true);
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      wsRef.current?.destroy();
      wsRef.current = null;
    };
  }, [peaks, duration]);

  const toggle = () => {
    const ws = wsRef.current;
    if (ws) void ws.playPause();
    else if (audioRef.current) void (audioRef.current.paused ? audioRef.current.play() : audioRef.current.pause());
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div ref={rootRef} className="hm-vm" data-ready={ready || undefined} data-playing={playing || undefined}>
      <button type="button" className="hm-vm__btn" onClick={toggle} aria-label={playing ? labels.pause : labels.play}>
        {playing ? <Pause size={22} weight="fill" aria-hidden /> : <Play size={22} weight="fill" aria-hidden />}
      </button>
      <div className="hm-vm__body">
        <p className="hm-vm__title">{title}</p>
        <div className="hm-vm__wave">
          <div ref={waveRef} className="hm-vm__canvas" aria-hidden />
          <input
            type="range"
            className="hm-vm__seek"
            min={0}
            max={Math.round(duration)}
            step={1}
            value={Math.round(time)}
            aria-label={labels.seek}
            aria-valuetext={`${fmt(time)} / ${fmt(duration)}`}
            onChange={(e) => {
              const v = Number(e.currentTarget.value);
              if (wsRef.current) wsRef.current.setTime(v);
              else if (audioRef.current) audioRef.current.currentTime = v;
              setTime(v);
            }}
          />
        </div>
        <p className="hm-vm__credit">{credit}</p>
      </div>
      <span className="hm-vm__time" aria-hidden>
        {fmt(time)} <span>/ {fmt(duration)}</span>
      </span>
      <audio ref={audioRef} src={src} preload="none" />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * The real shape of a voice note: its audio decoded in the browser and
 * reduced to `bars` loudness values (0–1). Nothing is invented — until the
 * peaks are known (or when the browser can't decode the file) callers get
 * `null` and draw a plain, honest line instead of a made-up waveform.
 *
 * Decoding is deferred to idle time and memoised per URL, so the same note
 * is fetched and decoded once however many players show it. Voice notes are
 * short (≤ 1 minute), so this stays cheap even on mid-range phones.
 */
const cache = new Map<string, Promise<number[] | null>>();

/** Larger files are not decoded for a waveform (a voice note is far smaller). */
const MAX_BYTES = 12 * 1024 * 1024;

async function decodePeaks(src: string, bars: number): Promise<number[] | null> {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  const res = await fetch(src);
  if (!res.ok) return null;
  const data = await res.arrayBuffer();
  if (data.byteLength > MAX_BYTES) return null;
  const ctx = new AudioCtx();
  try {
    const audio = await ctx.decodeAudioData(data);
    const channel = audio.getChannelData(0);
    const size = Math.max(1, Math.floor(channel.length / bars));
    const rms: number[] = [];
    for (let b = 0; b < bars; b++) {
      let sum = 0;
      const start = b * size;
      const end = Math.min(channel.length, start + size);
      for (let i = start; i < end; i += 4) sum += channel[i]! * channel[i]!;
      rms.push(Math.sqrt(sum / Math.max(1, (end - start) / 4)));
    }
    const max = Math.max(...rms, 1e-6);
    // Silence still shows as a sliver, so the bar row keeps its rhythm.
    return rms.map((v) => 0.08 + 0.92 * Math.min(1, v / max));
  } finally {
    void ctx.close().catch(() => {});
  }
}

export function loadWaveform(src: string, bars: number): Promise<number[] | null> {
  const key = `${bars}|${src}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = decodePeaks(src, bars).catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}

export function useWaveformPeaks(src: string | null | undefined, bars: number): number[] | null {
  const [peaks, setPeaks] = useState<{ src: string; values: number[] | null } | null>(null);
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const handle = idle(() => {
      void loadWaveform(src, bars).then((values) => {
        if (!cancelled) setPeaks({ src, values });
      });
    });
    return () => {
      cancelled = true;
      (window.cancelIdleCallback ?? window.clearTimeout)(handle as number);
    };
  }, [src, bars]);
  return peaks && peaks.src === src ? peaks.values : null;
}

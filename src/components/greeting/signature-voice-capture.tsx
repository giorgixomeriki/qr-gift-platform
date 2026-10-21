"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ErrorIcon, RecordIcon, ReplayIcon, StopIcon, UploadIcon } from "@/components/customer/icons";
import { tick } from "@/lib/client/haptics";
import { VoicePlayer } from "./voice-player";

const MAX_DURATION_SECONDS = 60;
const METER_BARS = 24;
/** The meter takes a new reading this often: readable, and 20 renders a second instead of 60 on a mid-range phone. */
const METER_INTERVAL_MS = 50;
const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg"];

/**
 * MediaRecorder support and its preferred mimeType vary across
 * Safari/Chrome/Android — never assume one codec works everywhere. AAC in
 * MP4 first, where offered: the one voice format every recipient's phone
 * plays. Falls back to a file input when recording isn't available.
 */
function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return null;
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Recording a voice message in place, on the Create screen: record → listen
 * back → "Use this recording" hands the clip to the attachment list, which
 * uploads it like any other file (progress, cancel, retry). Or pick an audio
 * file. The recorder's behaviour is the legacy VoiceRecorder's (interruptions
 * and backgrounding end the take cleanly; the clock, not tick counting,
 * times it); only the upload moved out to the shared list.
 */
export function SignatureVoiceCapture({ onUse, onClose }: { onUse: (blob: Blob, durationMs: number | null) => void; onClose: () => void }) {
  const t = useTranslations("wizard.voice");
  const ts = useTranslations("wizard.sig");
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(METER_BARS).fill(0.08));
  const [take, setTake] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  function stopMeter() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevels(Array(METER_BARS).fill(0.08));
  }

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && pickSupportedMimeType() !== null);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopMeter();
    };
  }, []);

  useEffect(() => () => void (take && URL.revokeObjectURL(take.url)), [take]);

  async function start() {
    setError(null);
    const mimeType = pickSupportedMimeType();
    if (!mimeType) return setSupported(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      // Interrupted (a call, another app taking the microphone, the screen locking): keep what was recorded.
      stream.getAudioTracks().forEach((track) => track.addEventListener("ended", () => stop(), { once: true }));
      recorder.onstop = () => {
        // The base MIME type only: the server's allowlist matches "audio/webm", not "audio/webm;codecs=opus".
        const blob = new Blob(chunksRef.current, { type: mimeType.split(";")[0]!.trim() });
        setTake({ blob, url: URL.createObjectURL(blob) });
        stream.getTracks().forEach((track) => track.stop());
        stopMeter();
      };
      recorder.start();
      tick();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      startedAtRef.current = performance.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((performance.now() - startedAtRef.current) / 1000);
        if (elapsed >= MAX_DURATION_SECONDS) {
          setSeconds(MAX_DURATION_SECONDS);
          stop();
          return;
        }
        setSeconds(elapsed);
      }, 250);
      // Live input level, so people can see they're being heard. Decorative.
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        let last = 0;
        const sample = (now: number) => {
          if (now - last >= METER_INTERVAL_MS) {
            last = now;
            analyser.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
            setLevels((prev) => [...prev.slice(1), Math.max(0.08, Math.min(1, avg * 2.6))]);
          }
          rafRef.current = requestAnimationFrame(sample);
        };
        rafRef.current = requestAnimationFrame(sample);
      } catch {
        /* no meter */
      }
    } catch {
      setError(t("micDenied"));
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      tick();
    }
    setRecording(false);
  }

  // Leaving the browser mid-recording ends the take there (iOS suspends the microphone in the background anyway).
  useEffect(() => {
    if (!recording) return;
    const onHide = () => document.visibilityState === "hidden" && stop();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [recording]);

  function again() {
    setTake(null);
    setSeconds(0);
  }

  function pickFile(file: File) {
    setError(null);
    if (!AUDIO_TYPES.includes(file.type)) return setError(t("errorType"));
    onUse(file, null);
  }

  return (
    <div className="sigf-voice" data-testid="voice-recorder">
      {take ? (
        <div data-testid="voice-preview">
          <VoicePlayer src={take.url} durationMs={seconds * 1000 || null} title={t("previewLabel")} variant="plain" />
          <div className="sigf-voice__actions mt-3">
            <button type="button" data-primary onClick={() => onUse(take.blob, seconds * 1000 || null)} data-testid="voice-save">
              {t("saveVoice")}
            </button>
            <button type="button" onClick={again} data-testid="voice-discard">
              <ReplayIcon size={14} weight="bold" aria-hidden />
              {t("recordAgain")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {supported ? (
            <div className="sigf-voice__row">
              <button
                type="button"
                className="sigf-voice__rec"
                onClick={recording ? stop : start}
                aria-pressed={recording}
                aria-label={recording ? t("stop") : t("tapToRecord")}
                data-testid="voice-record-toggle"
              >
                {recording ? <StopIcon size={22} weight="fill" aria-hidden /> : <RecordIcon size={26} weight="fill" aria-hidden />}
              </button>
              <div className="min-w-0 flex-1">
                {recording ? (
                  <span className="sigf-voice__meter" aria-hidden>
                    {levels.map((l, i) => (
                      <i key={i} style={{ height: `${l * 100}%` }} />
                    ))}
                  </span>
                ) : (
                  <p className="sigf-voice__label">{t("tapToRecord")}</p>
                )}
                <p className="sigf-voice__meta" data-testid="voice-timer" role="timer" aria-live="off">
                  {recording ? `${fmt(seconds)} / ${fmt(MAX_DURATION_SECONDS)}` : t("limit", { max: fmt(MAX_DURATION_SECONDS) })}
                </p>
              </div>
            </div>
          ) : (
            <p className="sigf-voice__label" data-testid="voice-unsupported">
              {t("unsupported")}
            </p>
          )}
          <div className="sigf-voice__actions">
            <label className="sigf-voice__file" data-testid="voice-file-fallback-label">
              <UploadIcon size={14} weight="bold" aria-hidden />
              {supported ? t("orUploadFile") : t("uploadFile")}
              <input
                type="file"
                accept={AUDIO_TYPES.join(",")}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) pickFile(file);
                  e.target.value = "";
                }}
                data-testid="voice-file-input"
              />
            </label>
            {!recording && (
              <button type="button" onClick={onClose} data-testid="voice-close">
                {ts("voiceClose")}
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="sigf-voice__error" role="alert">
          <ErrorIcon size={16} weight="fill" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

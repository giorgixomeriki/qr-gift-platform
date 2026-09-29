"use client";

import { useRef, useState, useEffect } from "react";
import { Mic, RotateCcw, Square, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { requestUploadAction, finalizeUploadAction, deleteContentAction } from "@/lib/greetings/actions";
import { uploadToSignedUrl } from "@/lib/client/upload-to-signed-url";
import { sizeLimitFor } from "@/lib/validation/content-types";
import { VoicePlayer } from "./voice-player";

type ExistingItem = { contentId: string; url: string } | null;

const MAX_DURATION_SECONDS = 60;
const METER_BARS = 28;

/**
 * MediaRecorder support and its preferred mimeType vary a lot across
 * Safari/Chrome/Android — never assume one codec works everywhere. Falls
 * back to a plain file input when the API (or no codec) is unavailable, per
 * Phase 2 §8 ("fail gracefully").
 */
function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return null;
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceRecorder({ greetingId, existing, onChanged }: { greetingId: string; existing: ExistingItem; onChanged: (item: ExistingItem) => void }) {
  const t = useTranslations("wizard.voice");
  const tCommon = useTranslations("common");
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(METER_BARS).fill(0.08));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      stopMeter();
    };
  }, []);

  async function startRecording() {
    setError(null);
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      setSupported(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // Store the base MIME type only: Chrome/Android report e.g.
        // "audio/webm;codecs=opus", which the server allowlist (exact match
        // on "audio/webm") would otherwise reject — same bytes either way.
        const blob = new Blob(chunksRef.current, { type: mimeType.split(";")[0]!.trim() });
        setPreviewBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        stopMeter();
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_DURATION_SECONDS) {
            stopRecording();
            return MAX_DURATION_SECONDS;
          }
          return s + 1;
        });
      }, 1000);

      // Live input level, so people can see they're being heard. Decorative:
      // recording proceeds normally if the Web Audio API is unavailable.
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
          setLevels((prev) => [...prev.slice(1), Math.max(0.08, Math.min(1, avg * 2.6))]);
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        /* no meter */
      }
    } catch {
      setError(t("micDenied"));
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  function discardPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setSeconds(0);
  }

  async function upload(body: Blob) {
    setUploading(true);
    setError(null);
    if (existing) await deleteContentAction(greetingId, existing.contentId);

    const requested = await requestUploadAction(greetingId, {
      type: "audio",
      slot: 0,
      mimeType: body.type,
      sizeBytes: body.size,
    }).catch(() => null);
    if (!requested?.ok) {
      if (requested) console.error("[requestUpload]", requested.error);
      setUploading(false);
      setError(t("errorGeneric"));
      return false;
    }

    try {
      await uploadToSignedUrl(requested.data.uploadUrl, body);
    } catch {
      setUploading(false);
      setError(t("errorGeneric"));
      return false;
    }

    const finalized = await finalizeUploadAction(greetingId, requested.data.contentId).catch(() => null);
    setUploading(false);
    if (!finalized?.ok) {
      if (finalized) console.error("[finalizeUpload]", finalized.error);
      setError(t("errorGeneric"));
      return false;
    }
    onChanged({ contentId: requested.data.contentId, url: finalized.data.signedUrl });
    return true;
  }

  async function saveRecording() {
    if (!previewBlob) return;
    if (previewBlob.size > sizeLimitFor("audio")) {
      setError(t("errorSize", { limit: Math.round(sizeLimitFor("audio") / (1024 * 1024)) }));
      return;
    }
    if (await upload(previewBlob)) discardPreview();
  }

  async function handleFileUpload(file: File) {
    setError(null);
    const allowed = ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg"];
    if (!allowed.includes(file.type)) {
      setError(t("errorType"));
      return;
    }
    if (file.size > sizeLimitFor("audio")) {
      setError(t("errorSize", { limit: Math.round(sizeLimitFor("audio") / (1024 * 1024)) }));
      return;
    }
    await upload(file);
  }

  async function handleRemoveExisting() {
    if (!existing) return;
    const result = await deleteContentAction(greetingId, existing.contentId).catch(() => null);
    if (!result?.ok) {
      if (result) console.error("[deleteContent]", result.error);
      setError(t("errorGeneric"));
      return;
    }
    onChanged(null);
  }

  const errorNotice = error && (
    <Notice tone="danger">
      <span role="alert">{error}</span>
    </Notice>
  );

  if (existing) {
    return (
      <div className="animate-pop flex flex-col gap-2" data-testid="voice-existing">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <VoicePlayer src={existing.url} durationMs={null} title={t("savedLabel")} variant="plain" />
          </div>
          <button
            type="button"
            onClick={handleRemoveExisting}
            aria-label={`${tCommon("remove")} — ${t("savedLabel")}`}
            className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger"
            data-testid="voice-remove"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {errorNotice}
      </div>
    );
  }

  if (previewUrl) {
    return (
      <div className="flex flex-col gap-3" data-testid="voice-preview">
        <VoicePlayer src={previewUrl} durationMs={seconds * 1000 || null} title={t("previewLabel")} variant="plain" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="md" onClick={saveRecording} loading={uploading} loadingLabel={t("uploading")} className="sm:flex-1" data-testid="voice-save">
            {t("saveVoice")}
          </Button>
          <Button
            size="md"
            variant="secondary"
            onClick={discardPreview}
            disabled={uploading}
            icon={<RotateCcw className="size-4" aria-hidden />}
            className="sm:flex-1"
            data-testid="voice-discard"
          >
            {t("recordAgain")}
          </Button>
        </div>
        {errorNotice}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="voice-recorder">
      <div className="flex items-center gap-4 rounded-[var(--radius-lg)] bg-surface p-4 shadow-xs ring-1 ring-line">
        {supported ? (
          <>
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              className={`grid size-14 shrink-0 place-items-center rounded-full text-white shadow-sm transition-transform active:scale-95 ${
                recording ? "animate-[pulse-ring_1.4s_ease-out_infinite] bg-ink" : "bg-danger hover:brightness-110"
              }`}
              data-testid="voice-record-toggle"
              aria-label={recording ? t("stop") : t("tapToRecord")}
              aria-pressed={recording}
            >
              {recording ? <Square className="size-5" fill="currentColor" strokeWidth={0} aria-hidden /> : <Mic className="size-6" strokeWidth={1.75} aria-hidden />}
            </button>
            <div className="min-w-0 flex-1">
              {recording ? (
                <div className="flex h-7 items-center gap-[3px]" aria-hidden>
                  {levels.map((l, i) => (
                    <span key={i} className="flex-1 rounded-full bg-danger transition-[height] duration-100" style={{ height: `${l * 100}%` }} />
                  ))}
                </div>
              ) : (
                <p className="text-label text-ink">{t("tapToRecord")}</p>
              )}
              <p className="mt-1 text-caption text-ink-3 tabular-nums" data-testid="voice-timer" role="timer" aria-live="off">
                {recording ? `${fmt(seconds)} / ${fmt(MAX_DURATION_SECONDS)}` : t("limit", { max: fmt(MAX_DURATION_SECONDS) })}
              </p>
            </div>
          </>
        ) : (
          <p className="text-body-sm text-ink-2" data-testid="voice-unsupported">
            {t("unsupported")}
          </p>
        )}
      </div>

      <label
        htmlFor="voice-file-input"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-label text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ember"
        data-testid="voice-file-fallback-label"
      >
        <Upload className="size-4" aria-hidden />
        {supported ? t("orUploadFile") : t("uploadFile")}
        <input
          id="voice-file-input"
          type="file"
          accept="audio/mpeg,audio/mp4,audio/webm,audio/ogg"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
            e.target.value = "";
          }}
          data-testid="voice-file-input"
        />
      </label>

      {uploading && (
        <p className="text-caption text-ink-3" role="status" aria-live="polite">
          {t("uploading")}
        </p>
      )}
      {errorNotice}
    </div>
  );
}

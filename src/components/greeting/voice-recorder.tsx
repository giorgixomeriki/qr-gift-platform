"use client";

import { useRef, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { requestUploadAction, finalizeUploadAction, deleteContentAction } from "@/lib/greetings/actions";
import { uploadToSignedUrl } from "@/lib/client/upload-to-signed-url";
import { sizeLimitFor } from "@/lib/validation/content-types";

type ExistingItem = { contentId: string; url: string } | null;

const MAX_DURATION_SECONDS = 60;
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

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

export function VoiceRecorder({ greetingId, existing, onChanged }: { greetingId: string; existing: ExistingItem; onChanged: (item: ExistingItem) => void }) {
  const t = useTranslations("wizard.voice");
  const tCommon = useTranslations("common");
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && pickSupportedMimeType() !== null);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
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
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setPreviewBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
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

  async function saveRecording() {
    if (!previewBlob) return;
    if (previewBlob.size > sizeLimitFor("audio")) {
      setError(t("errorSize", { limit: Math.round(sizeLimitFor("audio") / (1024 * 1024)) }));
      return;
    }
    setUploading(true);
    setError(null);

    if (existing) await deleteContentAction(greetingId, existing.contentId);

    const requested = await requestUploadAction(greetingId, {
      type: "audio",
      slot: 0,
      mimeType: previewBlob.type,
      sizeBytes: previewBlob.size,
    });
    if (!requested.ok) {
      setUploading(false);
      setError(requested.error);
      return;
    }

    try {
      await uploadToSignedUrl(requested.data.uploadUrl, previewBlob);
    } catch {
      setUploading(false);
      setError(t("errorGeneric"));
      return;
    }

    const finalized = await finalizeUploadAction(greetingId, requested.data.contentId);
    setUploading(false);
    if (!finalized.ok) {
      setError(finalized.error);
      return;
    }
    discardPreview();
    onChanged({ contentId: requested.data.contentId, url: finalized.data.signedUrl });
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
    setUploading(true);
    if (existing) await deleteContentAction(greetingId, existing.contentId);
    const requested = await requestUploadAction(greetingId, { type: "audio", slot: 0, mimeType: file.type, sizeBytes: file.size });
    if (!requested.ok) {
      setUploading(false);
      setError(requested.error);
      return;
    }
    try {
      await uploadToSignedUrl(requested.data.uploadUrl, file);
    } catch {
      setUploading(false);
      setError(t("errorGeneric"));
      return;
    }
    const finalized = await finalizeUploadAction(greetingId, requested.data.contentId);
    setUploading(false);
    if (!finalized.ok) {
      setError(finalized.error);
      return;
    }
    onChanged({ contentId: requested.data.contentId, url: finalized.data.signedUrl });
  }

  async function handleRemoveExisting() {
    if (!existing) return;
    const result = await deleteContentAction(greetingId, existing.contentId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged(null);
  }

  if (existing) {
    return (
      <div className="flex flex-col gap-2" data-testid="voice-existing">
        <audio src={existing.url} controls preload="metadata" />
        <button type="button" onClick={handleRemoveExisting} className={`self-start text-xs text-red-400 underline ${FOCUS_RING}`} data-testid="voice-remove">
          {tCommon("remove")}
        </button>
      </div>
    );
  }

  if (previewUrl) {
    return (
      <div className="flex flex-col gap-3" data-testid="voice-preview">
        <audio src={previewUrl} controls autoPlay={false} />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={saveRecording}
            disabled={uploading}
            className={`rounded-full bg-white px-4 py-2 text-xs font-medium text-black disabled:opacity-50 ${FOCUS_RING}`}
            data-testid="voice-save"
          >
            {uploading ? t("uploading") : t("saveVoice")}
          </button>
          <button type="button" onClick={discardPreview} disabled={uploading} className={`text-xs underline opacity-80 ${FOCUS_RING}`} data-testid="voice-discard">
            {t("recordAgain")}
          </button>
        </div>
        {error && (
          <p className="text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="voice-recorder">
      {supported ? (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            className={`flex h-16 w-16 items-center justify-center rounded-full text-2xl ${FOCUS_RING}`}
            style={{ background: recording ? "#ef4444" : "#ffffff", color: recording ? "#fff" : "#000" }}
            data-testid="voice-record-toggle"
            aria-label={recording ? t("recording") : t("tapToRecord")}
            aria-pressed={recording}
          >
            {recording ? (
              <span aria-hidden="true">■</span>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            )}
          </button>
          <span className="text-sm tabular-nums opacity-80" data-testid="voice-timer" role="timer" aria-live="polite">
            {recording ? `${seconds}s / ${MAX_DURATION_SECONDS}s` : t("tapToRecord")}
          </span>
        </div>
      ) : (
        <p className="text-xs opacity-70" data-testid="voice-unsupported">
          {t("unsupported")}
        </p>
      )}

      <label htmlFor="voice-file-input" className={`w-fit cursor-pointer text-xs underline opacity-80 ${FOCUS_RING}`} data-testid="voice-file-fallback-label">
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
        <p className="text-xs opacity-70" role="status" aria-live="polite">
          {t("uploading")}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

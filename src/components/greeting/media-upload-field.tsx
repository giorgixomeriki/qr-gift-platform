"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Clapperboard, ImagePlus, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { requestUploadAction, finalizeUploadAction, deleteContentAction } from "@/lib/greetings/actions";
import { normalisePhoto } from "@/lib/client/normalise-photo";
import { uploadToSignedUrl } from "@/lib/client/upload-to-signed-url";
import { allowedMimeTypesFor, sizeLimitFor } from "@/lib/validation/content-types";

type MediaType = "photo" | "video";

type ExistingItem = { contentId: string; url: string } | null;

/**
 * One upload slot. Photo slots are square tiles in a 3-up grid; the video
 * slot is a single wide tile. States: empty (tap to add) → uploading (local
 * preview under a progress ring) → filled (remove / replace) → error
 * (inline, localized, with the slot still usable).
 */
export function MediaUploadField({
  greetingId,
  type,
  slot,
  existing,
  onChanged,
}: {
  greetingId: string;
  type: MediaType;
  slot: number;
  existing: ExistingItem;
  onChanged: (item: ExistingItem) => void;
}) {
  const t = useTranslations("wizard.media");
  const tCommon = useTranslations("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = allowedMimeTypesFor(type);
  const limitBytes = sizeLimitFor(type);
  const label = type === "photo" ? t("addPhoto") : t("addVideo");
  const inputId = `media-input-${type}-${slot}`;
  const shape = type === "photo" ? "aspect-square" : "aspect-video";

  useEffect(() => () => {
    if (localUrl) URL.revokeObjectURL(localUrl);
  }, [localUrl]);

  async function handleFile(file: File) {
    setError(null);

    const body: Blob = type === "photo" ? await normalisePhoto(file) : file;

    if (!allowed.includes(body.type)) {
      setError(t("errorType", { types: allowed.map((m) => m.split("/")[1]).join(", ") }));
      return;
    }
    if (body.size > limitBytes) {
      setError(t("errorSize", { limit: Math.round(limitBytes / (1024 * 1024)) }));
      return;
    }

    if (existing) {
      await deleteContentAction(greetingId, existing.contentId);
      onChanged(null);
    }

    setLocalUrl(URL.createObjectURL(body));
    setProgress(0);
    const requested = await requestUploadAction(greetingId, { type, slot, mimeType: body.type, sizeBytes: body.size }).catch(() => null);
    if (!requested?.ok) {
      if (requested) console.error("[requestUpload]", requested.error);
      setError(t("errorGeneric"));
      setProgress(null);
      return;
    }

    try {
      await uploadToSignedUrl(requested.data.uploadUrl, body, (fraction) => setProgress(fraction));
    } catch {
      setError(t("errorGeneric"));
      setProgress(null);
      return;
    }

    const finalized = await finalizeUploadAction(greetingId, requested.data.contentId).catch(() => null);
    setProgress(null);
    if (!finalized?.ok) {
      if (finalized) console.error("[finalizeUpload]", finalized.error);
      setError(t("errorGeneric"));
      return;
    }
    onChanged({ contentId: requested.data.contentId, url: finalized.data.signedUrl });
  }

  async function handleRemove() {
    if (!existing) return;
    setError(null);
    const result = await deleteContentAction(greetingId, existing.contentId).catch(() => null);
    if (!result?.ok) {
      if (result) console.error("[deleteContent]", result.error);
      setError(t("errorGeneric"));
      return;
    }
    onChanged(null);
  }

  const pct = progress !== null ? Math.round(progress * 100) : 0;

  return (
    <div className="flex flex-col gap-2" data-testid={`media-field-${type}-${slot}`}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={type === "photo" ? "image/*" : allowed.join(",")}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
        data-testid={`media-input-${type}-${slot}`}
      />

      {existing ? (
        <div className={`animate-pop relative overflow-hidden rounded-md bg-sunken shadow-xs ${shape}`}>
          {type === "photo" ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={existing.url} alt="" className="size-full object-cover" />
          ) : (
            <video src={`${existing.url}#t=0.1`} controls playsInline preload="metadata" className="size-full bg-black object-contain" />
          )}
          <button
            type="button"
            onClick={handleRemove}
            aria-label={`${tCommon("remove")} — ${label}`}
            className="absolute top-0 right-0 grid size-11 place-items-center text-white"
            data-testid={`media-remove-${type}-${slot}`}
          >
            <span className="grid size-7 place-items-center rounded-full bg-black/55 backdrop-blur-sm transition-colors hover:bg-black/75">
              <X className="size-4" aria-hidden />
            </span>
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`absolute left-1.5 inline-flex h-7 items-center gap-1 rounded-full bg-black/55 px-2.5 text-caption font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75 ${
              type === "video" ? "top-1.5" : "bottom-1.5"
            }`}
            data-testid={`media-replace-${type}-${slot}`}
          >
            <RefreshCw className="size-3" aria-hidden />
            {tCommon("replace")}
          </button>
        </div>
      ) : progress !== null ? (
        <div className={`relative overflow-hidden rounded-md bg-sunken ${shape}`} role="status" aria-live="polite">
          {localUrl &&
            (type === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL
              <img src={localUrl} alt="" className="size-full object-cover" />
            ) : (
              <video src={localUrl} muted playsInline preload="metadata" className="size-full object-cover" />
            ))}
          <div className="absolute inset-0 grid place-items-center bg-black/45 text-white">
            <ProgressRing fraction={progress} />
          </div>
          <span className="sr-only">
            {t("uploading")} {pct}%
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`group flex items-center justify-center gap-2 rounded-md bg-surface text-center shadow-xs ring-1 ring-line transition-[box-shadow,transform] hover:shadow-sm hover:ring-line-strong active:scale-[0.98] ${
            type === "photo" ? "aspect-square flex-col" : "h-20 w-full flex-row gap-3"
          } ${
            error ? "ring-2 ring-danger" : ""
          }`}
          data-testid={`media-add-${type}-${slot}`}
        >
          <span className="grid size-10 place-items-center rounded-full bg-ember-soft text-ember-ink transition-colors group-hover:bg-ember group-hover:text-white">
            {type === "photo" ? <ImagePlus className="size-5" strokeWidth={1.75} aria-hidden /> : <Clapperboard className="size-5" strokeWidth={1.75} aria-hidden />}
          </span>
          <span className="px-1 text-caption font-medium text-ink-2">{label}</span>
        </button>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-caption text-danger" role="alert" data-testid={`media-error-${type}-${slot}`}>
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

function ProgressRing({ fraction }: { fraction: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 40 40" className="size-10 -rotate-90" aria-hidden>
      <circle cx="20" cy="20" r={r} fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth="3" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.04, fraction))}
        className="transition-[stroke-dashoffset] duration-200"
      />
    </svg>
  );
}

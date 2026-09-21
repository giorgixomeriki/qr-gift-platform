"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { requestUploadAction, finalizeUploadAction, deleteContentAction } from "@/lib/greetings/actions";
import { uploadToSignedUrl } from "@/lib/client/upload-to-signed-url";
import { allowedMimeTypesFor, sizeLimitFor } from "@/lib/validation/content-types";

type MediaType = "photo" | "video";

type ExistingItem = { contentId: string; url: string } | null;

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Same plain-stroke icon language as sender-entry's ContentTypeRow — no emoji. */
function MediaTypeIcon({ type }: { type: MediaType }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 opacity-70" aria-hidden="true">
      {type === "photo" ? (
        <g>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="11" r="2" />
          <path d="M3 17l5-5 4 4 3-3 6 6" />
        </g>
      ) : (
        <g>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="M16 10l5-3v10l-5-3z" />
        </g>
      )}
    </svg>
  );
}

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
  const [error, setError] = useState<string | null>(null);

  const allowed = allowedMimeTypesFor(type);
  const limitBytes = sizeLimitFor(type);
  const label = type === "photo" ? t("addPhoto") : t("addVideo");
  const inputId = `media-input-${type}-${slot}`;

  async function handleFile(file: File) {
    setError(null);

    if (!allowed.includes(file.type)) {
      setError(t("errorType", { types: allowed.map((m) => m.split("/")[1]).join(", ") }));
      return;
    }
    if (file.size > limitBytes) {
      setError(t("errorSize", { limit: Math.round(limitBytes / (1024 * 1024)) }));
      return;
    }

    if (existing) {
      await deleteContentAction(greetingId, existing.contentId);
      onChanged(null);
    }

    setProgress(0);
    const requested = await requestUploadAction(greetingId, { type, slot, mimeType: file.type, sizeBytes: file.size });
    if (!requested.ok) {
      setError(requested.error);
      setProgress(null);
      return;
    }

    try {
      await uploadToSignedUrl(requested.data.uploadUrl, file, (fraction) => setProgress(fraction));
    } catch {
      setError(t("errorGeneric"));
      setProgress(null);
      return;
    }

    const finalized = await finalizeUploadAction(greetingId, requested.data.contentId);
    setProgress(null);
    if (!finalized.ok) {
      setError(finalized.error);
      return;
    }
    onChanged({ contentId: requested.data.contentId, url: finalized.data.signedUrl });
  }

  async function handleRemove() {
    if (!existing) return;
    setError(null);
    const result = await deleteContentAction(greetingId, existing.contentId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged(null);
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`media-field-${type}-${slot}`}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={allowed.join(",")}
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
        <div className="relative overflow-hidden rounded-xl border border-white/15">
          {type === "photo" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={existing.url} alt="" className="h-40 w-full object-cover" />
          ) : (
            <video src={existing.url} controls preload="metadata" className="h-40 w-full object-cover" />
          )}
          <div className="absolute inset-x-0 bottom-0 flex justify-end gap-3 bg-black/50 p-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={`text-xs text-white underline ${FOCUS_RING}`}
              data-testid={`media-replace-${type}-${slot}`}
            >
              {tCommon("replace")}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              className={`text-xs text-red-300 underline ${FOCUS_RING}`}
              data-testid={`media-remove-${type}-${slot}`}
            >
              {tCommon("remove")}
            </button>
          </div>
        </div>
      ) : progress !== null ? (
        <div className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 text-sm" role="status" aria-live="polite">
          <span>
            {t("uploading")} {Math.round(progress * 100)}%
          </span>
          <div className="h-1.5 w-2/3 overflow-hidden rounded-full bg-white/15">
            <div className="h-full bg-white transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 text-sm opacity-80 hover:opacity-100 ${FOCUS_RING}`}
          data-testid={`media-add-${type}-${slot}`}
        >
          <MediaTypeIcon type={type} />
          <span>{label}</span>
        </button>
      )}

      {error && (
        <p className="text-xs text-red-400" role="alert" data-testid={`media-error-${type}-${slot}`}>
          {error}
        </p>
      )}
    </div>
  );
}

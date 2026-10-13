"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Clapperboard, ImagePlus, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { requestUploadAction, finalizeUploadAction, deleteContentAction } from "@/lib/greetings/actions";
import { normalisePhoto } from "@/lib/client/normalise-photo";
import { uploadToSignedUrl, UploadAbortedError } from "@/lib/client/upload-to-signed-url";
import { allowedMimeTypesFor, sizeLimitFor } from "@/lib/validation/content-types";
import { Spinner } from "@/components/ui/spinner";

type MediaType = "photo" | "video";

type ExistingItem = { contentId: string; url: string } | null;

/**
 * Where an upload is. `preparing` covers the on-device work before any byte
 * is sent (a 12 MP or HEIC photo is decoded, rotated and re-encoded first —
 * seconds on a mid-range Android), so the tile answers the pick at once.
 * `failed` keeps the chosen file: retrying is one tap, never a second trip
 * through the camera roll.
 */
type Busy =
  | { phase: "preparing" }
  | { phase: "uploading"; fraction: number }
  | { phase: "failed"; body: Blob };

/**
 * One upload slot. Photo slots are square tiles in a 3-up grid; the video
 * slot is a single wide tile. States: empty (tap to add) → preparing →
 * uploading (local preview under a progress ring, cancellable) → filled
 * (remove / replace); a failed upload keeps its preview with Retry and
 * Discard. Errors are inline and localized, and the slot stays usable.
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
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = allowedMimeTypesFor(type);
  const limitBytes = sizeLimitFor(type);
  const label = type === "photo" ? t("addPhoto") : t("addVideo");
  const keptCurrent = type === "photo" ? t("keptCurrent") : t("keptCurrentVideo");
  const inputId = `media-input-${type}-${slot}`;
  const shape = type === "photo" ? "aspect-square" : "aspect-video";

  useEffect(() => () => {
    if (localUrl) URL.revokeObjectURL(localUrl);
  }, [localUrl]);
  // Each pick or retry is a new attempt; responses from an attempt the sender
  // has since replaced (picked again, cancelled) are ignored. Leaving the step
  // does not cancel: the upload finishes and lands in the wizard's state.
  const attemptRef = useRef(0);

  function reset() {
    setBusy(null);
    setLocalUrl(null);
  }

  async function handleFile(file: File) {
    // A new pick supersedes any upload still running for this slot.
    abortRef.current?.abort();
    const attempt = ++attemptRef.current;
    setError(null);
    // Answer the pick immediately with the photo itself (where the browser can show it).
    setLocalUrl(URL.createObjectURL(file));
    setBusy({ phase: "preparing" });

    const body: Blob = type === "photo" ? await normalisePhoto(file) : file;
    if (attempt !== attemptRef.current) return;

    if (!allowed.includes(body.type)) {
      reset();
      setError(t("errorType", { types: allowed.map((m) => m.split("/")[1]).join(", ") }));
      return;
    }
    if (body.size > limitBytes) {
      reset();
      setError(t("errorSize", { limit: Math.round(limitBytes / (1024 * 1024)) }));
      return;
    }
    if (body !== file) setLocalUrl(URL.createObjectURL(body));
    await upload(body, attempt);
  }

  /**
   * Uploads `body` as this slot's new item. Whatever the slot holds now stays
   * saved and on screen until the server has verified and committed the new
   * file (finalizeMediaUpload replaces it atomically) — a failed, cancelled
   * or superseded upload changes nothing.
   */
  async function upload(body: Blob, attempt = ++attemptRef.current) {
    const current = () => attempt === attemptRef.current;
    setError(null);
    setBusy({ phase: "uploading", fraction: 0 });
    const failed = () => {
      if (!current()) return;
      setBusy({ phase: "failed", body });
      setError(existing ? `${t("errorGeneric")} ${keptCurrent}` : t("errorGeneric"));
    };

    const requested = await requestUploadAction(greetingId, { type, slot, mimeType: body.type, sizeBytes: body.size }).catch(() => null);
    if (!requested?.ok) {
      if (requested) console.error("[requestUpload]", requested.error);
      return failed();
    }
    const contentId = requested.data.contentId;
    // Superseded before the transfer began: release the reservation.
    if (!current()) return void deleteContentAction(greetingId, contentId).catch(() => null);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await uploadToSignedUrl(requested.data.uploadUrl, body, (fraction) => current() && setBusy({ phase: "uploading", fraction }), controller.signal);
    } catch (err) {
      if (abortRef.current === controller) abortRef.current = null;
      if (err instanceof UploadAbortedError) {
        // Cancelled or superseded: release the server's reservation; the slot is untouched.
        void deleteContentAction(greetingId, contentId).catch(() => null);
        if (current()) reset();
        return;
      }
      return failed();
    }
    if (abortRef.current === controller) abortRef.current = null;
    if (!current()) return void deleteContentAction(greetingId, contentId).catch(() => null);

    const finalized = await finalizeUploadAction(greetingId, contentId).catch(() => null);
    if (!finalized?.ok) {
      if (finalized) console.error("[finalizeUpload]", finalized.error);
      return failed();
    }
    if (!current()) return; // a newer pick will commit over it (the server keeps the newest)
    reset();
    onChanged({ contentId, url: finalized.data.signedUrl });
  }

  function cancel() {
    attemptRef.current++;
    abortRef.current?.abort();
    reset();
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

  function discard() {
    attemptRef.current++;
    setError(null);
    reset();
  }

  const pct = busy?.phase === "uploading" ? Math.round(busy.fraction * 100) : 0;
  // Overlay controls: small visible discs, full 44px hit areas.
  const cornerButton = "group absolute top-0 right-0 grid size-11 place-items-center text-white";
  const disc = "grid size-7 place-items-center rounded-full bg-black/55 transition-[background-color,scale] duration-150 group-hover:bg-black/75 group-active:scale-90";

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
          if (file) void handleFile(file);
          e.target.value = "";
        }}
        data-testid={`media-input-${type}-${slot}`}
      />

      {existing && !busy ? (
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
            className={cornerButton}
            data-testid={`media-remove-${type}-${slot}`}
          >
            <span className={disc}>
              <X className="size-4" aria-hidden />
            </span>
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            // The pill stays small on a 110px tile; ::before gives it a 44px-tall target.
            className={`absolute left-1.5 inline-flex h-7 items-center gap-1 rounded-full bg-black/55 px-2.5 text-caption font-medium text-white transition-[background-color,scale] duration-150 before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] hover:bg-black/75 active:scale-95 ${
              type === "video" ? "top-1.5" : "bottom-1.5"
            }`}
            data-testid={`media-replace-${type}-${slot}`}
          >
            <RefreshCw className="size-3" aria-hidden />
            {tCommon("replace")}
          </button>
        </div>
      ) : busy ? (
        // Replacing: the saved item stays on the tile (it remains the greeting's
        // item until the new one commits) and the incoming file rides on it as a
        // thumbnail. A first upload shows the new file itself.
        <div
          className={`relative overflow-hidden rounded-md bg-sunken ${shape} ${busy.phase === "failed" ? "ring-2 ring-danger" : ""}`}
          data-replacing={existing ? "" : undefined}
          data-testid={`media-busy-${type}-${slot}`}
        >
          {existing ? (
            type === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={existing.url} alt="" className="size-full object-cover" data-testid={`media-current-${type}-${slot}`} />
            ) : (
              <video src={`${existing.url}#t=0.1`} muted playsInline preload="metadata" className="size-full bg-black object-contain" data-testid={`media-current-${type}-${slot}`} />
            )
          ) : (
            localUrl &&
            (type === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL
              <img src={localUrl} alt="" className="size-full object-cover" />
            ) : (
              <video src={localUrl} muted playsInline preload="metadata" className="size-full object-cover" />
            ))
          )}
          {busy.phase === "failed" ? (
            existing ? (
              <>
                {/* The current item is safe and fully shown; the failed one waits on a strip below. */}
                <button
                  type="button"
                  onClick={() => void upload(busy.body)}
                  className="absolute inset-x-0 bottom-0 flex h-11 items-center justify-center gap-1.5 bg-black/65 text-caption font-medium text-white transition-colors active:bg-black/80"
                  data-testid={`media-retry-${type}-${slot}`}
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                  {tCommon("retry")}
                </button>
                <button type="button" onClick={discard} aria-label={tCommon("cancel")} className={cornerButton} data-testid={`media-discard-${type}-${slot}`}>
                  <span className={disc}>
                    <X className="size-4" aria-hidden />
                  </span>
                </button>
              </>
            ) : (
              <>
                <div className="absolute inset-0 bg-black/45" aria-hidden />
                <button
                  type="button"
                  onClick={() => void upload(busy.body)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-white transition-colors active:bg-black/15"
                  data-testid={`media-retry-${type}-${slot}`}
                >
                  <span className="grid size-10 place-items-center rounded-full bg-white/20">
                    <RefreshCw className="size-5" aria-hidden />
                  </span>
                  <span className="text-caption font-medium">{tCommon("retry")}</span>
                </button>
                <button type="button" onClick={discard} aria-label={tCommon("cancel")} className={cornerButton} data-testid={`media-discard-${type}-${slot}`}>
                  <span className={disc}>
                    <X className="size-4" aria-hidden />
                  </span>
                </button>
              </>
            )
          ) : (
            <>
              <div className="absolute inset-0 grid place-items-center bg-black/45 text-white" role="status" aria-live="polite">
                {busy.phase === "preparing" ? <Spinner className="size-7" /> : <ProgressRing fraction={busy.fraction} />}
                <span className="sr-only">
                  {existing ? t("replacing") : t("uploading")} {busy.phase === "uploading" ? `${pct}%` : ""} {existing ? keptCurrent : ""}
                </span>
              </div>
              {existing && localUrl && type === "photo" && (
                // The incoming photo, small, on the one it will replace.
                // eslint-disable-next-line @next/next/no-img-element -- local object URL
                <img src={localUrl} alt="" className="absolute bottom-1.5 left-1.5 size-9 rounded-sm object-cover shadow-sm ring-2 ring-white" />
              )}
              <button type="button" onClick={cancel} aria-label={tCommon("cancel")} className={cornerButton} data-testid={`media-cancel-${type}-${slot}`}>
                <span className={disc}>
                  <X className="size-4" aria-hidden />
                </span>
              </button>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`group flex items-center justify-center gap-2 rounded-md bg-surface text-center shadow-xs ring-1 ring-line transition-[box-shadow,transform] duration-150 hover:shadow-sm hover:ring-line-strong active:scale-[0.97] ${
            type === "photo" ? "aspect-square flex-col" : "h-20 w-full flex-row gap-3"
          } ${error ? "ring-2 ring-danger" : ""}`}
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

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { ErrorIcon, PhotoIcon, PlayIcon, RemoveIcon, ReplayIcon, SuccessIcon, VideoIcon, VoiceIcon } from "@/components/customer/icons";
import { Dock, SigAction } from "@/components/signature/chrome";
import { Spark } from "@/components/ui/logo";
import { allowedMimeTypesFor } from "@/lib/validation/content-types";
import type { ThemeKey } from "@/lib/themes/registry";
import { SLOT_LIMITS, type MediaItem, type MediaKind, type MediaUploads } from "./use-media-uploads";
import { SignatureVoiceCapture } from "./signature-voice-capture";

const KINDS = ["photo", "video", "audio"] as const;

function fmtDuration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Greeting Creation in the Signature Experience: the letter first (ruled
 * paper, the chosen world's name at its head), then three separate actions —
 * photo, video, voice — and a calm list of what's attached, each with its own
 * state: preparing, uploading (real progress, Cancel), failed (the reason and
 * Retry), saved, and removed (Undo).
 *
 * Continue: an empty letter is refused with the reason and focus; a failed
 * file blocks with a note pointing at it; uploads still running are waited
 * for (the action says so, and the flow continues when they land). The
 * parent then flushes removals and saves the message before Preview.
 */
export function SignatureCreateStep({
  themeKey,
  message,
  onMessageChange,
  limit,
  messageError,
  onClearError,
  media,
  saving,
  onContinue,
}: {
  themeKey: ThemeKey;
  message: string;
  onMessageChange: (value: string) => void;
  limit: number;
  /** Set by the parent's Continue (empty, too long, couldn't save). */
  messageError: string | null;
  onClearError: () => void;
  media: MediaUploads;
  saving: boolean;
  onContinue: () => void;
}) {
  const t = useTranslations("wizard");
  const tm = useTranslations("wizard.message");
  const ts = useTranslations("wizard.sig");
  const tt = useTranslations("themes");
  const tc = useTranslations("common");
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  /** Continue tapped during an upload: remembered, and the flow continues the moment the uploads land. */
  const [queued, setQueued] = useState(false);
  /** Continue tapped while a file had failed: say so (never a silent, dead button). */
  const [blocked, setBlocked] = useState(false);
  const { uploading, failed } = media;

  useEffect(() => {
    if (!queued) return;
    if (failed) {
      setQueued(false);
      setBlocked(true);
    } else if (!uploading) {
      setQueued(false);
      onContinue();
    }
  }, [queued, uploading, failed, onContinue]);
  useEffect(() => {
    if (!failed) setBlocked(false);
  }, [failed]);
  // The parent refused the message: bring the sender to the field.
  useEffect(() => {
    if (messageError) fieldRef.current?.focus();
  }, [messageError]);

  function next() {
    if (!message.trim()) {
      // The parent owns the wording; ask it to validate (it sets messageError and we focus).
      return onContinue();
    }
    if (failed) {
      setBlocked(true);
      listRef.current?.querySelector<HTMLElement>('[data-status="failed"] button, [data-status="invalid"] button')?.focus();
      return;
    }
    if (uploading) return setQueued(true);
    onContinue();
  }

  /**
   * While the letter is being written, the action steps out of the keyboard's
   * way. It returns a beat after the field loses focus: re-sticking on blur
   * itself would slide the dock under a finger mid-tap and swallow that tap.
   */
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(typingTimer.current), []);
  // Typed before the page finished loading (a slow phone hydrates seconds after the letter is on screen):
  // the field already holds those words, and the next render would replace them with the draft's copy.
  // Adopt them instead, once, on mount — they're the newest thing the sender wrote.
  useLayoutEffect(() => {
    const typed = fieldRef.current?.value;
    if (typed && typed !== message) onMessageChange(typed.slice(0, limit));
    // Focused before hydration too: React never saw that focus, so step the action aside now.
    if (fieldRef.current && document.activeElement === fieldRef.current) setTyping(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = Object.fromEntries(KINDS.map((k) => [k, media.items.filter((m) => m.kind === k && m.removedAt === undefined).length])) as Record<MediaKind, number>;
  const waiting = queued && uploading > 0;

  function pick(kind: MediaKind, files: FileList | null) {
    if (!files?.length) return;
    const free = SLOT_LIMITS[kind] - counts[kind];
    for (const file of [...files].slice(0, Math.max(free, 1))) void media.add(kind, file);
  }

  return (
    <div className="sigf-create flex flex-1 flex-col" data-typing={typing || undefined} data-testid="create-step">
      <h1 className="sig-title">{tm("title")}</h1>
      <p className="sig-sub">{tm("subtitle")}</p>

      <div className="sig-letter-field" data-invalid={messageError ? true : undefined}>
        <p className="sig-letter-field__head">
          <span>{tt(`${themeKey}.name`)}</span>
          <Spark className="size-3" />
        </p>
        <label htmlFor="greeting-message" className="sr-only">
          {tm("label")}
        </label>
        <textarea
          ref={fieldRef}
          id="greeting-message"
          className="sig-letter-field__input"
          value={message}
          maxLength={limit}
          rows={7}
          placeholder={tm("placeholder")}
          autoCapitalize="sentences"
          onChange={(e) => {
            onMessageChange(e.target.value.slice(0, limit));
            if (messageError && e.target.value.trim()) onClearError();
          }}
          onFocus={() => {
            window.clearTimeout(typingTimer.current);
            setTyping(true);
          }}
          onBlur={() => {
            typingTimer.current = window.setTimeout(() => setTyping(false), 400);
          }}
          aria-invalid={messageError ? true : undefined}
          aria-describedby="greeting-message-hint"
          data-testid="message-textarea"
        />
        <p className="sig-letter-field__foot" id="greeting-message-hint">
          <span role={messageError ? "alert" : undefined} data-testid={messageError ? "message-error" : undefined}>
            {messageError && <ErrorIcon size={14} weight="fill" aria-hidden />}
            {messageError ?? tm("hint")}
          </span>
          <span className="sig-count" style={limit - message.length <= 60 ? ({ color: "#8a5a0b" } as CSSProperties) : undefined}>
            {message.length} / {limit}
          </span>
        </p>
      </div>

      <section className="sigf-memories" aria-labelledby="sigf-memories-title" data-testid="media-step">
        <div className="sigf-memories__head">
          <h2 id="sigf-memories-title" className="sig-kicker">
            {ts("memories")}
          </h2>
          <span className="sig-caption">{tc("optional")}</span>
        </div>

        {/* Three separate actions: what each one adds is never ambiguous. */}
        <div className="sigf-add" role="group" aria-label={ts("memories")}>
          {KINDS.map((kind) => {
            const count = counts[kind];
            const full = count >= SLOT_LIMITS[kind];
            const Icon = kind === "photo" ? PhotoIcon : kind === "video" ? VideoIcon : VoiceIcon;
            const label = kind === "photo" ? ts("addPhoto") : kind === "video" ? ts("addVideo") : ts("addVoice");
            if (full)
              return (
                <span key={kind} className="sigf-add__btn" data-full data-testid={`add-${kind}`}>
                  <Icon size={20} weight="light" aria-hidden />
                  <b>{label}</b>
                  <small>
                    <SuccessIcon size={12} weight="fill" aria-hidden /> {ts("full")}
                  </small>
                </span>
              );
            const aria = kind === "photo" ? ts("addAriaPhoto", { count, max: SLOT_LIMITS.photo }) : kind === "video" ? ts("addAriaVideo") : ts("addAriaVoice");
            return (
              <button
                key={kind}
                type="button"
                className="sigf-add__btn"
                aria-label={aria}
                aria-expanded={kind === "audio" ? voiceOpen : undefined}
                onClick={() => (kind === "photo" ? photoInput.current?.click() : kind === "video" ? videoInput.current?.click() : setVoiceOpen((v) => !v))}
                data-testid={`add-${kind}`}
              >
                <Icon size={20} weight="light" aria-hidden />
                <b>
                  <span aria-hidden>+ </span>
                  {label}
                </b>
                <small>{kind === "photo" ? ts("slotPhoto", { count, max: SLOT_LIMITS.photo }) : kind === "video" ? ts("slotVideo") : ts("slotVoice")}</small>
              </button>
            );
          })}
        </div>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            pick("photo", e.target.files);
            e.target.value = "";
          }}
          data-testid="media-input-photo"
        />
        <input
          ref={videoInput}
          type="file"
          accept={allowedMimeTypesFor("video").join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            pick("video", e.target.files);
            e.target.value = "";
          }}
          data-testid="media-input-video"
        />

        {voiceOpen && counts.audio < SLOT_LIMITS.audio && (
          <SignatureVoiceCapture
            onUse={(blob, durationMs) => {
              setVoiceOpen(false);
              void media.add("audio", blob, { durationMs });
            }}
            onClose={() => setVoiceOpen(false)}
          />
        )}

        {media.removeError && (
          <p className="sig-notice mt-3" role="alert">
            <ErrorIcon size={16} weight="fill" aria-hidden />
            {ts("removeError")}
          </p>
        )}

        {media.items.length > 0 && (
          <ul className="sigf-media" ref={listRef} data-testid="media-list">
            {media.items.map((m) => (
              <MediaRow key={m.key} m={m} name={media.nameOf(m)} media={media} />
            ))}
          </ul>
        )}
      </section>

      <Dock className="sigf-dock-create">
        {blocked && failed > 0 && (
          <p className="sigf-dock-note" role="alert" data-testid="failed-block">
            <ErrorIcon size={16} weight="fill" aria-hidden />
            {ts("failedBlock")}
          </p>
        )}
        <SigAction onClick={next} busy={waiting || saving} testId="wizard-continue">
          {waiting ? ts("waiting", { count: uploading }) : t("continue")}
        </SigAction>
      </Dock>
    </div>
  );
}

function MediaRow({ m, name, media }: { m: MediaItem; name: string; media: MediaUploads }) {
  const ts = useTranslations("wizard.sig");
  const [duration, setDuration] = useState<number | null>(m.durationMs ?? null);
  const id = `${m.kind}-${m.slot}`;

  if (m.removedAt !== undefined) {
    return (
      <li className="sigf-row sigf-row--removed" data-status="removed" data-testid={`media-row-${id}`}>
        <span className="sigf-row__body" role="status">
          {ts("removed", { name })}
        </span>
        <button type="button" className="sigf-row__text-btn" onClick={() => media.undo(m.key)} data-testid={`media-undo-${id}`}>
          {ts("undo")}
        </button>
      </li>
    );
  }
  const pct = Math.round(m.progress * 100);
  const busy = m.status === "preparing" || m.status === "uploading";
  return (
    <li className="sigf-row" data-status={m.status} data-kind={m.kind} data-testid={`media-row-${id}`}>
      <span className="sigf-row__thumb" aria-hidden>
        {m.kind === "audio" ? (
          <span className="sigf-row__voice">
            <VoiceIcon size={16} weight="fill" />
            <Wave bars={9} />
          </span>
        ) : m.kind === "video" ? (
          m.url && <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration * 1000)} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL or a local object URL
          m.url && <img src={m.url} alt="" />
        )}
        {m.kind === "video" && (
          <span className="sigf-row__play">
            <PlayIcon size={10} weight="fill" />
          </span>
        )}
      </span>
      <span className="sigf-row__body">
        <b className="sigf-row__name">
          {name}
          {duration ? <span className="sig-tnum"> · {fmtDuration(duration)}</span> : null}
        </b>
        {m.status === "invalid" && (
          <span className="sigf-row__status" role="alert" data-testid={`media-error-${id}`}>
            <ErrorIcon size={13} weight="fill" aria-hidden />
            {m.error}
          </span>
        )}
        {m.status === "failed" && (
          <>
            <span className="sigf-row__status" role="alert" data-testid={`media-error-${id}`}>
              <ErrorIcon size={13} weight="fill" aria-hidden />
              {ts("uploadFailed")}
            </span>
            {/* Retry sits under the reason: on a 360 px phone the reason keeps the full width. */}
            <button type="button" className="sigf-row__retry" onClick={() => media.retry(m.key)} aria-label={`${ts("retryUpload")}: ${name}`} data-testid={`media-retry-${id}`}>
              <ReplayIcon size={14} weight="bold" aria-hidden />
              {ts("retryUpload")}
            </button>
          </>
        )}
        {busy && (
          <>
            <span className="sigf-row__bar" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <i style={{ "--p": m.progress } as CSSProperties} />
            </span>
            <span className="sigf-row__status sig-tnum" aria-live="polite">
              {m.status === "preparing" ? ts("preparing") : ts("uploadingPct", { pct })}
            </span>
          </>
        )}
        {m.status === "done" && (
          <span className="sigf-row__status" data-testid={`media-ready-${id}`}>
            <SuccessIcon size={13} weight="fill" aria-hidden />
            {ts("ready")}
          </span>
        )}
      </span>
      <span className="sigf-row__actions">
        {busy ? (
          <button type="button" className="sigf-row__text-btn" onClick={() => media.cancel(m.key)} aria-label={`${ts("cancel")}: ${name}`} data-testid={`media-cancel-${id}`}>
            {ts("cancel")}
          </button>
        ) : (
          <button type="button" className="sigf-row__remove" onClick={() => media.remove(m.key)} aria-label={`${ts("remove")}: ${name}`} data-testid={`media-remove-${id}`}>
            <RemoveIcon size={14} weight="bold" aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}

function Wave({ bars }: { bars: number }) {
  // A fixed, deterministic waveform (no randomness between server and client renders).
  const heights = Array.from({ length: bars }, (_, i) => 30 + Math.round(55 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))));
  return (
    <span className="sig-wave">
      {heights.map((h, i) => (
        <i key={i} style={{ height: `${h}%` }} />
      ))}
    </span>
  );
}

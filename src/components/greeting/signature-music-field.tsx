"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ErrorIcon, RemoveIcon, SuccessIcon } from "@/components/customer/icons";
import { removeMusicAction, setMusicAction } from "@/lib/greetings/actions";
import { MUSIC_INPUT_MAX, parseSpotifyInput, spotifyOpenUrl, type SpotifyMusic, type SpotifyParseError } from "@/lib/music/spotify";

type FieldError = SpotifyParseError | "save" | "remove";

/**
 * "Our song" on the Create screen: paste a Spotify track or playlist link.
 * Saved to the draft at once (like an upload, not on Continue), so it
 * survives navigation, reloads and the message's own autosave — which never
 * touches it. One per greeting: adding again replaces it.
 *
 * The link is checked as it is typed (same parser as the server, which
 * checks again and stores only the canonical reference). No Spotify account,
 * no fetch to Spotify: the saved row shows the kind and an "Open in Spotify"
 * link so the sender can check it's the right one.
 */
/**
 * Scrolls so `el` sits inside what the sender can actually see: above the
 * on-screen keyboard (visualViewport — iOS lays the keyboard over the page,
 * Android shrinks it) and below the top edge. When it can't fit, its top
 * (label + input) wins over its bottom.
 */
function keepInView(el: HTMLElement | null) {
  if (!el) return;
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const bottom = top + (vv ? vv.height : window.innerHeight);
  const r = el.getBoundingClientRect();
  const gap = 12;
  let dy = 0;
  if (r.bottom + gap > bottom) dy = Math.min(r.bottom + gap - bottom, r.top - top - gap);
  else if (r.top - gap < top) dy = r.top - top - gap;
  if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: "instant" });
}

export function SignatureMusicField({
  greetingId,
  music,
  onChange,
  onEditingChange,
}: {
  greetingId: string;
  music: SpotifyMusic | null;
  onChange: (music: SpotifyMusic | null) => void;
  /** The form is open: Create moves its Continue dock out of the way so it can't cover the form or catch its taps. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const t = useTranslations("wizard.music");
  const tc = useTranslations("common");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set by a save in this visit: the row confirms it ("Added to your greeting") and settles in once. */
  const [justSaved, setJustSaved] = useState(false);
  const onEditingRef = useRef(onEditingChange);
  onEditingRef.current = onEditingChange;

  useEffect(() => {
    onEditingRef.current?.(editing);
    if (!editing) return;
    inputRef.current?.focus({ preventScroll: true });
    // The keyboard arrives a beat after focus and resizes the visual viewport (or the page, on Android):
    // follow it, so the input, its message and both buttons stay above it.
    const follow = () => keepInView(formRef.current);
    const timers = [0, 120, 360, 700].map((ms) => window.setTimeout(follow, ms));
    const vv = window.visualViewport;
    vv?.addEventListener("resize", follow);
    window.addEventListener("resize", follow);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      vv?.removeEventListener("resize", follow);
      window.removeEventListener("resize", follow);
    };
  }, [editing]);
  useEffect(() => () => onEditingRef.current?.(false), []);

  // A message appeared (or changed) under the input: it must be visible too.
  useEffect(() => {
    if (editing && error) keepInView(formRef.current);
  }, [editing, error]);

  // Saved: the keyboard closes with the input; bring the confirmed row into view (above the dock, see .sigf-row's scroll margin).
  useEffect(() => {
    if (!justSaved || editing) return;
    const row = rowRef.current;
    row?.focus({ preventScroll: true });
    const t = window.setTimeout(() => row?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 250);
    return () => window.clearTimeout(t);
  }, [justSaved, editing]);

  function close() {
    setEditing(false);
    setValue("");
    setError(null);
  }

  async function save() {
    const parsed = parseSpotifyInput(value);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    setError(null);
    const res = await setMusicAction(greetingId, value).catch(() => null);
    setBusy(false);
    if (!res) return setError("save");
    if (!res.ok) return setError(res.code ?? "save");
    onChange(res.data);
    setJustSaved(true);
    close();
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await removeMusicAction(greetingId).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("remove");
    setJustSaved(false);
    onChange(null);
    window.setTimeout(() => addRef.current?.focus({ preventScroll: true }), 0);
  }

  const kindLabel = music ? (music.kind === "playlist" ? t("kindPlaylist") : t("kindTrack")) : "";

  return (
    <section className="sigf-music" aria-labelledby={`${inputId}-title`} data-testid="music-field">
      <div className="sigf-memories__head">
        <h2 id={`${inputId}-title`} className="sig-kicker">
          {t("title")}
        </h2>
        <span className="sig-caption">{tc("optional")}</span>
      </div>

      {music && !editing && (
        <div
          ref={rowRef}
          tabIndex={-1}
          className="sigf-row sigf-music__row"
          data-status="done"
          data-just-saved={justSaved || undefined}
          data-testid="music-saved"
          data-kind={music.kind}
          data-spotify-id={music.id}
        >
          <span className="sigf-row__thumb sigf-music__thumb" aria-hidden>
            <span />
          </span>
          <span className="sigf-row__body">
            <b className="sigf-row__name">{kindLabel}</b>
            <span className="sigf-row__status sigf-music__status" role="status" data-testid="music-confirm">
              <SuccessIcon size={13} weight="fill" aria-hidden />
              {justSaved ? t("added") : t("saved")}
            </span>
            <span className="sigf-music__links">
              <a href={spotifyOpenUrl(music)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-testid="music-check">
                {t("check")}
              </a>
              <button type="button" onClick={() => setEditing(true)} disabled={busy} data-testid="music-replace">
                {t("replace")}
              </button>
            </span>
          </span>
          <span className="sigf-row__actions">
            <button type="button" className="sigf-row__remove" onClick={() => void remove()} disabled={busy} aria-label={`${t("remove")}: ${kindLabel}`} data-testid="music-remove">
              <RemoveIcon size={14} weight="bold" aria-hidden />
            </button>
          </span>
        </div>
      )}

      {!music && !editing && (
        <button ref={addRef} type="button" className="sigf-add__btn sigf-music__add" onClick={() => setEditing(true)} data-testid="music-add">
          <span className="sigf-music__disc" aria-hidden />
          <b>
            <span aria-hidden>+ </span>
            {t("add")}
          </b>
          <small>{t("addHint")}</small>
        </button>
      )}

      {editing && (
        <form
          ref={formRef}
          className="sigf-music__form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          <label htmlFor={inputId} className="sigf-music__label">
            {t("label")}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="sigf-music__input"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={MUSIC_INPUT_MAX}
            enterKeyHint="done"
            placeholder="https://open.spotify.com/track/…"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${inputId}-hint`}
            data-testid="music-input"
          />
          <p id={`${inputId}-hint`} className="sigf-music__hint" role={error ? "alert" : undefined} data-testid={error ? "music-error" : undefined} data-error={error ?? undefined}>
            {error ? (
              <>
                <ErrorIcon size={14} weight="fill" aria-hidden />
                {t(`error.${error}`)}
              </>
            ) : (
              t("hint")
            )}
          </p>
          <div className="sigf-music__buttons">
            <button
              type="button"
              className="sigf-music__cancel"
              onClick={() => {
                close();
                window.setTimeout(() => (music ? rowRef : addRef).current?.focus({ preventScroll: true }), 0);
              }}
              disabled={busy}
              data-testid="music-cancel"
            >
              {t("cancel")}
            </button>
            <button type="submit" className="sigf-music__save" disabled={busy || !value.trim()} data-testid="music-save">
              {busy ? t("saving") : music ? t("saveReplace") : t("save")}
            </button>
          </div>
        </form>
      )}
      {error === "remove" && !editing && (
        <p className="sig-notice mt-3" role="alert" data-testid="music-error">
          <ErrorIcon size={16} weight="fill" aria-hidden />
          {t("error.remove")}
        </p>
      )}
    </section>
  );
}

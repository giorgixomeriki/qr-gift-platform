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
export function SignatureMusicField({ greetingId, music, onChange }: { greetingId: string; music: SpotifyMusic | null; onChange: (music: SpotifyMusic | null) => void }) {
  const t = useTranslations("wizard.music");
  const tc = useTranslations("common");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

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
    setEditing(false);
    setValue("");
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await removeMusicAction(greetingId).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("remove");
    onChange(null);
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
        <div className="sigf-row sigf-music__row" data-status="done" data-testid="music-saved" data-kind={music.kind} data-spotify-id={music.id}>
          <span className="sigf-row__thumb sigf-music__thumb" aria-hidden>
            <span />
          </span>
          <span className="sigf-row__body">
            <b className="sigf-row__name">{kindLabel}</b>
            <span className="sigf-row__status">
              <SuccessIcon size={13} weight="fill" aria-hidden />
              {t("saved")}
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
        <button type="button" className="sigf-add__btn sigf-music__add" onClick={() => setEditing(true)} data-testid="music-add">
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
              className="sigf-row__text-btn"
              onClick={() => {
                setEditing(false);
                setValue("");
                setError(null);
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

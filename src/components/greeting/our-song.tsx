"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Spark } from "@/components/ui/logo";
import { spotifyEmbedUrl } from "@/lib/music/spotify";
import { musicOpenUrl, musicService, type MusicMeta, type MusicRef } from "@/lib/music/link";

/** Pauses every <audio>/<video> on the page — the voice note, the film — so two sources never play at once. */
function pausePageMedia() {
  document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((el) => {
    if (!el.paused) el.pause();
  });
}

/**
 * "ჩვენი სიმღერა" / "Our Song": the sender's Spotify track/playlist or
 * YouTube / YouTube Music video as a keepsake card — cream stock, one clear
 * "Listen on …" action, never autoplay. Never a provider widget by default.
 *
 * Two faces, same card:
 * - Metadata on (MUSIC_METADATA_SPOTIFY / _YOUTUBE, server-side, default
 *   off): the provider's own title, channel (YouTube; Spotify's oEmbed has no
 *   artist, so none is shown) and artwork, unmodified (scaled only, 4/8 px
 *   corners, nothing over it), named source and the link back.
 * - Otherwise (and when the artwork fails to load): QR STARR's record sleeve,
 *   exactly as before.
 *
 * - Nothing plays by itself. "Listen on Spotify" is an ordinary link to the
 *   canonical open.spotify.com URL (opens the app where installed), rebuilt
 *   from the validated id — the sender's text never reaches an href.
 *   Tapping it pauses the voice note / video on the page.
 * - Metadata stays off by default because Spotify's Developer Policy IV.2 /
 *   Terms V.5 (15 May 2025) don't clearly allow cover art or metadata in a
 *   paid product, and YouTube API Services need legal-page changes first
 *   (docs/music/OUR-SONG.md §4). The sleeve is our own object (burgundy
 *   linen, gold foil, the spark); a playlist is two sleeves.
 * - `embedAllowed` (SPOTIFY_EMBED_ENABLED, off until Spotify confirms
 *   commercial use) adds an explicit "Play here" that loads the official
 *   embed only on tap. The embed's controls can't be driven without
 *   Spotify's script, so coexistence is explicit instead of pretended: the
 *   page's own audio is paused when the player opens, and the player is
 *   closed (which stops it) as soon as the voice note or video starts.
 */
export function OurSong({
  music,
  meta = null,
  embedAllowed = false,
  variant,
  num,
}: {
  music: MusicRef;
  /** Provider title/artwork (lib/music/metadata.ts); null = our own sleeve, as before. */
  meta?: MusicMeta | null;
  embedAllowed?: boolean;
  variant: "beat" | "keepsake";
  num?: string;
}) {
  const t = useTranslations("greeting.ourSong");
  const [playerOpen, setPlayerOpen] = useState(false);
  const [artState, setArtState] = useState<"loading" | "ready" | "failed">("loading");
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!playerOpen) return;
    pausePageMedia();
    // `play` doesn't bubble; capture sees every media element on the page.
    const onPlay = (e: Event) => {
      if (e.target instanceof HTMLMediaElement) setPlayerOpen(false);
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, [playerOpen]);

  const artworkUrl = meta?.status === "ok" ? meta.artworkUrl : null;
  // The image may finish (or fail) before React hydrates and attaches onLoad/onError.
  useEffect(() => {
    setArtState("loading");
    const img = imgRef.current;
    if (img?.complete) setArtState(img.naturalWidth > 0 ? "ready" : "failed");
  }, [artworkUrl]);

  let href: string;
  try {
    href = musicOpenUrl(music);
  } catch {
    return null; // never reached for a server-validated reference; a bad one just shows no card
  }
  const service = musicService(music);
  const embed = embedAllowed && music.provider === "spotify";
  const providerName = t(`provider.${service}`);
  const kindLabel = music.kind === "playlist" ? t("playlist") : t("track");
  const known = meta?.status === "ok" ? meta : null;
  const showArt = !!known?.artworkUrl && artState !== "failed";
  const songTitle = known?.title ?? null;

  return (
    <section
      className="qs-song"
      data-variant={variant}
      data-kind={music.kind}
      data-provider={music.provider}
      data-service={service}
      data-meta={meta?.status ?? "none"}
      data-art={showArt ? artState : undefined}
      aria-label={t("title")}
      data-testid={variant === "beat" ? "greeting-music-beat" : "greeting-music-keepsake"}
      data-music-id={music.id}
      data-spotify-id={music.provider === "spotify" ? music.id : undefined}
    >
      <div className="qs-song__card">
        {showArt ? (
          // Provider artwork exactly as served: no crop, overlay, filter or animation — only scaled (Spotify Terms IV.2.2(b)).
          <span className="qs-song__cover" data-aspect={known!.artworkAspect}>
            {/* eslint-disable-next-line @next/next/no-img-element -- provider CDN image, shown as served; next/image would re-encode it */}
            <img
              ref={imgRef}
              src={known!.artworkUrl!}
              alt={songTitle ? t("artworkAlt", { title: songTitle, provider: providerName }) : ""}
              width={known!.artworkAspect === "square" ? 300 : 320}
              height={known!.artworkAspect === "square" ? 300 : 180}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setArtState("ready")}
              onError={() => setArtState("failed")}
              data-testid="music-artwork"
            />
          </span>
        ) : (
          <span className="qs-song__art" aria-hidden>
            {music.kind === "playlist" && <span className="qs-song__jacket qs-song__jacket--back" />}
            <span className="qs-song__disc">
              <span className="qs-song__label">
                <Spark className="qs-song__label-spark" />
              </span>
            </span>
            <span className="qs-song__jacket">
              <span className="qs-song__foil">
                <Spark className="qs-song__spark" />
                <span className="qs-song__jacket-name">{t("title")}</span>
              </span>
            </span>
          </span>
        )}
        <div className="qs-song__body">
          {songTitle ? (
            <>
              <p className="qs-song__kicker">{t("title")}</p>
              <h2 className="qs-song__title qs-song__title--song" dir="auto" data-testid="music-title">
                {songTitle}
              </h2>
              {known?.author && (
                <p className="qs-song__author" dir="auto" data-testid="music-author">
                  {known.author}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="qs-song__kicker">{kindLabel}</p>
              <h2 className="qs-song__title">{t("title")}</h2>
              <p className="qs-song__lede">{music.kind === "playlist" ? t("ledePlaylist") : t("ledeTrack")}</p>
            </>
          )}
          <p className="qs-song__source" data-testid="music-source">
            <span className="qs-song__source-dot" data-service={service} aria-hidden />
            {known ? t("fromProvider", { provider: providerName }) : t("onProvider", { provider: providerName })}
          </p>
        </div>
      </div>

      <div className="qs-song__actions">
        <a className="qs-song__listen" href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={pausePageMedia} data-testid="music-listen">
          {t(`listen.${service}`)}
          <span className="sr-only"> ({t("opensIn", { provider: providerName })})</span>
        </a>
        {embed && !playerOpen && (
          <button type="button" className="qs-song__here" onClick={() => setPlayerOpen(true)} data-testid="music-play-here">
            {t("playHere")}
          </button>
        )}
      </div>

      {embed && playerOpen && music.provider === "spotify" && (
        <div className="qs-song__player">
          <iframe
            title={t("playerTitle")}
            src={spotifyEmbedUrl(music)}
            width="100%"
            height={music.kind === "playlist" ? 352 : 152}
            loading="lazy"
            allow="encrypted-media; clipboard-write; fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            data-testid="music-embed"
          />
          <button type="button" className="qs-song__here" onClick={() => setPlayerOpen(false)}>
            {t("closePlayer")}
          </button>
        </div>
      )}

      <p className="qs-song__note" data-testid="music-note">
        {num && <span className="sx-num">{num}</span>}
        {meta?.status === "unavailable" ? t("unavailable", { provider: providerName }) : t(`note.${service}`)}
      </p>
    </section>
  );
}

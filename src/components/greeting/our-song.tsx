"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Spark } from "@/components/ui/logo";
import { spotifyEmbedUrl, spotifyOpenUrl, type SpotifyMusic } from "@/lib/music/spotify";

/** Pauses every <audio>/<video> on the page — the voice note, the film — so two sources never play at once. */
function pausePageMedia() {
  document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((el) => {
    if (!el.paused) el.pause();
  });
}

/**
 * "ჩვენი სიმღერა" / "Our Song": the sender's Spotify track or playlist as a
 * keepsake card — cream stock, a burgundy record with a gold label, one clear
 * action. Never a Spotify widget by default.
 *
 * - Nothing plays by itself. "Listen on Spotify" is an ordinary link to the
 *   canonical open.spotify.com URL (opens the app where installed), rebuilt
 *   from the validated id — the sender's text never reaches an href.
 *   Tapping it pauses the voice note / video on the page.
 * - We show no Spotify title, artist or cover art. Spotify's Developer
 *   Policy (IV.2, effective 15 May 2025) does not permit commercial use by
 *   developer apps beyond narrow cases, and its artwork rules require
 *   Spotify-supplied, unmodified covers with attribution — so a paid card
 *   can't fetch them without Spotify's written approval (docs/music/OUR-SONG.md).
 *   Instead the card is our own object: a QR STARR record sleeve (burgundy
 *   linen, gold foil, the spark) with the record sliding out; a playlist is
 *   two sleeves. Spotify shows the rest when it opens.
 * - `embedAllowed` (SPOTIFY_EMBED_ENABLED, off until Spotify confirms
 *   commercial use) adds an explicit "Play here" that loads the official
 *   embed only on tap. The embed's controls can't be driven without
 *   Spotify's script, so coexistence is explicit instead of pretended: the
 *   page's own audio is paused when the player opens, and the player is
 *   closed (which stops it) as soon as the voice note or video starts.
 */
export function OurSong({ music, embedAllowed = false, variant, num }: { music: SpotifyMusic; embedAllowed?: boolean; variant: "beat" | "keepsake"; num?: string }) {
  const t = useTranslations("greeting.ourSong");
  const [playerOpen, setPlayerOpen] = useState(false);

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

  let href: string;
  try {
    href = spotifyOpenUrl(music);
  } catch {
    return null; // never reached for a server-validated reference; a bad one just shows no card
  }
  const kindLabel = music.kind === "playlist" ? t("playlist") : t("track");

  return (
    <section className="qs-song" data-variant={variant} data-kind={music.kind} aria-label={t("title")} data-testid={variant === "beat" ? "greeting-music-beat" : "greeting-music-keepsake"} data-spotify-id={music.id}>
      <div className="qs-song__card">
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
        <div className="qs-song__body">
          <p className="qs-song__kicker">{kindLabel}</p>
          <h2 className="qs-song__title">{t("title")}</h2>
          <p className="qs-song__lede">{music.kind === "playlist" ? t("ledePlaylist") : t("ledeTrack")}</p>
        </div>
      </div>

      <div className="qs-song__actions">
        <a className="qs-song__listen" href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={pausePageMedia} data-testid="music-listen">
          {t("listen")}
          <span className="sr-only"> ({t("opensSpotify")})</span>
        </a>
        {embedAllowed && !playerOpen && (
          <button type="button" className="qs-song__here" onClick={() => setPlayerOpen(true)} data-testid="music-play-here">
            {t("playHere")}
          </button>
        )}
      </div>

      {embedAllowed && playerOpen && (
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

      <p className="qs-song__note">
        {num && <span className="sx-num">{num}</span>}
        {t("note")}
      </p>
    </section>
  );
}

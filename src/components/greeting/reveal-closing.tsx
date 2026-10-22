"use client";

import { forwardRef } from "react";
import { useTranslations } from "next-intl";
import { WaxSeal } from "@/components/customer/wax-seal";
import { Spark } from "@/components/ui/logo";
import type { GreetingRenderContent } from "./greeting-renderer";
import { VoicePlayer } from "./voice-player";

/**
 * The Signature closing (integration blueprint §2.7), under the world once
 * its finale has come to rest: the letter addressed "for you" (the one full,
 * real-text copy of the words — the world above is decorative), every
 * keepsake as a numbered object to return to, and the seal pressed again
 * with one closing line. In normal flow inside the scrolling stage, so it
 * can never clip or cover the world.
 *
 * Nothing autoplays: the video waits for its own controls, the voice note
 * for its play button. Plays are reported through `onPlayed` like the beats'.
 */
export const RevealClosing = forwardRef<
  HTMLElement,
  {
    content: GreetingRenderContent;
    signOff: string;
    onPlayed: (type: "video" | "audio") => void;
  }
>(function RevealClosing({ content, signOff, onPlayed }, ref) {
  const t = useTranslations("greeting");
  let n = 0;
  const num = () => String(++n).padStart(2, "0");
  const hasKeepsakes = content.photos.length > 0 || !!content.video || !!content.audio;

  return (
    <section ref={ref} className="sx-closing" aria-label={t("toLetter")} data-testid="greeting-closing" tabIndex={-1}>
      {content.message && (
        <article className="sx-letter" tabIndex={0} aria-label={t("letterLabel")} data-testid="greeting-closing-letter">
          <p className="sx-letter__for">
            <Spark />
            {t("forYou")}
          </p>
          <p className="sx-letter__text">{content.message}</p>
          {signOff && <p className="sx-letter__sign">{signOff}</p>}
        </article>
      )}

      {hasKeepsakes && (
        <div className="sx-keepsakes">
          <h2 className="sx-kicker">{t("keepsakes")}</h2>
          {content.photos.length > 0 && (
            <div className="sx-prints">
              {content.photos.map((p, i) => (
                <figure key={p.id} className="sx-print">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not eligible for next/image's remote optimizer allowlist */}
                  <img src={p.url} alt={t("photoAlt", { n: i + 1, total: content.photos.length })} loading="lazy" decoding="async" />
                  <figcaption className="sx-caption">
                    <span className="sx-num">{num()}</span>
                    {t("keepsakePhoto")}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {content.video && (
            <figure className="sx-film">
              <video src={`${content.video.url}#t=0.1`} controls playsInline preload="metadata" aria-label={t("videoLabel")} onPlay={() => onPlayed("video")} />
              <figcaption className="sx-caption">
                <span className="sx-num">{num()}</span>
                {t("keepsakeVideo")}
              </figcaption>
            </figure>
          )}
          {content.audio && (
            <div className="sx-voice">
              <VoicePlayer src={content.audio.url} durationMs={null} title={t("voiceTitle")} onPlay={() => onPlayed("audio")} />
              <p className="sx-caption">
                <span className="sx-num">{num()}</span>
                {t("keepsakeVoice")}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="sx-close">
        <span className="sx-close__seal" aria-hidden>
          <WaxSeal />
        </span>
        <p className="sx-close__title">{t("closingTitle")}</p>
        <p className="sx-close__body">{t("closingBody")}</p>
      </div>
    </section>
  );
});

"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { EventCountdown } from "@/lib/greetings/countdown";
import { formatMoment } from "@/lib/greetings/moment-format";
import { useAnchoredClock, useCountdown } from "./use-countdown";
import { RollingNumber } from "./rolling-number";
import "./event-countdown.css";

/**
 * Celebration Countdown — the sender's countdown to another day, inside an
 * already open greeting. Three art directions, each its own object with its
 * own material, so it reads the same in every world's room, light or dark:
 *
 *  - editorial  a printed page: Newsreader, a dateline, the days set large
 *               and the hours/minutes/seconds as a quiet row; digits roll.
 *  - atelier    ivory stationery: Cormorant, a champagne double rule and a
 *               drawn ornament; digits dissolve softly into the next.
 *  - midnight   a charcoal plate: gilded numerals that catch the light as
 *               they change, spaced capitals, a single pool of light.
 *
 * At the moment itself it never shows zeros or negative numbers: for a day it
 * says "today is the day", afterwards "this day came on …".
 *
 * Accessibility: role="timer" with a label that changes once a minute (not
 * every second); the ticking digits are decorative.
 */
export function EventCountdownCard({
  countdown,
  serverNow,
  size = "beat",
  now: nowProp,
}: {
  countdown: EventCountdown;
  /** The page's server time (recipient); omitted in the sender's Preview. */
  serverNow?: number;
  /** "thumb": a miniature for the sender's style picker (static, no ticking label). */
  size?: "beat" | "thumb";
  /** A shared clock (several cards on one screen); defaults to one anchored on serverNow. */
  now?: () => number;
}) {
  const t = useTranslations("countdown");
  const locale = useLocale();
  const ownClock = useAnchoredClock(serverNow);
  const now = nowProp ?? ownClock;
  const target = useMemo(() => new Date(countdown.at).getTime(), [countdown.at]);
  const { parts, phase } = useCountdown(target, now, { initialNow: serverNow });
  const when = formatMoment(countdown.at, countdown.timeZone, locale, serverNow);
  const { style } = countdown;

  const label =
    phase === "counting"
      ? t("timerLabel", { title: countdown.title, days: parts.days, hours: parts.hours, minutes: parts.minutes })
      : phase === "today"
        ? `${countdown.title}: ${t("today")}`
        : `${countdown.title}: ${t("celebrated")}, ${when.dateOnly}`;

  const units = [
    ...(parts.days > 0 ? [{ key: "d", value: parts.days, pad: 1, label: t("days", { count: parts.days }) }] : []),
    { key: "h", value: parts.hours, pad: 2, label: t("hours", { count: parts.hours }) },
    { key: "m", value: parts.minutes, pad: 2, label: t("minutes", { count: parts.minutes }) },
    { key: "s", value: parts.seconds, pad: 2, label: t("seconds", { count: parts.seconds }) },
  ];

  return (
    <section
      className="ec"
      data-style={style}
      data-phase={phase}
      data-size={size}
      data-days={parts.days > 0 || undefined}
      role={size === "thumb" ? undefined : "timer"}
      aria-label={size === "thumb" ? undefined : label}
      data-testid="event-countdown"
    >
      {style === "atelier" && <Ornament className="ec__ornament" />}
      {style === "midnight" && <span className="ec__pool" aria-hidden />}

      <div className="ec__head">
        <p className="ec__kicker">{phase === "counting" ? t("until") : t("theDay")}</p>
        <h2 className="ec__title">{countdown.title}</h2>
      </div>

      {phase === "counting" ? (
        <div className="ec__clock" aria-hidden>
          {units.map((u, i) => (
            <div key={u.key} className="ec__unit" data-unit={u.key}>
              <RollingNumber value={u.value} pad={u.pad} className="ec__num" />
              <span className="ec__label">{u.label}</span>
              {i < units.length - 1 && <span className="ec__sep" />}
            </div>
          ))}
        </div>
      ) : (
        <div className="ec__arrived" data-testid="event-countdown-arrived">
          {style === "midnight" && <Star className="ec__star" />}
          <p className="ec__arrived-line">{phase === "today" ? t("today") : t("celebrated")}</p>
        </div>
      )}

      <p className="ec__when">
        <span className="ec__day">{when.day}</span>
        <span className="ec__hour">
          {when.time}
          <span className="ec__dot" aria-hidden />
          <span className="ec__city">{when.zone}</span>
        </span>
      </p>

      {countdown.note && <p className="ec__note">{countdown.note}</p>}
      {style === "atelier" && <Ornament className="ec__ornament ec__ornament--foot" />}
    </section>
  );
}

/** A fine ruled ornament: two hairlines, a lozenge, two beads. Drawn on arrival (stroke-dashoffset). */
function Ornament({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 160 16" aria-hidden focusable="false">
      <path className="ec__draw" d="M6 8 H60 M100 8 H154" />
      <path className="ec__draw" d="M80 2.5 L85.5 8 L80 13.5 L74.5 8 Z" />
      <circle cx="67" cy="8" r="1.4" />
      <circle cx="93" cy="8" r="1.4" />
    </svg>
  );
}

/** A four-point star, gilded with the numerals' metal. */
function Star({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M12 1.5 C12.6 8.2 15.8 11.4 22.5 12 C15.8 12.6 12.6 15.8 12 22.5 C11.4 15.8 8.2 12.6 1.5 12 C8.2 11.4 11.4 8.2 12 1.5 Z" />
    </svg>
  );
}

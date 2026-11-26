"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { WaxSeal } from "@/components/customer/wax-seal";
import { RollingNumber } from "@/components/countdown/rolling-number";
import { useAnchoredClock, useCountdown } from "@/components/countdown/use-countdown";
import { DEFAULT_TEMPLATE_ID, getTemplate } from "@/lib/templates/catalog";
import { roomVars } from "@/lib/templates/room";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";
import { useChromeTint } from "@/lib/client/use-chrome-tint";
import { formatMoment, localTimeIfDifferent } from "@/lib/greetings/moment-format";
import { RevealEnvelope } from "./reveal-envelope";
import "./reveal.css";
import "./reveal-signature.css";
import "./envelope-luxe.css";
import "./scheduled-reveal.css";

/** The ribbon slips off the envelope before the greeting is fetched (reduced motion: at once). */
const RIBBON_MS = 950;
/** If the opened greeting has not arrived this long after the moment, offer to open it by hand. */
const STALL_MS = 6000;
/** Coming back to the tab re-asks the server at most this often. */
const RESYNC_MIN_MS = 15_000;

/**
 * Scheduled Reveal — the greeting is paid for, but the sender chose a later
 * moment. The recipient finds it exactly where the greeting will open: the
 * same room, the same sealed envelope, now tied with a ribbon, and a quiet
 * countdown where the Open button will be. Nothing of the greeting itself is
 * on this page: the server sent only the world, the moment and its clock
 * (lib/greetings/recipient.ts → loadScheduledGreetingShell).
 *
 * At the moment: the ribbon slips off, the line becomes "It's time", and the
 * page asks the server again (?from=lock). The server alone decides
 * (app_greeting_public_state, on the database clock): it renders the real
 * greeting — whose opening is this same envelope, so nothing jumps — or, if
 * this device was early, this screen again with a fresh clock.
 *
 * Device clock: never consulted for the moment (use-countdown.ts). Coming
 * back to the page re-renders it from the server.
 */
export function ScheduledReveal({
  themeKey,
  themeVersion,
  unlockAt,
  timeZone,
  serverNow,
  isOriginalSender,
}: {
  themeKey: string;
  themeVersion?: number;
  /** ISO instant. */
  unlockAt: string;
  timeZone: string;
  /** The database's clock when this page was rendered (ms). */
  serverNow: number;
  isOriginalSender: boolean;
}) {
  const t = useTranslations("scheduled");
  const tc = useTranslations("countdown");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const template = (themeVersion !== undefined && getTemplate(themeKey, themeVersion)) || getTemplate(themeKey) || getTemplate(DEFAULT_TEMPLATE_ID)!;
  const world = getThemeWorld(template.id, template.version);
  useChromeTint(template.spec.room.base);

  const target = Date.parse(unlockAt);
  const now = useAnchoredClock(serverNow);
  const [stage, setStage] = useState<"locked" | "unlocking" | "stalled">(serverNow >= target ? "unlocking" : "locked");
  const onZero = useCallback(() => setStage((s) => (s === "locked" ? "unlocking" : s)), []);
  const { parts } = useCountdown(target, now, { onZero, initialNow: serverNow });
  const askedRef = useRef(0);

  const askServer = useCallback(() => {
    askedRef.current = performance.now();
    const search = new URLSearchParams(window.location.search);
    if (search.get("from") === "lock") return router.refresh();
    search.set("from", "lock");
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  }, [router, pathname]);

  // The moment: let the ribbon go, then ask the server for the greeting.
  useEffect(() => {
    if (stage !== "unlocking") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const go = window.setTimeout(askServer, reduce ? 0 : RIBBON_MS);
    const stall = window.setTimeout(() => setStage("stalled"), STALL_MS);
    return () => {
      window.clearTimeout(go);
      window.clearTimeout(stall);
    };
  }, [stage, askServer]);

  // The server answered "not yet" (this device was early): count on from its fresh clock.
  useEffect(() => {
    if (serverNow < target) setStage("locked");
  }, [serverNow, target]);

  // Back from another app or a locked phone: re-render from the server (its clock, and maybe the greeting).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (performance.now() - askedRef.current < RESYNC_MIN_MS) return;
      askedRef.current = performance.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [router]);

  const when = formatMoment(unlockAt, timeZone, locale, serverNow);
  const [viewerTz, setViewerTz] = useState<string | undefined>(undefined);
  useEffect(() => setViewerTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const yours = localTimeIfDifferent(unlockAt, timeZone, locale, viewerTz);

  const arriving = stage !== "locked";
  const units = [
    ...(parts.days > 0 ? [{ key: "d", value: parts.days, pad: 1, label: tc("days", { count: parts.days }) }] : []),
    { key: "h", value: parts.hours, pad: 2, label: tc("hours", { count: parts.hours }) },
    { key: "m", value: parts.minutes, pad: 2, label: tc("minutes", { count: parts.minutes }) },
    { key: "s", value: parts.seconds, pad: 2, label: tc("seconds", { count: parts.seconds }) },
  ];
  const timerLabel = t("timerLabel", { days: parts.days, hours: parts.hours, minutes: parts.minutes, when: `${when.day}, ${when.time}` });

  return (
    <div
      className="reveal relative isolate flex h-dvh w-full flex-col overflow-hidden"
      style={{ ...worldVars(world), ...roomVars(template.spec.room) } as CSSProperties}
      data-testid="scheduled-reveal"
      data-stage="closed"
      data-lock={stage}
      data-room={template.spec.room.dark ? "dark" : "light"}
      data-composition={world.composition}
    >
      <header className="px-page relative z-20 flex flex-col gap-3 pt-[max(0.875rem,var(--safe-top))]">
        <div className="min-h-9" />
        {isOriginalSender && (
          <div className="flex justify-center">
            <div className="sx-banner" data-testid="scheduled-sender-banner" role="status">
              <WaxSeal className="sx-banner__seal" />
              <div className="min-w-0">
                <p className="sx-banner__kicker">{t("senderKicker")}</p>
                <p className="sx-banner__title">{t("senderTitle")}</p>
                <p className="sx-banner__body">{t("senderBody", { when: `${when.day}, ${when.time}` })}</p>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="reveal__stage relative z-10 flex flex-1 flex-col items-center justify-center outline-none">
        <div className="sx-opening">
          <span className="sx-light" aria-hidden />
          <h1 className="sx-opening__line srl-line" aria-live="polite">
            <span className="srl-line__a" aria-hidden={arriving || undefined}>
              {t("waiting")}
            </span>
            <span className="srl-line__b" aria-hidden={!arriving || undefined}>
              {t("itsTime")}
            </span>
          </h1>
          <RevealEnvelope state="sealed" addressee="" locked={!arriving} unlocking={arriving} onOpen={() => undefined} />
        </div>
      </main>

      <footer className="relative z-20 pt-2 pr-[max(1.5rem,var(--safe-right))] pb-[max(1.25rem,calc(var(--safe-bottom)+0.75rem))] pl-[max(1.5rem,var(--safe-left))]">
        <div className="srl-foot mx-auto flex max-w-sm flex-col items-center">
          {stage === "stalled" ? (
            <div className="flex w-full flex-col items-center gap-3">
              <button type="button" onClick={askServer} className="reveal__primary w-full" data-testid="scheduled-open-now">
                {t("openNow")}
              </button>
              <p className="reveal__hint">{t("stalledHint")}</p>
            </div>
          ) : (
            <>
              <div className="srl-clock" role="timer" aria-label={timerLabel} data-testid="scheduled-countdown">
                {units.map((u, i) => (
                  <div key={u.key} className="srl-unit" data-unit={u.key}>
                    <RollingNumber value={u.value} pad={u.pad} className="srl-num" />
                    <span className="srl-label" aria-hidden>
                      {u.label}
                    </span>
                    {i < units.length - 1 && <span className="srl-sep" aria-hidden />}
                  </div>
                ))}
              </div>
              <p className="srl-when" data-testid="scheduled-when">
                <span className="srl-when__label">{t("opensLabel")}</span>
                <span className="srl-when__day">{when.day}</span>
                <span className="srl-zone">
                  {when.time} · {when.zone}
                </span>
              </p>
              {yours && <p className="srl-yours">{t("yourTime", { time: yours })}</p>}
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

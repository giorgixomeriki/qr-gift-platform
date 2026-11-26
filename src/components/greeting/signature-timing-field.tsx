"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ErrorIcon, SuccessIcon } from "@/components/customer/icons";
import { EventCountdownCard } from "@/components/countdown/event-countdown";
import { removeCountdownAction, setCountdownAction, setScheduleAction } from "@/lib/greetings/actions";
import { COUNTDOWN_NOTE_MAX, COUNTDOWN_OCCASIONS, COUNTDOWN_STYLES, COUNTDOWN_TITLE_MAX, type CountdownOccasion, type CountdownStyle, type EventCountdown } from "@/lib/greetings/countdown";
import { COMMON_TIME_ZONES, formatMoment, zoneCity, zoneOffsetLabel } from "@/lib/greetings/moment-format";
import { COUNTDOWN_MAX_DAYS, DEFAULT_TIME_ZONE, isValidTimeZone, UNLOCK_MAX_DAYS, utcToZonedFields, zonedWallTimeToUtc } from "@/lib/greetings/schedule";
import "./signature-timing.css";

/** Edits settle for this long before they are saved (only complete, changed values are sent). */
const SAVE_MS = 700;

type Schedule = { unlockAt: string; timeZone: string } | null;
type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; code: string };

function deviceZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** "YYYY-MM-DD" for today + n days in a zone (min/max of the native date picker). */
function dayIn(tz: string, plusDays = 0): string {
  return utcToZonedFields(new Date(Date.now() + plusDays * 86_400_000), tz).date;
}

/**
 * Timing, on the Create screen: two independent choices.
 *
 *  1. When should it open? — as soon as it's sent, or at a date and time the
 *     sender picks (Scheduled Reveal). Saved through setScheduleAction; the
 *     server converts the wall time in the chosen zone and refuses the past,
 *     a skipped DST hour, or more than UNLOCK_MAX_DAYS ahead.
 *  2. A countdown to a special day (Celebration Countdown) — occasion, name,
 *     date/time/zone, one of three styles (shown as live miniatures), and an
 *     optional line. Saved through setCountdownAction.
 *
 * Native date and time inputs on purpose: on phones they open the system's
 * own wheels/calendars, which are accessible and familiar; a custom picker
 * would be worse on both counts. 16px text so iOS doesn't zoom.
 *
 * `onBlockingChange(true)` while the countdown is switched on but not yet
 * complete and saved: Continue says so instead of leaving half a countdown.
 */
export function SignatureTimingField({
  greetingId,
  schedule,
  onScheduleChange,
  countdown,
  onCountdownChange,
  onBlockingChange,
}: {
  greetingId: string;
  schedule: Schedule;
  onScheduleChange: (s: Schedule) => void;
  countdown: EventCountdown | null;
  onCountdownChange: (c: EventCountdown | null) => void;
  onBlockingChange: (blocking: boolean) => void;
}) {
  const t = useTranslations("wizard.timing");
  const tc = useTranslations("common");
  const locale = useLocale();
  const id = useId();

  // Device zone is only known in the browser; until then the saved zone (or Tbilisi) is used.
  const [zone0, setZone0] = useState(DEFAULT_TIME_ZONE);
  useEffect(() => setZone0(deviceZone()), []);

  /* ------------------------------------------------------------ 1. When it opens */
  const initialOpen = schedule ? utcToZonedFields(new Date(schedule.unlockAt), schedule.timeZone) : null;
  const [later, setLater] = useState(!!schedule);
  const [openDate, setOpenDate] = useState(initialOpen?.date ?? "");
  const [openTime, setOpenTime] = useState(initialOpen?.time ?? "10:00");
  const [openZone, setOpenZone] = useState(schedule?.timeZone ?? "");
  const [openStatus, setOpenStatus] = useState<Status>({ kind: "idle" });
  const openZoneEff = openZone || zone0;
  const savedOpenRef = useRef(schedule ? `${initialOpen!.date}|${initialOpen!.time}|${schedule.timeZone}` : "now");

  const saveSchedule = useCallback(
    async (input: { date: string; time: string; timeZone: string } | null) => {
      const key = input ? `${input.date}|${input.time}|${input.timeZone}` : "now";
      if (key === savedOpenRef.current) return;
      setOpenStatus({ kind: "saving" });
      const res = await setScheduleAction(greetingId, input).catch(() => null);
      if (!res) return setOpenStatus({ kind: "error", code: "save" });
      if (!res.ok) return setOpenStatus({ kind: "error", code: res.code ?? "save" });
      savedOpenRef.current = key;
      onScheduleChange(res.data.unlockAt ? { unlockAt: res.data.unlockAt, timeZone: res.data.timeZone! } : null);
      setOpenStatus({ kind: input ? "saved" : "idle" });
    },
    [greetingId, onScheduleChange],
  );

  useEffect(() => {
    if (!later) {
      void saveSchedule(null);
      return;
    }
    if (!openDate || !openTime) return;
    const timer = window.setTimeout(() => void saveSchedule({ date: openDate, time: openTime, timeZone: openZoneEff }), SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [later, openDate, openTime, openZoneEff, saveSchedule]);

  /* ------------------------------------------------------------ 2. Countdown */
  const initialCd = countdown ? utcToZonedFields(new Date(countdown.at), countdown.timeZone) : null;
  const [cdOn, setCdOn] = useState(!!countdown);
  const [occasion, setOccasion] = useState<CountdownOccasion>(countdown?.occasion ?? "wedding");
  const [title, setTitle] = useState(countdown?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!countdown);
  const [cdDate, setCdDate] = useState(initialCd?.date ?? "");
  const [cdTime, setCdTime] = useState(initialCd?.time ?? "12:00");
  const [cdZone, setCdZone] = useState(countdown?.timeZone ?? "");
  const [style, setStyle] = useState<CountdownStyle>(countdown?.style ?? "atelier");
  const [note, setNote] = useState(countdown?.note ?? "");
  const [cdStatus, setCdStatus] = useState<Status>({ kind: countdown ? "saved" : "idle" });
  /** Bumped to re-send an unchanged countdown (it was refused only because of the opening time, which has moved). */
  const [retry, setRetry] = useState(0);
  const cdZoneEff = cdZone || zone0;
  const savedCdRef = useRef(countdown ? JSON.stringify([countdown.title, initialCd!.date, initialCd!.time, countdown.timeZone, countdown.style, countdown.note ?? "", countdown.occasion]) : "");

  const cdKey = JSON.stringify([title.replace(/\s+/g, " ").trim(), cdDate, cdTime, cdZoneEff, style, note.replace(/\s+/g, " ").trim(), occasion]);
  const cdComplete = !!title.trim() && !!cdDate && !!cdTime;

  useEffect(() => {
    if (!cdOn || !cdComplete || cdKey === savedCdRef.current) return;
    const timer = window.setTimeout(async () => {
      setCdStatus({ kind: "saving" });
      const res = await setCountdownAction(greetingId, { title, date: cdDate, time: cdTime, timeZone: cdZoneEff, style, note, occasion }).catch(() => null);
      if (!res) return setCdStatus({ kind: "error", code: "save" });
      if (!res.ok) return setCdStatus({ kind: "error", code: res.code ?? "save" });
      savedCdRef.current = cdKey;
      onCountdownChange(res.data);
      setCdStatus({ kind: "saved" });
    }, SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [cdOn, cdComplete, cdKey, greetingId, title, cdDate, cdTime, cdZoneEff, style, note, occasion, onCountdownChange, retry]);

  // A countdown refused only because it came before the opening is re-tried when the opening moves.
  const lastScheduleRef = useRef(schedule);
  useEffect(() => {
    if (lastScheduleRef.current === schedule) return;
    lastScheduleRef.current = schedule;
    if (cdStatus.kind === "error" && cdStatus.code === "before_unlock") setRetry((n) => n + 1);
  }, [schedule, cdStatus]);

  const toggleCountdown = useCallback(async () => {
    if (cdOn) {
      setCdOn(false);
      setCdStatus({ kind: "idle" });
      if (savedCdRef.current) {
        const res = await removeCountdownAction(greetingId).catch(() => null);
        if (!res?.ok) {
          setCdOn(true);
          return setCdStatus({ kind: "error", code: "save" });
        }
        savedCdRef.current = "";
      }
      onCountdownChange(null);
    } else {
      setCdOn(true);
      if (!title) setTitle(t(`occasionTitles.${occasion}`));
    }
  }, [cdOn, greetingId, onCountdownChange, occasion, t, title]);

  const pickOccasion = (o: CountdownOccasion) => {
    setOccasion(o);
    // The suggested name follows the occasion until the sender writes their own.
    const suggestions = COUNTDOWN_OCCASIONS.map((k) => t(`occasionTitles.${k}`));
    if (!title.trim() || suggestions.includes(title.trim())) setTitle(t(`occasionTitles.${o}`));
  };

  const blocking = cdOn && (cdStatus.kind !== "saved" || cdKey !== savedCdRef.current);
  useEffect(() => onBlockingChange(blocking), [blocking, onBlockingChange]);

  /* ------------------------------------------------------------ Miniatures + summaries */
  const previewAt = useMemo(() => {
    const z = cdDate && cdTime ? zonedWallTimeToUtc(cdDate, cdTime, cdZoneEff) : null;
    return z?.ok ? z.instant.toISOString() : new Date(Date.now() + 42 * 86_400_000 + 7 * 3_600_000).toISOString();
  }, [cdDate, cdTime, cdZoneEff]);
  const miniatureFor = (s: CountdownStyle): EventCountdown => ({
    title: title.trim() || t("eventTitlePlaceholder"),
    at: previewAt,
    timeZone: cdZoneEff,
    style: s,
    note: null,
    occasion,
  });

  const openSummary = useMemo(() => {
    if (!later || !openDate || !openTime) return null;
    const z = zonedWallTimeToUtc(openDate, openTime, openZoneEff);
    if (!z.ok) return null;
    const m = formatMoment(z.instant.toISOString(), openZoneEff, locale);
    return { text: t("opensSummary", { day: m.day, time: m.time, zone: m.zone }), past: z.instant.getTime() < Date.now() };
  }, [later, openDate, openTime, openZoneEff, locale, t]);

  const errorText = (code: string, maxDays: number) => (code === "too_far" ? t("errors.too_far", { days: maxDays }) : t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.save"));

  return (
    <div className="sigt" data-testid="timing-field">
      {/* ---------------------------------------------------- When should it open? */}
      <section className="sigt-block" aria-labelledby={`${id}-open`}>
        <div className="sigf-memories__head">
          <h2 id={`${id}-open`} className="sig-kicker">
            {t("openTitle")}
          </h2>
        </div>
        <div className="sigt-choice" role="radiogroup" aria-labelledby={`${id}-open`}>
          {(["now", "later"] as const).map((v) => {
            const checked = (v === "later") === later;
            return (
              <label key={v} className="sigt-option" data-checked={checked || undefined} data-testid={`open-${v}`}>
                <input type="radio" name={`${id}-open`} value={v} checked={checked} onChange={() => setLater(v === "later")} className="sigt-option__input" />
                <span className="sigt-option__mark" aria-hidden />
                <span className="sigt-option__text">
                  <b>{v === "now" ? t("openNow") : t("openLater")}</b>
                  <small>{v === "now" ? t("openNowHint") : t("openLaterHint")}</small>
                </span>
              </label>
            );
          })}
        </div>

        {later && (
          <div className="sigt-panel" data-testid="open-later-panel">
            <div className="sigt-when">
              <label className="sigt-field sigt-field--date">
                <span>{t("date")}</span>
                <input type="date" value={openDate} min={dayIn(openZoneEff)} max={dayIn(openZoneEff, UNLOCK_MAX_DAYS - 1)} onChange={(e) => setOpenDate(e.target.value)} className="sigt-input" required data-testid="open-date" />
              </label>
              <label className="sigt-field sigt-field--time">
                <span>{t("time")}</span>
                <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className="sigt-input" required data-testid="open-time" />
              </label>
              <ZoneSelect label={t("zone")} value={openZoneEff} device={zone0} locale={locale} onChange={setOpenZone} testId="open-zone" />
            </div>
            <StatusLine status={openStatus} summary={openSummary?.text ?? null} warn={openSummary?.past ? t("pastWarning") : null} errorText={(c) => errorText(c, UNLOCK_MAX_DAYS)} savedLabel={t("saved")} savingLabel={t("saving")} testId="open-status" />
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- Countdown to a special day */}
      <section className="sigt-block" aria-labelledby={`${id}-cd`}>
        <div className="sigt-cd-head">
          <div className="min-w-0">
            <h2 id={`${id}-cd`} className="sig-kicker">
              {t("countdownTitle")}
            </h2>
            <p className="sigt-hint">{t("countdownHint")}</p>
          </div>
          <button type="button" role="switch" aria-checked={cdOn} aria-label={t("countdownToggle")} className="sigt-switch" onClick={() => void toggleCountdown()} data-testid="countdown-toggle">
            <span aria-hidden />
          </button>
        </div>

        {cdOn && (
          <div className="sigt-panel" data-testid="countdown-panel">
            <fieldset className="sigt-occasions">
              <legend className="sigt-label">{t("occasion")}</legend>
              <div className="sigt-chips">
                {COUNTDOWN_OCCASIONS.map((o) => (
                  <label key={o} className="sigt-chip" data-checked={occasion === o || undefined}>
                    <input type="radio" name={`${id}-occasion`} value={o} checked={occasion === o} onChange={() => pickOccasion(o)} />
                    {t(`occasions.${o}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="sigt-field">
              <span>{t("eventTitle")}</span>
              <input
                type="text"
                value={title}
                maxLength={COUNTDOWN_TITLE_MAX}
                placeholder={t("eventTitlePlaceholder")}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setTitleTouched(true)}
                aria-invalid={(titleTouched && !title.trim()) || undefined}
                className="sigt-input"
                autoCapitalize="sentences"
                enterKeyHint="next"
                data-testid="countdown-title"
              />
            </label>
            {titleTouched && !title.trim() && (
              <p className="sigt-status" role="alert" data-tone="error">
                <ErrorIcon size={14} weight="fill" aria-hidden />
                {t("errors.titleRequired")}
              </p>
            )}

            <div className="sigt-when">
              <label className="sigt-field sigt-field--date">
                <span>{t("date")}</span>
                <input type="date" value={cdDate} min={dayIn(cdZoneEff)} max={dayIn(cdZoneEff, COUNTDOWN_MAX_DAYS - 1)} onChange={(e) => setCdDate(e.target.value)} className="sigt-input" required data-testid="countdown-date" />
              </label>
              <label className="sigt-field sigt-field--time">
                <span>{t("time")}</span>
                <input type="time" value={cdTime} onChange={(e) => setCdTime(e.target.value)} className="sigt-input" required data-testid="countdown-time" />
              </label>
              <ZoneSelect label={t("zone")} value={cdZoneEff} device={zone0} locale={locale} onChange={setCdZone} testId="countdown-zone" />
            </div>

            <fieldset className="sigt-styles">
              <legend className="sigt-label">{t("style")}</legend>
              <div className="sigt-style-grid">
                {COUNTDOWN_STYLES.map((s) => (
                  <label key={s} className="sigt-style" data-checked={style === s || undefined} data-testid={`countdown-style-${s}`}>
                    <input type="radio" name={`${id}-style`} value={s} checked={style === s} onChange={() => setStyle(s)} />
                    <span className="sigt-style__stage" data-style={s} aria-hidden>
                      <EventCountdownCard countdown={miniatureFor(s)} size="thumb" />
                    </span>
                    <span className="sigt-style__name">{t(`styles.${s}`)}</span>
                    <span className="sigt-style__hint">{t(`styleHints.${s}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="sigt-field">
              <span>
                {t("note")} <small className="sig-caption">· {tc("optional")}</small>
              </span>
              <textarea value={note} maxLength={COUNTDOWN_NOTE_MAX} rows={2} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} className="sigt-input sigt-input--area" data-testid="countdown-note" />
            </label>

            <StatusLine status={cdStatus} summary={null} warn={null} errorText={(c) => errorText(c, COUNTDOWN_MAX_DAYS)} savedLabel={t("saved")} savingLabel={t("saving")} testId="countdown-status" />
          </div>
        )}
      </section>
    </div>
  );
}

function ZoneSelect({ label, value, device, locale, onChange, testId }: { label: string; value: string; device: string; locale: string; onChange: (tz: string) => void; testId: string }) {
  const zones = useMemo(() => {
    const list: string[] = [...COMMON_TIME_ZONES];
    for (const z of [device, value]) if (z && !list.includes(z)) list.unshift(z);
    return list;
  }, [device, value]);
  return (
    <label className="sigt-field sigt-field--zone">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="sigt-input sigt-select" data-testid={testId}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {zoneCity(z, locale)} · {zoneOffsetLabel(z)}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusLine({
  status,
  summary,
  warn,
  errorText,
  savedLabel,
  savingLabel,
  testId,
}: {
  status: Status;
  summary: string | null;
  warn: string | null;
  errorText: (code: string) => string;
  savedLabel: string;
  savingLabel: string;
  testId: string;
}) {
  if (status.kind === "error")
    return (
      <p className="sigt-status" role="alert" data-tone="error" data-testid={testId} data-code={status.code}>
        <ErrorIcon size={14} weight="fill" aria-hidden />
        {errorText(status.code)}
      </p>
    );
  return (
    <p className="sigt-status" role="status" data-testid={testId} data-state={status.kind}>
      {status.kind === "saved" && <SuccessIcon size={14} weight="fill" aria-hidden />}
      <span>
        {summary && <span className="sigt-summary">{summary}</span>}
        {summary && status.kind !== "idle" && " · "}
        {status.kind === "saving" ? savingLabel : status.kind === "saved" ? savedLabel : null}
        {warn && <span className="sigt-warn">{warn}</span>}
      </span>
    </p>
  );
}

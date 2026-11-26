"use client";

import { useMemo, type CSSProperties } from "react";
import { RecipientView, ScheduledReveal } from "@/components/greeting/card-states";
import { EventCountdownCard } from "./event-countdown";
import { COUNTDOWN_STYLES, type CountdownStyle, type EventCountdown } from "@/lib/greetings/countdown";
import { getTemplate } from "@/lib/templates/catalog";
import { roomVars } from "@/lib/templates/room";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";
import "@/components/greeting/reveal.css";
import "@/components/greeting/reveal-signature.css";

/** Lab only (NEXT_PUBLIC_LAB=1): the three countdown styles, the beat in a real world's room, and the Scheduled Reveal with mock data. */

type Phase = "counting" | "today" | "celebrated";
function mock(style: CountdownStyle, phase: Phase, title: string, note: string | null, base: number): EventCountdown {
  const at = phase === "counting" ? base + 41 * 86_400_000 + 7 * 3_600_000 + 23 * 60_000 + 9_000 : phase === "today" ? base - 3 * 3_600_000 : base - 9 * 86_400_000;
  return { title, at: new Date(at).toISOString(), timeZone: "Asia/Tbilisi", style, note, occasion: "wedding" };
}

/** One world's room around the countdown, exactly as the beat sets it. */
function Room({ theme, children }: { theme: string; children: React.ReactNode }) {
  const template = getTemplate(theme)!;
  return (
    <div
      className="reveal relative isolate flex min-h-dvh w-full flex-col items-center justify-center px-5 py-10"
      style={{ ...worldVars(getThemeWorld(theme)), ...roomVars(template.spec.room) } as CSSProperties}
      data-room={template.spec.room.dark ? "dark" : "light"}
    >
      <div className="reveal__countdown">{children}</div>
    </div>
  );
}

export function CountdownBeatLab({ theme, style, phase, title, note, serverNow }: { theme: string; style: CountdownStyle; phase: Phase; title: string; note: string | null; serverNow: number }) {
  const c = useMemo(() => mock(style, phase, title, note, serverNow), [style, phase, title, note, serverNow]);
  return (
    <div data-testid="countdown-lab">
      <Room theme={theme}>
        <EventCountdownCard countdown={c} serverNow={serverNow} />
      </Room>
    </div>
  );
}

export function CountdownSheetLab({ title, note, serverNow }: { title: string; note: string | null; serverNow: number }) {
  return (
    <div style={{ display: "grid", gap: 0 }} data-testid="countdown-lab">
      {COUNTDOWN_STYLES.map((s) => (
        <div key={s} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 22rem), 1fr))" }}>
          {(["counting", "today", "celebrated"] as const).map((p) => (
            <Room key={p} theme={p === "counting" ? "romantic" : p === "today" ? "elegant" : "minimal"}>
              <EventCountdownCard countdown={mock(s, p, title, note, serverNow)} serverNow={serverNow} />
            </Room>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ScheduledLab({ theme, unlockAt, serverNow, opened, sender, countdown }: { theme: string; unlockAt: string; serverNow: number; opened: boolean; sender: boolean; countdown: CountdownStyle | null }) {
  if (opened) {
    return (
      <RecipientView
        greetingId="lab-scheduled"
        themeKey={theme}
        isOriginalSender={false}
        arrivedFromLock
        serverNow={serverNow}
        content={{
          message: "ჩემო ძვირფასო ნინო,\n\nდღეს მინდა გითხრა ის, რასაც ყოველდღე ვფიქრობ.\n\nშენი გიორგი",
          photos: [],
          video: null,
          audio: null,
          countdown: countdown ? mock(countdown, "counting", "ჩვენი ქორწილი", "მოუთმენლად გელოდები.", serverNow) : null,
        }}
      />
    );
  }
  return <ScheduledReveal themeKey={theme} unlockAt={unlockAt} timeZone="Asia/Tbilisi" serverNow={serverNow} isOriginalSender={sender} />;
}

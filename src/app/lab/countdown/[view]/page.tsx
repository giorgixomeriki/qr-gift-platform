import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CountdownBeatLab, CountdownSheetLab, ScheduledLab } from "@/components/countdown/countdown-lab";
import { COUNTDOWN_STYLES, type CountdownStyle } from "@/lib/greetings/countdown";

const THEMES = ["romantic", "birthday", "wedding", "celebration", "elegant", "minimal", "luxury-vintage"];

/**
 * Countdown lab (mock data). 404 unless NEXT_PUBLIC_LAB=1 at build time.
 *   /lab/countdown/sheet                                   all three styles × counting / today / celebrated
 *   /lab/countdown/beat?style=&theme=&phase=&long=1        one countdown in a world's room, as the beat shows it
 *   /lab/countdown/scheduled?theme=&in=<seconds>&sender=1&cd=<style>
 *                                                          the Scheduled Reveal; at zero it asks the "server" (this page) again, which then opens the greeting
 */
export const metadata: Metadata = { title: "Countdown lab", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ view: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_LAB !== "1") notFound();
  const { view } = await params;
  const q = await searchParams;
  const now = Date.now();
  const long = q.long === "1";
  const title = long ? "ჩვენი ქორწილი თბილისში, ძველ სასახლეში, ყველა მეგობართან ერთად" : q.en === "1" ? "Our wedding" : "ჩვენი ქორწილი";
  const note = q.note === "0" ? null : q.en === "1" ? "I can't wait to see you there." : "მოუთმენლად გელოდები.";
  const theme = THEMES.includes(q.theme ?? "") ? q.theme! : "romantic";
  if (view === "sheet") return <CountdownSheetLab title={title} note={note} serverNow={now} />;
  if (view === "beat") {
    const style = (COUNTDOWN_STYLES as readonly string[]).includes(q.style ?? "") ? (q.style as CountdownStyle) : "atelier";
    const phase = q.phase === "today" || q.phase === "celebrated" ? q.phase : "counting";
    return <CountdownBeatLab theme={theme} style={style} phase={phase} title={title} note={note} serverNow={now} />;
  }
  if (view === "scheduled") {
    // The lab's "server": the moment is carried in the URL (?at=), so asking again after it has passed opens the greeting.
    if (!q.at) {
      const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => typeof e[1] === "string"));
      next.set("at", String(now + (Number(q.in) || (3 * 86_400_000) / 1000) * 1000));
      redirect(`/lab/countdown/scheduled?${next.toString()}`);
    }
    const at = Number(q.at);
    const cd = (COUNTDOWN_STYLES as readonly string[]).includes(q.cd ?? "") ? (q.cd as CountdownStyle) : null;
    return <ScheduledLab theme={theme} unlockAt={new Date(at).toISOString()} serverNow={now} opened={now >= at} sender={q.sender === "1"} countdown={cd} />;
  }
  notFound();
}

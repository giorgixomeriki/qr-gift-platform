import { cityOfZone, wallTimeIn } from "./schedule";

const MONTHS = {
  ka: ["იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი", "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
const WEEKDAYS = {
  ka: ["კვირა", "ორშაბათი", "სამშაბათი", "ოთხშაბათი", "ხუთშაბათი", "პარასკევი", "შაბათი"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * How a scheduled moment is written for people, in the zone it was chosen in:
 * "Saturday 14 February · 20:00" / "შაბათი, 14 თებერვალი · 20:00" (the year
 * only when it isn't this year), plus the zone. Pure and deterministic:
 * month and weekday names come from the tables above, not from the device's
 * locale data (some browsers ship without Georgian and would fall back to
 * English, and the server and the phone must render the same text). Intl is
 * used only for the zone arithmetic.
 */
export function formatMoment(instantIso: string, tz: string, locale: string, nowMs: number = Date.now()) {
  const lang = locale === "ka" ? "ka" : "en";
  const w = wallTimeIn(new Date(instantIso).getTime(), tz);
  const weekday = WEEKDAYS[lang][new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay()]!;
  const month = MONTHS[lang][w.mo - 1]!;
  const sameYear = w.y === wallTimeIn(nowMs, tz).y;
  const dateOnly = lang === "ka" ? `${w.d} ${month}, ${w.y}` : `${w.d} ${month} ${w.y}`;
  const dayMonth = `${w.d} ${month}`;
  const day = lang === "ka" ? `${weekday}, ${sameYear ? dayMonth : dateOnly}` : `${weekday} ${sameYear ? dayMonth : dateOnly}`;
  return { day, time: `${pad2(w.h)}:${pad2(w.mi)}`, dateOnly, city: zoneCity(tz, locale), zone: zoneTimePhrase(tz, locale) };
}

/** Georgian genitive forms (for "… დროით", "in … time"). */
const KA_CITIES_GEN: Record<string, string> = {
  "Asia/Tbilisi": "თბილისის",
  "Europe/London": "ლონდონის",
  "Europe/Berlin": "ბერლინის",
  "Europe/Paris": "პარიზის",
  "Europe/Athens": "ათენის",
  "Europe/Istanbul": "სტამბოლის",
  "Europe/Kyiv": "კიევის",
  "Europe/Moscow": "მოსკოვის",
  "Asia/Dubai": "დუბაის",
  "America/New_York": "ნიუ-იორკის",
  "America/Chicago": "ჩიკაგოს",
  "America/Los_Angeles": "ლოს-ანჯელესის",
  "Europe/Madrid": "მადრიდის",
  "Europe/Rome": "რომის",
  "Europe/Warsaw": "ვარშავის",
  "Asia/Tokyo": "ტოკიოს",
  "Australia/Sydney": "სიდნეის",
  "Asia/Yerevan": "ერევნის",
  "Asia/Baku": "ბაქოს",
  "Europe/Vienna": "ვენის",
  "Europe/Amsterdam": "ამსტერდამის",
  "Europe/Prague": "პრაღის",
  "Asia/Jerusalem": "იერუსალიმის",
  "America/Toronto": "ტორონტოს",
};

/** "Tbilisi time" / "თბილისის დროით"; zones without a Georgian name read "დრო: Lisbon". */
export function zoneTimePhrase(tz: string, locale: string): string {
  if (locale !== "ka") return `${cityOfZone(tz)} time`;
  const gen = KA_CITIES_GEN[tz];
  return gen ? `${gen} დროით` : `დრო: ${cityOfZone(tz)}`;
}

/** The same instant on the viewer's own clock, or null when the viewer is in the same zone (or the zone is unknown). */
export function localTimeIfDifferent(instantIso: string, tz: string, locale: string, viewerTz: string | undefined): string | null {
  if (!viewerTz || viewerTz === tz) return null;
  const t = new Date(instantIso).getTime();
  const a = wallTimeIn(t, tz);
  const b = wallTimeIn(t, viewerTz);
  if (a.h === b.h && a.mi === b.mi && a.d === b.d) return null;
  const time = `${pad2(b.h)}:${pad2(b.mi)}`;
  if (a.d === b.d && a.mo === b.mo) return time;
  const lang = locale === "ka" ? "ka" : "en";
  return `${b.d} ${MONTHS[lang][b.mo - 1]}, ${time}`;
}

const KA_CITIES: Record<string, string> = {
  "Asia/Tbilisi": "თბილისი",
  "Europe/London": "ლონდონი",
  "Europe/Berlin": "ბერლინი",
  "Europe/Paris": "პარიზი",
  "Europe/Athens": "ათენი",
  "Europe/Istanbul": "სტამბოლი",
  "Europe/Kyiv": "კიევი",
  "Europe/Moscow": "მოსკოვი",
  "Asia/Dubai": "დუბაი",
  "America/New_York": "ნიუ-იორკი",
  "America/Chicago": "ჩიკაგო",
  "America/Los_Angeles": "ლოს-ანჯელესი",
  "Europe/Madrid": "მადრიდი",
  "Europe/Rome": "რომი",
  "Europe/Warsaw": "ვარშავა",
  "Asia/Tokyo": "ტოკიო",
  "Australia/Sydney": "სიდნეი",
  "Asia/Yerevan": "ერევანი",
  "Asia/Baku": "ბაქო",
  "Europe/Vienna": "ვენა",
  "Europe/Amsterdam": "ამსტერდამი",
  "Europe/Prague": "პრაღა",
  "Asia/Jerusalem": "იერუსალიმი",
  "America/Toronto": "ტორონტო",
};

/** "Tbilisi" / "თბილისი" for a zone; the IANA city for zones without a Georgian name. */
export function zoneCity(tz: string, locale: string): string {
  if (locale === "ka" && KA_CITIES[tz]) return KA_CITIES[tz]!;
  return cityOfZone(tz);
}

/** The zones offered first in the sender's picker (Georgia, then where Georgians most often send from). */
export const COMMON_TIME_ZONES = [
  "Asia/Tbilisi",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Warsaw",
  "Europe/Kyiv",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Yerevan",
  "Asia/Baku",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Toronto",
  "Australia/Sydney",
] as const;

/** "GMT+4" for a zone at an instant. */
export function zoneOffsetLabel(tz: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

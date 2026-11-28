/** Date + time in the business time zone (Tbilisi), for operator screens. */
export function formatBusinessDateTime(date: Date, locale: string): string {
  return date.toLocaleString(locale === "ka" ? "ka-GE" : "en-GB", { timeZone: "Asia/Tbilisi", dateStyle: "medium", timeStyle: "short" });
}

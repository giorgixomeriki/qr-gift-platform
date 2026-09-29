"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isLocale, LOCALE_COOKIE } from "./config";
import { env } from "@/lib/env";

export async function setLocaleAction(locale: string, path: string): Promise<void> {
  if (!isLocale(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    // Not HttpOnly on purpose — this is a UI preference, not a secret, and
    // some client code may want to read it; sameSite=lax matches the app's
    // other non-sensitive cookies.
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  // "layout", not the default "page": getLocale() runs in the ROOT layout
  // (src/app/layout.tsx), not in any page component. revalidatePath(path)
  // alone only busts the page segment's cache, leaving the layout — and the
  // messages/locale it hands to NextIntlClientProvider — stale, so a locale
  // switch would silently do nothing on the very next render.
  revalidatePath(path, "layout");
}

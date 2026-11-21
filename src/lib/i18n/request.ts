import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

/**
 * Locale is deliberately NOT part of the URL: the permanent public QR URL
 * (`/g/{token}`) must stay identical regardless of language (architecture plan
 * §5, §15). This resolves a locale for the surrounding app chrome (partner/admin
 * dashboards) from a cookie, then Accept-Language, then the default.
 *
 * The sender/recipient surfaces do NOT use this — they render in the greeting's
 * own `locale` column (or the partner's `defaultLocale` before one is set),
 * fetched explicitly per-request, since that locale belongs to the QR/greeting,
 * not to the visiting browser's preference.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  let locale: Locale = defaultLocale;
  if (isLocale(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const acceptLanguage = (await headers()).get("accept-language");
    const preferred = acceptLanguage?.split(",")[0]?.split("-")[0];
    if (isLocale(preferred)) locale = preferred;
  }

  // messages/site/<locale>.json holds the public information pages' copy
  // (site, about, service, pricing, contact, refunds, privacy, terms): long
  // form, so kept apart from the app's UI strings. Namespaces never overlap
  // (scripts/verify-site-content.ts).
  const [app, site] = await Promise.all([import(`../../messages/${locale}.json`), import(`../../messages/site/${locale}.json`)]);
  return { locale, messages: { ...app.default, ...site.default } };
});

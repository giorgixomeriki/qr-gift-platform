import type { Metadata, Viewport } from "next";
import { preload } from "react-dom";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";

// Fonts are self-hosted from /public/fonts via @font-face in globals.css — not
// next/font/google — so a production build never depends on build-time
// network access to fonts.gstatic.com. Only the two UI files every screen
// needs are preloaded; serif display faces load on demand via unicode-range.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    description: t("tagline"),
    // Default-deny indexing everywhere: greeting content is private (architecture
    // plan §27) and there's no public marketing surface yet. Override per-route
    // if/when one exists.
    robots: { index: false, follow: false },
  };
}

// The information pages render on the server, and their copy carries internal
// review and decision notes, so it must never be serialized into the HTML
// payload that client components receive.
const SERVER_ONLY_NAMESPACES = new Set(["about", "service", "pricing", "contact", "refunds", "privacy", "terms"]);

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf7f2",
  // Android Chrome: the on-screen keyboard resizes the layout viewport (as it
  // did before Chrome 108), so dvh shrinks and the sticky Continue sits just
  // above the keyboard instead of behind it. iOS Safari ignores this and
  // overlays the keyboard; its accessory bar's Done restores the layout.
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const clientMessages = Object.fromEntries(Object.entries(messages).filter(([namespace]) => !SERVER_ONLY_NAMESPACES.has(namespace)));
  preload("/fonts/google-sans-latin.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  preload("/fonts/google-sans-georgian.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });

  return (
    <html lang={locale} className="h-full">
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider messages={clientMessages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

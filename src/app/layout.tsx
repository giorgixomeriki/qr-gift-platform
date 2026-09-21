import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";

// System font stacks, not next/font/google (Geist/Playfair Display/Baloo 2
// previously). A production build must not depend on build-time network
// access to fonts.gstatic.com — this repo already has one documented
// network/tooling fragility (the Next.js 16 Turbopack build bug, see
// README); it doesn't need a second one. The four CSS custom properties
// below (--font-geist-sans/mono, --font-serif, --font-display) are the same
// ones globals.css and lib/themes/registry.ts already reference, so no other
// file needed to change.

export const metadata: Metadata = {
  title: "QR Gift",
  description: "Digital greetings for physical gifts.",
  // Default-deny indexing everywhere: greeting content is private (architecture
  // plan §27) and there's no public marketing surface yet. Override per-route
  // if/when one exists.
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

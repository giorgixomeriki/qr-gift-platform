import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("qr");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-950 p-8 text-center text-neutral-200">
      <p className="text-lg">{t("notFoundTitle")}</p>
      <p className="max-w-xs text-sm text-neutral-500">{t("notFoundBody")}</p>
    </main>
  );
}

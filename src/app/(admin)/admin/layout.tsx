import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    return <div className="flex min-h-screen flex-col bg-neutral-950">{children}</div>;
  }

  const t = await getTranslations("nav");

  return (
    <div className="flex min-h-screen flex-col bg-neutral-900 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <nav className="flex items-center gap-4">
          <span className="text-sm font-semibold">{t("adminBrand")}</span>
          <Link href="/admin/dashboard" className="text-sm text-neutral-400 hover:text-neutral-100">
            {t("dashboard")}
          </Link>
          <Link href="/admin/partners" className="text-sm text-neutral-400 hover:text-neutral-100">
            {t("partners")}
          </Link>
          <Link href="/admin/moderation" className="text-sm text-neutral-400 hover:text-neutral-100">
            {t("moderation")}
          </Link>
        </nav>
        <form action={signOutAction.bind(null, "/admin/login")}>
          <button type="submit" className="text-sm text-neutral-400 hover:text-neutral-100">
            {t("signOut")}
          </button>
        </form>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

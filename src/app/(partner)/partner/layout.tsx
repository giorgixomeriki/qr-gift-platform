import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Partner dashboard chrome. Deliberately its own layout, isolated from the
 * bare root layout the sender/recipient surfaces use — this is a "professional
 * operational dashboard" (architecture plan §20), not the emotional surface.
 * The login page lives under this same layout, so it stays chrome-free by
 * checking session state here rather than needing a second layout.
 */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    return <div className="flex min-h-screen flex-col bg-neutral-950">{children}</div>;
  }

  const t = await getTranslations("nav");

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
        <span className="text-sm font-semibold text-neutral-800">{t("partnerBrand")}</span>
        <form action={signOutAction.bind(null, "/partner/login")}>
          <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-800">
            {t("signOut")}
          </button>
        </form>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

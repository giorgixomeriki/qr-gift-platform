import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { checkIsAdmin } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { listPartners } from "@/lib/partners/service";
import { CreatePartnerForm } from "@/components/admin/create-partner-form";

export default async function AdminPartnersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("admin");
  // Same graceful-degradation guard as the dashboard: a signed-in non-admin
  // sees a plain message instead of requireAdmin's UnauthorizedError crashing
  // into an unhandled server exception / generic error page.
  const isAdmin = await checkIsAdmin(user.id);
  if (!isAdmin) {
    return <p className="text-sm text-neutral-400">{t("notAdmin", { email: user.email ?? "" })}</p>;
  }

  const partners = await requireAdmin((tx) => listPartners(tx));
  const tp = await getTranslations("admin.partnersPage");
  const tStatus = await getTranslations("enums.partnerStatus");

  return (
    <div className="flex flex-col gap-6" data-testid="admin-partners-page">
      <div>
        <h1 className="text-lg font-medium text-neutral-100">{tp("title")}</h1>
        <p className="text-sm text-neutral-500">{tp("total", { count: partners.length })}</p>
      </div>

      <CreatePartnerForm />

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-neutral-500">
            <th className="py-1">{tp("tableName")}</th>
            <th className="py-1">{tp("tableSlug")}</th>
            <th className="py-1">{tp("tableCommission")}</th>
            <th className="py-1">{tp("tableStatus")}</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((p) => (
            <tr key={p.id} className="border-t border-neutral-800" data-testid="partner-row">
              <td className="py-2">
                <Link href={`/admin/partners/${p.id}`} className="underline hover:text-neutral-300">
                  {p.name}
                </Link>
              </td>
              <td className="py-2 font-mono text-xs text-neutral-400">{p.slug}</td>
              <td className="py-2">{(p.commissionRateBps / 100).toFixed(1)}%</td>
              <td className="py-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    p.status === "ACTIVE" ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"
                  }`}
                >
                  {tStatus(p.status)}
                </span>
              </td>
            </tr>
          ))}
          {partners.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-xs text-neutral-500">
                {tp("empty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Store } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { checkIsAdmin } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { listPartners } from "@/lib/partners/service";
import { CreatePartnerForm } from "@/components/admin/create-partner-form";
import { NotAdmin } from "@/components/admin/not-admin";
import { Badge, EmptyState, PageHeader, Panel, table } from "@/components/dashboard/ui";

export default async function AdminPartnersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("admin");
  // Same graceful-degradation guard as the dashboard: a signed-in non-admin
  // sees a plain message instead of requireAdmin's UnauthorizedError crashing
  // into an unhandled server exception / generic error page.
  const isAdmin = await checkIsAdmin(user.id);
  if (!isAdmin) return <NotAdmin message={t("notAdmin", { email: user.email ?? "" })} />;

  const partners = await requireAdmin((tx) => listPartners(tx));
  const tp = await getTranslations("admin.partnersPage");
  const tStatus = await getTranslations("enums.partnerStatus");

  return (
    <div className="flex flex-col gap-8" data-testid="admin-partners-page">
      <PageHeader title={tp("title")} description={tp("total", { count: partners.length })} />

      <Panel title={tp("createTitle")}>
        <CreatePartnerForm />
      </Panel>

      <Panel flush>
        {partners.length === 0 ? (
          <EmptyState icon={<Store aria-hidden />} title={tp("empty")} />
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>{tp("tableName")}</th>
                  <th className={table.th}>{tp("tableSlug")}</th>
                  <th className={`${table.th} text-right`}>{tp("tableCommission")}</th>
                  <th className={table.th}>{tp("tableStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id} className={table.tr} data-testid="partner-row">
                    <td className={table.td}>
                      <Link href={`/admin/partners/${p.id}`} className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                        {p.name}
                      </Link>
                    </td>
                    <td className={`${table.td} font-mono text-caption text-ink-3`}>{p.slug}</td>
                    <td className={`${table.td} text-right tabular-nums`}>{(p.commissionRateBps / 100).toFixed(1)}%</td>
                    <td className={table.td}>
                      <Badge tone={p.status === "ACTIVE" ? "success" : "danger"}>{tStatus(p.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

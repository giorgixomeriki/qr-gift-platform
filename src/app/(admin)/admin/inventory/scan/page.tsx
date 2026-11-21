import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAdmin, requireAdminPage } from "@/lib/auth/admin";
import { getCentralStockPartner, listAssignablePartners } from "@/lib/qr/handovers";
import { publicEnv } from "@/lib/env.public";
import { NotAdmin } from "@/components/admin/not-admin";
import { ScanAssign } from "@/components/admin/scan-assign";
import { PageHeader } from "@/components/dashboard/ui";

/** Option B: scan physical cards and create a handover (camera allowed on this path only, next.config.ts). */
export default async function AdminScanAssignPage() {
  const { user, isAdmin } = await requireAdminPage();
  const tAdmin = await getTranslations("admin");
  if (!isAdmin) return <NotAdmin message={tAdmin("notAdmin", { email: user.email ?? "" })} />;

  const { partners, central } = await requireAdmin(async (tx) => ({
    partners: await listAssignablePartners(tx),
    central: await getCentralStockPartner(tx),
  }));
  const t = await getTranslations("handover");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6" data-testid="admin-scan-page">
      <div className="flex flex-col gap-3">
        <Link href="/admin/inventory" className="-ml-1 inline-flex w-fit items-center gap-1 text-label text-ink-2 hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden />
          {t("inventory.title")}
        </Link>
        <PageHeader title={t("title")} />
      </div>
      <ScanAssign partners={partners.map((p) => ({ id: p.id, name: p.name }))} appUrl={publicEnv.NEXT_PUBLIC_APP_URL} centralConfigured={central !== null} />
    </div>
  );
}

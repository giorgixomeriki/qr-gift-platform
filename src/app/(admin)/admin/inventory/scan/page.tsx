import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAdmin, requireAdminPage } from "@/lib/auth/admin";
import { listAssignablePartners, listSelectableBatches } from "@/lib/qr/handovers";
import { publicEnv } from "@/lib/env.public";
import { NotAdmin } from "@/components/admin/not-admin";
import { ScanAssign } from "@/components/admin/scan-assign";
import { PageHeader } from "@/components/dashboard/ui";

/** Option B: admin-only scan (or batch pick) → handover from central stock or from one partner to another. */
export default async function AdminScanAssignPage() {
  const { user, isAdmin } = await requireAdminPage();
  const tAdmin = await getTranslations("admin");
  if (!isAdmin) return <NotAdmin message={tAdmin("notAdmin", { email: user.email ?? "" })} />;

  const { partners, batches } = await requireAdmin(async (tx) => ({
    partners: await listAssignablePartners(tx),
    batches: await listSelectableBatches(tx),
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
      <ScanAssign partners={partners.map((p) => ({ id: p.id, name: p.name }))} batches={batches} appUrl={publicEnv.NEXT_PUBLIC_APP_URL} />
    </div>
  );
}

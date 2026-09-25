import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Layers } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { checkIsAdmin } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { getPartnerById, listPartnerMembers } from "@/lib/partners/service";
import { listQrBatches, listQrCodesForBatch } from "@/lib/qr/batches";
import { getPartnerUnpaidBalance, listPartnerPayouts } from "@/lib/payments/payouts";
import { NotAdmin } from "@/components/admin/not-admin";
import { PartnerStatusToggle } from "@/components/admin/partner-status-toggle";
import { PayoutManager } from "@/components/admin/payout-manager";
import { EmptyState, PageHeader, Panel } from "@/components/dashboard/ui";
import { MembershipManager } from "@/components/partners/membership-manager";
import { BatchBlock } from "@/components/qr/batch-block";
import { CreateBatchForm } from "@/components/qr/create-batch-form";
import {
  adminAddPartnerMemberByEmailAction,
  adminUpdatePartnerMemberRoleAction,
  adminRemovePartnerMemberAction,
} from "@/lib/partners/actions";
import { adminCreateBatchAction, adminMarkDistributedAction } from "@/lib/qr/actions";
import { adminRecordPayoutAction } from "@/lib/payments/payout-actions";

export default async function AdminPartnerDetailPage({ params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await params;

  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("admin");
  const isAdmin = await checkIsAdmin(user.id);
  if (!isAdmin) return <NotAdmin message={t("notAdmin", { email: user.email ?? "" })} />;

  const data = await requireAdmin(async (tx) => {
    const partner = await getPartnerById(tx, partnerId);
    if (!partner) return null;
    const members = await listPartnerMembers(tx, partnerId);
    const batches = await listQrBatches(tx, partnerId);
    const batchesWithCodes = await Promise.all(
      batches.map(async (batch) => ({ batch, qrCodes: await listQrCodesForBatch(tx, batch.id) })),
    );
    const unpaidBalanceMinor = await getPartnerUnpaidBalance(tx, partnerId, partner.currency);
    const payouts = await listPartnerPayouts(tx, partnerId);
    return { partner, members, batchesWithCodes, unpaidBalanceMinor, payouts };
  });

  if (!data) notFound();
  const { partner, members, batchesWithCodes, unpaidBalanceMinor, payouts } = data;
  const td = await getTranslations("admin.partnerDetail");
  const tNav = await getTranslations("nav");

  const markDistributed = adminMarkDistributedAction.bind(null, partnerId);
  const createBatch = adminCreateBatchAction.bind(null, partnerId);
  const addMember = adminAddPartnerMemberByEmailAction.bind(null, partnerId);
  const updateMemberRole = adminUpdatePartnerMemberRoleAction.bind(null, partnerId);
  const removeMember = adminRemovePartnerMemberAction.bind(null, partnerId);

  return (
    <div className="flex flex-col gap-10" data-testid="admin-partner-detail-page">
      <div className="flex flex-col gap-4">
        <Link href="/admin/partners" className="-ml-1 inline-flex w-fit items-center gap-1 text-label text-ink-2 hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden />
          {tNav("partners")}
        </Link>
        <PageHeader
          title={partner.name}
          description={<span className="font-mono text-caption">{partner.slug}</span>}
          actions={<PartnerStatusToggle partnerId={partner.id} status={partner.status} />}
        />
      </div>

      <Panel title={td("payoutsTitle")} flush>
        <PayoutManager
          partnerId={partner.id}
          currency={partner.currency}
          unpaidBalanceMinor={unpaidBalanceMinor}
          payouts={payouts}
          recordAction={adminRecordPayoutAction}
        />
      </Panel>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2">{td("batchesTitle")}</h2>
        <Panel title={td("createBatchTitle")}>
          <CreateBatchForm createAction={createBatch} />
        </Panel>
        {batchesWithCodes.map(({ batch, qrCodes }, index) => (
          <BatchBlock
            key={batch.id}
            batch={batch}
            qrCodes={qrCodes}
            countLabel={td("codesCount", { count: qrCodes.length })}
            defaultOpen={index === 0}
            markDistributedAction={markDistributed}
          />
        ))}
        {batchesWithCodes.length === 0 && (
          <Panel>
            <EmptyState icon={<Layers aria-hidden />} title={td("noBatches")} />
          </Panel>
        )}
      </section>

      <Panel title={td("membershipTitle")} flush>
        <MembershipManager members={members} addAction={addMember} updateRoleAction={updateMemberRole} removeAction={removeMember} />
      </Panel>
    </div>
  );
}

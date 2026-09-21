import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { checkIsAdmin } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { getPartnerById, listPartnerMembers } from "@/lib/partners/service";
import { listQrBatches, listQrCodesForBatch } from "@/lib/qr/batches";
import { getPartnerUnpaidBalance, listPartnerPayouts } from "@/lib/payments/payouts";
import { PartnerStatusToggle } from "@/components/admin/partner-status-toggle";
import { MembershipManager } from "@/components/partners/membership-manager";
import { CreateBatchForm } from "@/components/qr/create-batch-form";
import { InventoryTable } from "@/components/qr/inventory-table";
import { PayoutManager } from "@/components/admin/payout-manager";
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
  if (!isAdmin) {
    return <p className="text-sm text-neutral-400">{t("notAdmin", { email: user.email ?? "" })}</p>;
  }

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

  const markDistributed = adminMarkDistributedAction.bind(null, partnerId);
  const createBatch = adminCreateBatchAction.bind(null, partnerId);
  const addMember = adminAddPartnerMemberByEmailAction.bind(null, partnerId);
  const updateMemberRole = adminUpdatePartnerMemberRoleAction.bind(null, partnerId);
  const removeMember = adminRemovePartnerMemberAction.bind(null, partnerId);

  return (
    <div className="flex flex-col gap-8" data-testid="admin-partner-detail-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-neutral-100">{partner.name}</h1>
          <p className="text-xs font-mono text-neutral-500">{partner.slug}</p>
        </div>
        <PartnerStatusToggle partnerId={partner.id} status={partner.status} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-neutral-300">{td("membershipTitle")}</h2>
        <MembershipManager members={members} addAction={addMember} updateRoleAction={updateMemberRole} removeAction={removeMember} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-neutral-300">{td("payoutsTitle")}</h2>
        <PayoutManager
          partnerId={partner.id}
          currency={partner.currency}
          unpaidBalanceMinor={unpaidBalanceMinor}
          payouts={payouts}
          recordAction={adminRecordPayoutAction}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-neutral-300">{td("createBatchTitle")}</h2>
        <CreateBatchForm createAction={createBatch} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-neutral-300">{td("batchesTitle")}</h2>
        {batchesWithCodes.map(({ batch, qrCodes }) => (
          <div key={batch.id} className="rounded border border-neutral-800 p-4" data-testid="batch-block">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-medium">{batch.label}</h3>
              <span className="text-xs text-neutral-500">{td("codesCount", { count: qrCodes.length })}</span>
            </div>
            <InventoryTable batchId={batch.id} rows={qrCodes} markDistributedAction={markDistributed} />
          </div>
        ))}
        {batchesWithCodes.length === 0 && <p className="text-xs text-neutral-500">{td("noBatches")}</p>}
      </section>
    </div>
  );
}
